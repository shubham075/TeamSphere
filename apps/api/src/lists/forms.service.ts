import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Form, Prisma } from '@prisma/client';
import {
  CollabPerson, CollabRole, CreateFormInput, createFormSchema, FormAnswer, FormDetail, FormQuestion, FormResults, FormSummary,
  LISTS_WS_EVENTS, ListsChangedEvent, UpdateFormInput, updateFormSchema,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { canEdit } from '../collab/collab.logic';
import { ChannelTabsService } from '../planner/channel-tabs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { accepting, summarize, toCsv, validateAnswers } from './lists.logic';
import { Ownership } from './ownership';

type Ctx = { ip?: string | null };
type FormRow = Form & { members: { userId: string }[] };
/** Managers (owner / members / channel) or people who may only answer. */
type Access = { form: FormRow; role: CollabRole | 'respondent' };

/**
 * Forms & surveys. Personal forms can be answered by anyone in the organization who has the link; channel forms by
 * people in the channel. Anonymous forms store answers without a respondent id; FormRespondent still records who
 * answered so "one response per person" works either way.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
    private readonly ownership: Ownership,
    private readonly tabs: ChannelTabsService,
  ) {}

  async list(me: string): Promise<FormSummary[]> {
    const channelIds = await this.ownership.myChannelIds(me);
    const rows = await this.prisma.form.findMany({
      where: { OR: [{ ownerType: 'user', ownerId: me }, { ownerType: 'user', members: { some: { userId: me } } }, { ownerType: 'channel', ownerId: { in: channelIds } }] },
      include: { members: { select: { userId: true } }, _count: { select: { responses: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const channels = await this.ownership.channels(rows.filter((r) => r.ownerType === 'channel').map((r) => r.ownerId));
    const out: FormSummary[] = [];
    for (const r of rows) {
      const role = await this.ownership.role(me, r, r.members.map((m) => m.userId));
      if (role) out.push(this.summary(r, role, r._count.responses, channels));
    }
    return out;
  }

  async get(me: string, id: string): Promise<FormDetail> {
    const { form, role } = await this.access(me, id);
    // Respondents never see drafts: the form doesn't exist for them yet.
    if (role === 'respondent' && form.status === 'draft') throw new NotFoundException('This form isn’t open yet');
    const [count, responded] = await Promise.all([
      this.prisma.formResponse.count({ where: { formId: id } }),
      this.prisma.formRespondent.findUnique({ where: { formId_userId: { formId: id, userId: me } } }),
    ]);
    const people = await this.ownership.people([form.ownerType === 'user' ? form.ownerId : null, ...form.members.map((m) => m.userId)]);
    const channels = await this.ownership.channels(form.ownerType === 'channel' ? [form.ownerId] : []);
    return {
      ...this.summary(form, role, role === 'respondent' ? 0 : count, channels),
      description: form.description,
      questions: form.questions as FormQuestion[],
      closesAt: form.closesAt?.toISOString() ?? null,
      anonymous: form.anonymous,
      onePerPerson: form.onePerPerson,
      accepting: accepting(form),
      responded: !!responded,
      owner: form.ownerType === 'user' ? (people.get(form.ownerId) ?? null) : null,
      members: form.members.map((m) => people.get(m.userId)).filter((p): p is CollabPerson => !!p),
    };
  }

  async create(me: string, raw: CreateFormInput, ctx: Ctx): Promise<FormDetail> {
    await this.policies.assert(me, (p) => p.apps.forms, 'Your organization’s policy doesn’t allow Forms');
    const input = createFormSchema.parse(raw);
    const owner = await this.ownership.placeFor(me, input.channelId);
    if (!owner) throw new ForbiddenException('You can’t add a form to this channel');
    this.checkQuestions(input.questions);
    const memberIds = owner.ownerType === 'user' ? await this.ownership.activeUsers(input.memberIds.filter((u) => u !== me)) : [];
    const form = await this.prisma.form.create({
      data: { ...owner, title: input.title, description: input.description, questions: input.questions, createdById: me, members: { create: memberIds.map((userId) => ({ userId })) } },
      include: { members: { select: { userId: true } } },
    });
    this.audit.log({ actorId: me, action: 'form.create', targetType: 'form', targetId: form.id, meta: owner, ip: ctx.ip });
    if (owner.ownerType === 'channel' && input.addTab) await this.tabs.add(me, owner.ownerId, { app: 'form', refId: form.id, title: form.title });
    await this.changed(form, memberIds);
    return this.get(me, form.id);
  }

  async update(me: string, id: string, raw: UpdateFormInput, ctx: Ctx): Promise<FormDetail> {
    const { form } = await this.manage(me, id, 'edit');
    const input = updateFormSchema.parse(raw);
    if (input.questions) this.checkQuestions(input.questions);
    if (input.status === 'open' && !((input.questions ?? (form.questions as FormQuestion[])).length)) throw new BadRequestException('Add at least one question before opening the form');
    const data: Prisma.FormUpdateInput = {
      title: input.title,
      description: input.description,
      questions: input.questions,
      status: input.status,
      closesAt: input.closesAt === undefined ? undefined : input.closesAt ? new Date(input.closesAt) : null,
      onePerPerson: input.onePerPerson,
    };
    if (input.anonymous !== undefined && input.anonymous !== form.anonymous) {
      // Switching anonymity after responses would expose or misattribute existing answers.
      if (await this.prisma.formResponse.count({ where: { formId: id } })) throw new BadRequestException('Anonymity can’t change once there are responses');
      data.anonymous = input.anonymous;
    }
    const updated = await this.prisma.form.update({ where: { id }, data, include: { members: { select: { userId: true } } } });
    if (input.status && input.status !== form.status) this.audit.log({ actorId: me, action: `form.${input.status}`, targetType: 'form', targetId: id, ip: ctx.ip });
    if (input.title) await this.tabs.renameFor('form', id, input.title);
    await this.changed(updated);
    return this.get(me, id);
  }

  async remove(me: string, id: string, ctx: Ctx) {
    const { form, role } = await this.manage(me, id, 'edit');
    if (form.ownerType === 'user' && role !== 'owner') throw new ForbiddenException('Only the owner can delete this form');
    const audience = await this.ownership.audience(form, form.members.map((m) => m.userId));
    await this.prisma.form.delete({ where: { id } });
    await this.tabs.removeFor('form', id);
    this.audit.log({ actorId: me, action: 'form.delete', targetType: 'form', targetId: id, meta: { title: form.title }, ip: ctx.ip });
    this.realtime.toUsers(audience, LISTS_WS_EVENTS.formsChanged, { ids: [id] } satisfies ListsChangedEvent);
  }

  async submit(me: string, id: string, raw: Record<string, unknown>) {
    const { form } = await this.access(me, id);
    if (!accepting(form)) throw new BadRequestException('This form isn’t accepting responses');
    const r = validateAnswers(form.questions as FormQuestion[], raw);
    if ('error' in r) throw new BadRequestException(r.error);
    try {
      await this.prisma.$transaction(async (tx) => {
        if (form.onePerPerson) await tx.formRespondent.create({ data: { formId: id, userId: me } });
        else await tx.formRespondent.upsert({ where: { formId_userId: { formId: id, userId: me } }, create: { formId: id, userId: me }, update: { at: new Date() } });
        await tx.formResponse.create({ data: { formId: id, respondentId: form.anonymous ? null : me, answers: r.answers } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You’ve already responded to this form');
      throw e;
    }
    await this.changed(form);
  }

  async results(me: string, id: string): Promise<FormResults> {
    const { form } = await this.manage(me, id, 'read');
    const rows = await this.prisma.formResponse.findMany({ where: { formId: id }, orderBy: { createdAt: 'asc' }, take: 10_000 });
    const people = await this.ownership.people(rows.map((r) => r.respondentId));
    const responses = rows.map((r) => ({ id: r.id, respondent: (r.respondentId && people.get(r.respondentId)) || null, answers: r.answers as Record<string, FormAnswer>, createdAt: r.createdAt.toISOString() }));
    return { responseCount: rows.length, questions: summarize(form.questions as FormQuestion[], responses), responses: [...responses].reverse() };
  }

  async csv(me: string, id: string): Promise<{ title: string; csv: string }> {
    const { form } = await this.manage(me, id, 'read');
    const questions = form.questions as FormQuestion[];
    const results = await this.results(me, id);
    const header = ['Submitted', ...(form.anonymous ? [] : ['Respondent']), ...questions.map((q) => q.title)];
    const rows = [...results.responses].reverse().map((r) => [r.createdAt, ...(form.anonymous ? [] : [r.respondent?.displayName ?? '']), ...questions.map((q) => r.answers[q.id] ?? '')]);
    return { title: form.title, csv: toCsv(header, rows) };
  }

  async addMembers(me: string, id: string, userIds: string[]): Promise<FormDetail> {
    const { form, role } = await this.manage(me, id, 'read');
    if (form.ownerType !== 'user') throw new BadRequestException('Channel forms are managed by everyone in the channel');
    if (role !== 'owner') throw new ForbiddenException('Only the owner can add co-authors');
    const ids = await this.ownership.activeUsers(userIds.filter((u) => u !== form.ownerId));
    await this.prisma.formMember.createMany({ data: ids.map((userId) => ({ formId: id, userId })), skipDuplicates: true });
    await this.changed(form, ids);
    return this.get(me, id);
  }

  async removeMember(me: string, id: string, userId: string) {
    const { form, role } = await this.manage(me, id, 'read');
    if (form.ownerType !== 'user') throw new BadRequestException('Channel forms are managed by everyone in the channel');
    if (userId !== me && role !== 'owner') throw new ForbiddenException('Only the owner can remove co-authors');
    if (userId === form.ownerId) throw new BadRequestException('The owner can’t leave their own form');
    const audience = await this.ownership.audience(form, form.members.map((m) => m.userId));
    await this.prisma.formMember.deleteMany({ where: { formId: id, userId } });
    this.realtime.toUsers(audience, LISTS_WS_EVENTS.formsChanged, { ids: [id] } satisfies ListsChangedEvent);
  }

  // ------------------------------------------------------------------ access

  /** Managers get their role; anyone else allowed to answer gets 'respondent'. */
  private async access(me: string, id: string): Promise<Access> {
    const form = await this.prisma.form.findUnique({ where: { id }, include: { members: { select: { userId: true } } } });
    if (!form) throw new NotFoundException('Form not found');
    const role = await this.ownership.role(me, form, form.members.map((m) => m.userId));
    if (role) return { form, role };
    if (form.ownerType === 'user') {
      const user = await this.prisma.user.findUnique({ where: { id: me }, select: { isActive: true, role: true } });
      if (user?.isActive && user.role !== 'guest') return { form, role: 'respondent' };
    }
    throw new NotFoundException('Form not found');
  }

  private async manage(me: string, id: string, action: 'read' | 'edit'): Promise<{ form: FormRow; role: CollabRole }> {
    const { form, role } = await this.access(me, id);
    if (role === 'respondent') throw new ForbiddenException('Only the form’s authors can do that');
    if (action === 'edit' && !canEdit(role)) throw new ForbiddenException('This form is read-only');
    return { form, role };
  }

  private checkQuestions(questions: FormQuestion[]) {
    const ids = new Set<string>();
    for (const q of questions) {
      if (ids.has(q.id)) throw new BadRequestException(`Duplicate question id “${q.id}”`);
      ids.add(q.id);
      if ((q.type === 'choice' || q.type === 'multichoice') && !(q.options?.length ?? 0)) throw new BadRequestException(`Add options to “${q.title}”`);
    }
  }

  private async changed(form: FormRow, extra: string[] = []) {
    const audience = new Set([...(await this.ownership.audience(form, form.members.map((m) => m.userId))), ...extra]);
    this.realtime.toUsers(audience, LISTS_WS_EVENTS.formsChanged, { ids: [form.id] } satisfies ListsChangedEvent);
  }

  private summary(f: Form, role: FormSummary['role'], responseCount: number, channels: Map<string, { id: string; name: string; teamName: string }>): FormSummary {
    return {
      id: f.id,
      title: f.title,
      ownerType: f.ownerType,
      channel: f.ownerType === 'channel' ? (channels.get(f.ownerId) ?? null) : null,
      role,
      status: f.status,
      responseCount,
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}
