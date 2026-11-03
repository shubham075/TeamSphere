import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Prisma, Task } from '@prisma/client';
import {
  ActivityItem, BucketInfo, ChecklistItemInfo, CreateBucketInput, CreatePlanInput, CreateTaskInput, MyDayInput, PLANNER_WS_EVENTS,
  PlanDetail, PlannerActivityType, PlannerChangedEvent, PlanPerson, PlanRole, PlanSummary, PlanTasks, TaskAttachmentInfo, TaskDetail,
  TaskInfo, TaskLabelColor, TodoList, UpdateBucketInput, UpdateChecklistItemInput, UpdatePlanInput, UpdateTaskInput, WS_EVENTS,
  createPlanSchema, createTaskSchema,
} from '@teamsphere/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { FileLibraries } from '../files/file-libraries';
import { StorageService } from '../infra/storage';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { avatarUrl } from '../users/users.mapper';
import { ChannelTabsService } from './channel-tabs.service';
import {
  between, canPersonalTask, canPlan, completionChange, fromDateOnly, inTodoList, invalidAssignees, isHighPriority, newlyAssigned,
  nextPosition, PlanAction, planRole, toDateOnly,
} from './planner.logic';

type Ctx = { ip?: string | null };

export interface UploadedTaskFile {
  name: string;
  mimeType: string;
  size: number;
  store: (key: string) => Promise<void>;
}

const DEFAULT_BUCKET = 'To do';
const POLICY_MESSAGE = 'Your organization’s policy doesn’t allow Planner';

const taskInclude = (me: string, day: string) =>
  ({
    plan: { select: { title: true } },
    assignees: { select: { userId: true }, orderBy: { assignedAt: 'asc' } },
    checklist: { select: { done: true } },
    myDay: { where: { userId: me, day }, select: { userId: true } },
    _count: { select: { comments: true, attachments: true } },
  }) satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: ReturnType<typeof taskInclude> }>;

/** Today's date in UTC; clients pass their own local day for My Day. */
const utcToday = () => new Date().toISOString().slice(0, 10);

function date(value: string | null | undefined) {
  try {
    return toDateOnly(value);
  } catch {
    throw new BadRequestException('Invalid date');
  }
}

/**
 * Planner and To Do. Plans belong to a person (plus members) or to a channel; tasks without a plan are personal
 * To Do tasks. Channel access is resolved through FileLibraries so a plan follows the same rules as the channel's files.
 */
@Injectable()
export class PlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly libraries: FileLibraries,
    private readonly policies: PolicyService,
    private readonly storage: StorageService,
    private readonly tabs: ChannelTabsService,
  ) {}

  // ------------------------------------------------------------------ plans

  async listPlans(me: string): Promise<PlanSummary[]> {
    const memberships = await this.prisma.conversationMember.findMany({ where: { userId: me }, select: { conversationId: true } });
    const channels = await this.prisma.channel.findMany({
      where: { conversationId: { in: memberships.map((m) => m.conversationId) }, deletedAt: null, team: { deletedAt: null } },
      select: { id: true },
    });
    const plans = await this.prisma.plan.findMany({
      where: {
        OR: [
          { ownerType: 'user', ownerId: me },
          { ownerType: 'user', members: { some: { userId: me } } },
          { ownerType: 'channel', ownerId: { in: channels.map((c) => c.id) } },
        ],
      },
      include: { members: { select: { userId: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const out: PlanSummary[] = [];
    for (const plan of plans) {
      const role = await this.roleOf(me, plan, plan.members.map((m) => m.userId));
      if (role) out.push(await this.summary(plan, role));
    }
    return out;
  }

  async getPlan(me: string, planId: string, day = utcToday()): Promise<PlanTasks> {
    const { plan, role } = await this.requirePlan(me, planId, 'read');
    const rows = await this.prisma.task.findMany({ where: { planId }, include: taskInclude(me, day), orderBy: { position: 'asc' } });
    return { plan: await this.detail(plan, role), tasks: await this.presentTasks(rows) };
  }

  async createPlan(me: string, raw: CreatePlanInput, ctx: Ctx): Promise<PlanDetail> {
    await this.policies.assert(me, (p) => p.apps.planner, POLICY_MESSAGE);
    const input = createPlanSchema.parse(raw);
    let ownerType: 'user' | 'channel' = 'user';
    let ownerId = me;
    if (input.channelId) {
      const role = await this.libraries.roleFor(me, 'channel', input.channelId);
      if (!canPlan(role, 'edit')) throw new ForbiddenException('You can’t add a plan to this channel');
      ownerType = 'channel';
      ownerId = input.channelId;
    }
    const memberIds = ownerType === 'user' ? await this.activeUsers(input.memberIds.filter((id) => id !== me)) : [];
    const plan = await this.prisma.plan.create({
      data: {
        ownerType,
        ownerId,
        title: input.title,
        createdById: me,
        members: { create: memberIds.map((userId) => ({ userId })) },
        buckets: { create: { name: DEFAULT_BUCKET, position: 1024 } },
      },
    });
    this.audit.log({ actorId: me, action: 'planner.plan.create', targetType: 'plan', targetId: plan.id, meta: { ownerType, ownerId }, ip: ctx.ip });
    if (ownerType === 'channel' && input.addTab) await this.tabs.add(me, ownerId, { app: 'planner', refId: plan.id, title: plan.title });
    await this.broadcast(plan, [], [me, ...memberIds]);
    const { role } = await this.requirePlan(me, plan.id, 'read');
    return this.detail(plan, role);
  }

  async updatePlan(me: string, planId: string, input: UpdatePlanInput): Promise<PlanDetail> {
    const { plan, role } = await this.requirePlan(me, planId, 'edit');
    let labels: Record<string, string> | undefined;
    if (input.labels) {
      labels = { ...(plan.labels as Record<string, string>) };
      for (const [color, name] of Object.entries(input.labels)) {
        if (name) labels[color] = name;
        else delete labels[color];
      }
    }
    const updated = await this.prisma.plan.update({ where: { id: planId }, data: { title: input.title, labels } });
    if (input.title) await this.tabs.renameFor('planner', planId, input.title);
    await this.broadcast(updated);
    return this.detail(updated, role);
  }

  async deletePlan(me: string, planId: string, ctx: Ctx) {
    const { plan } = await this.requirePlan(me, planId, 'manage');
    const audience = await this.audience(plan);
    const attachments = await this.prisma.taskAttachment.findMany({ where: { task: { planId } }, select: { storageKey: true } });
    await this.prisma.plan.delete({ where: { id: planId } });
    await this.tabs.removeFor('planner', planId);
    for (const a of attachments) await this.storage.remove(a.storageKey).catch(() => undefined);
    this.audit.log({ actorId: me, action: 'planner.plan.delete', targetType: 'plan', targetId: planId, meta: { title: plan.title }, ip: ctx.ip });
    this.realtime.toUsers(audience, PLANNER_WS_EVENTS.changed, { planIds: [planId], taskIds: [] } satisfies PlannerChangedEvent);
  }

  async addMembers(me: string, planId: string, userIds: string[]): Promise<PlanDetail> {
    const { plan, role } = await this.requirePlan(me, planId, 'manage');
    if (plan.ownerType !== 'user') throw new BadRequestException('Channel plans include everyone in the channel');
    const ids = await this.activeUsers(userIds.filter((id) => id !== plan.ownerId));
    await this.prisma.planMember.createMany({ data: ids.map((userId) => ({ planId, userId })), skipDuplicates: true });
    await this.broadcast(plan, [], ids);
    return this.detail(plan, role);
  }

  /** Owners remove anyone; members can remove themselves (leave). Their assignments in the plan go too. */
  async removeMember(me: string, planId: string, userId: string) {
    const { plan } = await this.requirePlan(me, planId, 'read');
    if (plan.ownerType !== 'user') throw new BadRequestException('Channel plans include everyone in the channel');
    if (userId !== me && plan.ownerId !== me) throw new ForbiddenException('Only the plan owner can remove people');
    if (userId === plan.ownerId) throw new BadRequestException('The owner can’t leave their own plan');
    const audience = await this.audience(plan);
    await this.prisma.$transaction([
      this.prisma.planMember.deleteMany({ where: { planId, userId } }),
      this.prisma.taskAssignee.deleteMany({ where: { userId, task: { planId } } }),
    ]);
    this.realtime.toUsers(audience, PLANNER_WS_EVENTS.changed, { planIds: [planId], taskIds: [] } satisfies PlannerChangedEvent);
  }

  // ------------------------------------------------------------------ buckets

  async createBucket(me: string, planId: string, input: CreateBucketInput): Promise<BucketInfo> {
    const { plan } = await this.requirePlan(me, planId, 'edit');
    const existing = await this.prisma.planBucket.findMany({ where: { planId }, select: { position: true } });
    const bucket = await this.prisma.planBucket.create({ data: { planId, name: input.name, position: input.position ?? nextPosition(existing) } });
    await this.touch(plan);
    return { id: bucket.id, name: bucket.name, position: bucket.position };
  }

  async updateBucket(me: string, bucketId: string, input: UpdateBucketInput): Promise<BucketInfo> {
    const bucket = await this.prisma.planBucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw new NotFoundException('Bucket not found');
    const { plan } = await this.requirePlan(me, bucket.planId, 'edit');
    const updated = await this.prisma.planBucket.update({ where: { id: bucketId }, data: { name: input.name, position: input.position } });
    await this.touch(plan);
    return { id: updated.id, name: updated.name, position: updated.position };
  }

  /** Deleting a bucket deletes its tasks, as in the UI's confirmation. */
  async deleteBucket(me: string, bucketId: string) {
    const bucket = await this.prisma.planBucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw new NotFoundException('Bucket not found');
    const { plan } = await this.requirePlan(me, bucket.planId, 'edit');
    const tasks = await this.prisma.task.findMany({ where: { bucketId }, select: { id: true, attachments: { select: { storageKey: true } } } });
    await this.prisma.$transaction([
      this.prisma.task.deleteMany({ where: { bucketId } }),
      this.prisma.planBucket.delete({ where: { id: bucketId } }),
    ]);
    for (const a of tasks.flatMap((t) => t.attachments)) await this.storage.remove(a.storageKey).catch(() => undefined);
    await this.touch(plan, tasks.map((t) => t.id));
  }

  // ------------------------------------------------------------------ tasks

  async todo(me: string, list: TodoList, day = utcToday()): Promise<TaskInfo[]> {
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    if (list === 'myday') {
      // Any task the person added to today, assigned or not, as long as they can still open its plan.
      const rows = await this.prisma.task.findMany({ where: { myDay: { some: { userId: me, day } } }, include: { ...taskInclude(me, day), plan: true }, orderBy, take: 500 });
      const roles = new Map<string, PlanRole | null>();
      const visible: typeof rows = [];
      for (const t of rows) {
        if (!t.plan) {
          if (canPersonalTask(me, t)) visible.push(t);
          continue;
        }
        if (!roles.has(t.plan.id)) roles.set(t.plan.id, await this.roleOf(me, t.plan));
        if (roles.get(t.plan.id)) visible.push(t);
      }
      return this.presentTasks(visible);
    }
    const rows = await this.prisma.task.findMany({
      where: { OR: [{ planId: null, ownerId: me }, { planId: { not: null }, assignees: { some: { userId: me } } }] },
      include: taskInclude(me, day),
      orderBy,
      take: 1000,
    });
    const visible = rows.filter((t) => inTodoList(list, { ...t, assigneeIds: t.assignees.map((a) => a.userId), myDay: t.myDay.length > 0 }, me));
    return this.presentTasks(visible);
  }

  async taskDetail(me: string, taskId: string, day = utcToday()): Promise<TaskDetail> {
    const { canEdit } = await this.requireTask(me, taskId, 'read');
    const row = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        ...taskInclude(me, day),
        checklist: { orderBy: { position: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    });
    const people = await this.people([...row.comments.map((c) => c.authorId), ...row.attachments.map((a) => a.uploadedById)]);
    const [info] = await this.presentTasks([{ ...row, checklist: row.checklist.map((c) => ({ done: c.done })) }]);
    return {
      ...info,
      canEdit,
      checklistItems: row.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done, position: c.position })),
      comments: row.comments.map((c) => ({ id: c.id, author: people.get(c.authorId) ?? null, body: c.body, createdAt: c.createdAt.toISOString() })),
      attachments: row.attachments.map((a) => this.presentAttachment(a, people)),
    };
  }

  async createTask(me: string, raw: CreateTaskInput, ctx: Ctx): Promise<TaskInfo> {
    await this.policies.assert(me, (p) => p.apps.planner, POLICY_MESSAGE);
    const input = createTaskSchema.parse(raw);
    let plan: Plan | null = null;
    let bucketId: string | null = null;
    let assigneeIds: string[] = [];
    if (input.planId) {
      ({ plan } = await this.requirePlan(me, input.planId, 'edit'));
      bucketId = await this.resolveBucket(plan.id, input.bucketId);
      assigneeIds = await this.checkAssignees(plan, input.assigneeIds ?? []);
    } else if (input.assigneeIds?.length) {
      throw new BadRequestException('Personal tasks can’t be assigned; add the task to a plan');
    }
    if (input.source) await this.requireMessage(me, input.source.conversationId, input.source.messageId);

    const siblings = await this.prisma.task.findMany({
      where: plan ? { planId: plan.id, bucketId } : { planId: null, ownerId: me },
      select: { position: true },
      orderBy: { position: 'asc' },
      take: 1,
    });
    const task = await this.prisma.task.create({
      data: {
        planId: plan?.id ?? null,
        bucketId,
        ownerId: plan ? null : me,
        title: input.title,
        notes: input.notes ?? '',
        priority: input.priority,
        progress: input.progress,
        ...completionChange('not_started', input.progress, me),
        startDate: date(input.startDate),
        dueDate: date(input.dueDate),
        labels: input.labels,
        important: plan ? false : (input.important ?? false),
        // New tasks go to the top of their bucket / list.
        position: between(null, siblings[0]?.position ?? null),
        sourceConversationId: input.source?.conversationId,
        sourceMessageId: input.source?.messageId,
        createdById: me,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        myDay: input.myDay ? { create: { userId: me, day: input.myDay } } : undefined,
      },
      include: taskInclude(me, input.myDay ?? utcToday()),
    });
    this.audit.log({ actorId: me, action: 'planner.task.create', targetType: 'task', targetId: task.id, meta: { planId: plan?.id ?? null }, ip: ctx.ip });
    for (const userId of newlyAssigned([], assigneeIds, me)) await this.notify(userId, 'task_assigned', me, task, plan);
    await this.afterTaskChange(task, plan);
    const [info] = await this.presentTasks([task]);
    return info;
  }

  async updateTask(me: string, taskId: string, input: UpdateTaskInput, day = utcToday()): Promise<TaskInfo> {
    const { task, plan } = await this.requireTask(me, taskId, 'edit');
    const data: Prisma.TaskUncheckedUpdateInput = {
      title: input.title,
      notes: input.notes,
      priority: input.priority,
      progress: input.progress,
      startDate: date(input.startDate),
      dueDate: date(input.dueDate),
      labels: input.labels,
      position: input.position,
      ...completionChange(task.progress, input.progress, me),
    };
    if (input.important !== undefined) {
      if (plan) throw new BadRequestException('Use priority for plan tasks');
      data.important = input.important;
    }
    if (input.bucketId !== undefined) {
      if (!plan) throw new BadRequestException('Personal tasks have no buckets');
      data.bucketId = await this.resolveBucket(plan.id, input.bucketId);
    }
    let added: string[] = [];
    if (input.assigneeIds) {
      if (!plan) throw new BadRequestException('Personal tasks can’t be assigned; add the task to a plan');
      const ids = await this.checkAssignees(plan, input.assigneeIds);
      const before = (await this.prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId);
      added = newlyAssigned(before, ids, me);
      data.assignees = { deleteMany: { userId: { notIn: ids } }, create: ids.filter((id) => !before.includes(id)).map((userId) => ({ userId })) };
    }
    const updated = await this.prisma.task.update({ where: { id: taskId }, data, include: taskInclude(me, day) });
    for (const userId of added) await this.notify(userId, 'task_assigned', me, updated, plan);
    await this.afterTaskChange(updated, plan);
    const [info] = await this.presentTasks([updated]);
    return info;
  }

  async deleteTask(me: string, taskId: string, ctx: Ctx) {
    const { task, plan } = await this.requireTask(me, taskId, 'edit');
    const audience = await this.taskAudience(task, plan);
    const attachments = await this.prisma.taskAttachment.findMany({ where: { taskId }, select: { storageKey: true } });
    await this.prisma.task.delete({ where: { id: taskId } });
    for (const a of attachments) await this.storage.remove(a.storageKey).catch(() => undefined);
    this.audit.log({ actorId: me, action: 'planner.task.delete', targetType: 'task', targetId: taskId, meta: { title: task.title }, ip: ctx.ip });
    if (plan) await this.prisma.plan.update({ where: { id: plan.id }, data: { updatedAt: new Date() } });
    this.realtime.toUsers(audience, PLANNER_WS_EVENTS.changed, { planIds: plan ? [plan.id] : [], taskIds: [taskId] } satisfies PlannerChangedEvent);
  }

  /** My Day is personal, so reading a task is enough (assignees can add plan tasks they can't edit). */
  async setMyDay(me: string, taskId: string, input: MyDayInput) {
    await this.requireTask(me, taskId, 'read');
    if (input.on) {
      await this.prisma.taskMyDay.upsert({ where: { taskId_userId: { taskId, userId: me } }, create: { taskId, userId: me, day: input.day }, update: { day: input.day } });
    } else {
      await this.prisma.taskMyDay.deleteMany({ where: { taskId, userId: me } });
    }
    this.realtime.toUsers([me], PLANNER_WS_EVENTS.changed, { planIds: [], taskIds: [taskId] } satisfies PlannerChangedEvent);
  }

  // ------------------------------------------------------------------ checklist, comments, attachments

  async addChecklistItem(me: string, taskId: string, text: string): Promise<ChecklistItemInfo> {
    const { task, plan } = await this.requireTask(me, taskId, 'edit');
    const existing = await this.prisma.taskChecklistItem.findMany({ where: { taskId }, select: { position: true } });
    if (existing.length >= 50) throw new BadRequestException('A checklist can have up to 50 items');
    const item = await this.prisma.taskChecklistItem.create({ data: { taskId, text, position: nextPosition(existing) } });
    await this.afterTaskChange(task, plan);
    return { id: item.id, text: item.text, done: item.done, position: item.position };
  }

  async updateChecklistItem(me: string, itemId: string, input: UpdateChecklistItemInput): Promise<ChecklistItemInfo> {
    const item = await this.prisma.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Checklist item not found');
    const { task, plan } = await this.requireTask(me, item.taskId, 'edit');
    const updated = await this.prisma.taskChecklistItem.update({ where: { id: itemId }, data: input });
    await this.afterTaskChange(task, plan);
    return { id: updated.id, text: updated.text, done: updated.done, position: updated.position };
  }

  async deleteChecklistItem(me: string, itemId: string) {
    const item = await this.prisma.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Checklist item not found');
    const { task, plan } = await this.requireTask(me, item.taskId, 'edit');
    await this.prisma.taskChecklistItem.delete({ where: { id: itemId } });
    await this.afterTaskChange(task, plan);
  }

  /** Anyone who can open the task may comment (also read-only channel members, like replying to a post). */
  async addComment(me: string, taskId: string, body: string) {
    const { task, plan } = await this.requireTask(me, taskId, 'read');
    if (!plan) throw new BadRequestException('Comments are for plan tasks');
    if (!canPlan(await this.roleOf(me, plan), 'edit')) throw new ForbiddenException('This plan is read-only');
    const comment = await this.prisma.taskComment.create({ data: { taskId, authorId: me, body } });
    const assignees = (await this.prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId);
    const commenters = (await this.prisma.taskComment.findMany({ where: { taskId }, select: { authorId: true }, distinct: ['authorId'] })).map((c) => c.authorId);
    const notifyIds = new Set([...assignees, ...commenters, task.createdById]);
    notifyIds.delete(me);
    for (const userId of notifyIds) await this.notify(userId, 'task_comment', me, task, plan, body);
    await this.afterTaskChange(task, plan);
    const people = await this.people([me]);
    return { id: comment.id, author: people.get(me) ?? null, body: comment.body, createdAt: comment.createdAt.toISOString() };
  }

  async deleteComment(me: string, commentId: string) {
    const comment = await this.prisma.taskComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    const { task, plan } = await this.requireTask(me, comment.taskId, 'read');
    if (comment.authorId !== me && !(plan && canPlan(await this.roleOf(me, plan), 'manage'))) throw new ForbiddenException('You can only delete your own comments');
    await this.prisma.taskComment.delete({ where: { id: commentId } });
    await this.afterTaskChange(task, plan);
  }

  async addAttachment(me: string, taskId: string, file: UploadedTaskFile, ctx: Ctx): Promise<TaskAttachmentInfo> {
    await this.policies.assert(me, (p) => p.apps.files, 'Your organization’s policy doesn’t allow you to upload files');
    const { task, plan } = await this.requireTask(me, taskId, 'edit');
    if ((await this.prisma.taskAttachment.count({ where: { taskId } })) >= 20) throw new BadRequestException('A task can have up to 20 attachments');
    const storageKey = `tasks/${taskId}/${randomBytes(16).toString('hex')}`;
    await file.store(storageKey);
    const row = await this.prisma.taskAttachment.create({
      data: { taskId, storageKey, fileName: file.name, mimeType: file.mimeType, size: file.size, uploadedById: me },
    });
    this.audit.log({ actorId: me, action: 'planner.attachment.upload', targetType: 'task', targetId: taskId, meta: { name: file.name, size: file.size }, ip: ctx.ip });
    await this.afterTaskChange(task, plan);
    return this.presentAttachment(row, await this.people([me]));
  }

  async deleteAttachment(me: string, attachmentId: string) {
    const row = await this.prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
    if (!row) throw new NotFoundException('Attachment not found');
    const { task, plan } = await this.requireTask(me, row.taskId, 'edit');
    await this.prisma.taskAttachment.delete({ where: { id: attachmentId } });
    await this.storage.remove(row.storageKey).catch(() => undefined);
    await this.afterTaskChange(task, plan);
  }

  /** For the signed content route (the signature already proved access). */
  attachment(id: string) {
    return this.prisma.taskAttachment.findUnique({ where: { id } });
  }

  // ------------------------------------------------------------------ access

  private async roleOf(me: string, plan: Plan, memberIds?: string[]): Promise<PlanRole | null> {
    if (plan.ownerType === 'channel') {
      return planRole({ userId: me, ownerType: 'channel', ownerId: plan.ownerId, memberIds: [], channelRole: await this.libraries.roleFor(me, 'channel', plan.ownerId) });
    }
    const members = memberIds ?? (await this.prisma.planMember.findMany({ where: { planId: plan.id }, select: { userId: true } })).map((m) => m.userId);
    return planRole({ userId: me, ownerType: 'user', ownerId: plan.ownerId, memberIds: members, channelRole: null });
  }

  /** Plans you can't open look like they don't exist. */
  private async requirePlan(me: string, planId: string, action: PlanAction): Promise<{ plan: Plan; role: PlanRole }> {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    const role = plan ? await this.roleOf(me, plan) : null;
    if (!plan || !role) throw new NotFoundException('Plan not found');
    if (!canPlan(role, action)) throw new ForbiddenException(action === 'manage' ? 'Only the plan owner can do that' : 'This plan is read-only');
    return { plan, role };
  }

  private async requireTask(me: string, taskId: string, action: 'read' | 'edit'): Promise<{ task: Task; plan: Plan | null; canEdit: boolean }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { plan: true } });
    if (!task) throw new NotFoundException('Task not found');
    if (!task.plan) {
      if (!canPersonalTask(me, task)) throw new NotFoundException('Task not found');
      return { task, plan: null, canEdit: true };
    }
    const role = await this.roleOf(me, task.plan);
    if (!role) throw new NotFoundException('Task not found');
    const canEdit = canPlan(role, 'edit');
    if (action === 'edit' && !canEdit) throw new ForbiddenException('This plan is read-only');
    return { task, plan: task.plan, canEdit };
  }

  private async requireMessage(me: string, conversationId: string, messageId: string) {
    const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: me } } });
    const message = member && (await this.prisma.message.findFirst({ where: { id: messageId, conversationId, deletedAt: null }, select: { id: true } }));
    if (!message) throw new BadRequestException('Message not found');
  }

  private async resolveBucket(planId: string, bucketId: string | null | undefined): Promise<string | null> {
    if (bucketId) {
      const bucket = await this.prisma.planBucket.findFirst({ where: { id: bucketId, planId }, select: { id: true } });
      if (!bucket) throw new BadRequestException('Unknown bucket');
      return bucket.id;
    }
    if (bucketId === null) return null;
    const first = await this.prisma.planBucket.findFirst({ where: { planId }, orderBy: { position: 'asc' }, select: { id: true } });
    return first?.id ?? null;
  }

  private async checkAssignees(plan: Plan, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const bad = invalidAssignees(unique, await this.audience(plan));
    if (bad.length) throw new BadRequestException('Assignees must be able to open the plan');
    return unique;
  }

  private async activeUsers(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, isActive: true, role: { not: 'guest' } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Everyone who can open the plan. */
  private async audience(plan: Plan): Promise<string[]> {
    if (plan.ownerType === 'channel') return this.libraries.audience('channel', plan.ownerId);
    const members = await this.prisma.planMember.findMany({ where: { planId: plan.id }, select: { userId: true } });
    return [plan.ownerId, ...members.map((m) => m.userId)];
  }

  private async taskAudience(task: Task, plan: Plan | null): Promise<string[]> {
    return plan ? this.audience(plan) : [task.ownerId!];
  }

  // ------------------------------------------------------------------ realtime & activity

  private async touch(plan: Plan, taskIds: string[] = []) {
    await this.prisma.plan.update({ where: { id: plan.id }, data: { updatedAt: new Date() } });
    await this.broadcast(plan, taskIds);
  }

  private async broadcast(plan: Plan, taskIds: string[] = [], extra: string[] = []) {
    const audience = new Set([...(await this.audience(plan)), ...extra]);
    this.realtime.toUsers(audience, PLANNER_WS_EVENTS.changed, { planIds: [plan.id], taskIds } satisfies PlannerChangedEvent);
  }

  private async afterTaskChange(task: Task, plan: Plan | null) {
    if (plan) return this.touch(plan, [task.id]);
    this.realtime.toUsers([task.ownerId!], PLANNER_WS_EVENTS.changed, { planIds: [], taskIds: [task.id] } satisfies PlannerChangedEvent);
  }

  private async notify(userId: string, type: PlannerActivityType, actorId: string, task: Task, plan: Plan | null, extra?: string) {
    const preview = `${task.title}${plan ? ` · ${plan.title}` : ''}${extra ? ` — ${extra}` : ''}`.slice(0, 200);
    const row = await this.prisma.notification.create({
      data: { userId, type, actorId, targetId: task.id, preview },
      include: { actor: { select: { id: true, displayName: true, avatarKey: true } } },
    });
    const item: ActivityItem = {
      id: row.id,
      type,
      actor: row.actor ? { id: row.actor.id, displayName: row.actor.displayName, avatarUrl: avatarUrl(row.actor) } : null,
      conversationId: null,
      conversationTitle: null,
      messageId: null,
      targetId: task.id,
      preview: row.preview,
      read: false,
      createdAt: row.createdAt.toISOString(),
    };
    this.realtime.toUsers([userId], WS_EVENTS.notificationNew, item);
  }

  // ------------------------------------------------------------------ presentation

  private async summary(plan: Plan, role: PlanRole): Promise<PlanSummary> {
    let channel: PlanSummary['channel'] = null;
    if (plan.ownerType === 'channel') {
      const c = await this.prisma.channel.findUnique({ where: { id: plan.ownerId }, select: { id: true, name: true, teamId: true, team: { select: { name: true } } } });
      if (c) channel = { id: c.id, name: c.name, teamId: c.teamId, teamName: c.team.name };
    }
    const openTasks = await this.prisma.task.count({ where: { planId: plan.id, progress: { not: 'completed' } } });
    return { id: plan.id, title: plan.title, ownerType: plan.ownerType, channel, role, openTasks, updatedAt: plan.updatedAt.toISOString() };
  }

  private async detail(plan: Plan, role: PlanRole): Promise<PlanDetail> {
    const [summary, buckets, members, audience] = await Promise.all([
      this.summary(plan, role),
      this.prisma.planBucket.findMany({ where: { planId: plan.id }, orderBy: { position: 'asc' } }),
      plan.ownerType === 'user' ? this.prisma.planMember.findMany({ where: { planId: plan.id }, select: { userId: true } }) : Promise.resolve([]),
      this.audience(plan),
    ]);
    const people = await this.people([...audience, plan.ownerId]);
    const byName = (a: PlanPerson, b: PlanPerson) => a.displayName.localeCompare(b.displayName);
    return {
      ...summary,
      labels: plan.labels as Partial<Record<TaskLabelColor, string>>,
      buckets: buckets.map((b) => ({ id: b.id, name: b.name, position: b.position })),
      people: audience.map((id) => people.get(id)).filter((p): p is PlanPerson => !!p).sort(byName),
      members: members.map((m) => people.get(m.userId)).filter((p): p is PlanPerson => !!p).sort(byName),
      owner: plan.ownerType === 'user' ? (people.get(plan.ownerId) ?? null) : null,
    };
  }

  private async presentTasks(rows: TaskRow[]): Promise<TaskInfo[]> {
    const people = await this.people(rows.flatMap((t) => [t.createdById, t.completedById, ...t.assignees.map((a) => a.userId)]));
    return rows.map((t) => ({
      id: t.id,
      planId: t.planId,
      planTitle: t.plan?.title ?? null,
      bucketId: t.bucketId,
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      progress: t.progress,
      startDate: fromDateOnly(t.startDate),
      dueDate: fromDateOnly(t.dueDate),
      labels: t.labels as TaskLabelColor[],
      important: t.planId ? isHighPriority(t.priority) : t.important,
      position: t.position,
      completedAt: t.completedAt?.toISOString() ?? null,
      completedBy: (t.completedById && people.get(t.completedById)) || null,
      assignees: t.assignees.map((a) => people.get(a.userId)).filter((p): p is PlanPerson => !!p),
      checklist: { total: t.checklist.length, done: t.checklist.filter((c) => c.done).length },
      commentCount: t._count.comments,
      attachmentCount: t._count.attachments,
      myDay: t.myDay.length > 0,
      source: t.sourceConversationId && t.sourceMessageId ? { conversationId: t.sourceConversationId, messageId: t.sourceMessageId } : null,
      createdBy: people.get(t.createdById) ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  private presentAttachment(
    a: { id: string; fileName: string; mimeType: string; size: number; uploadedById: string; createdAt: Date },
    people: Map<string, PlanPerson>,
  ): TaskAttachmentInfo {
    return {
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      url: `/api/planner/attachments/${a.id}/content?${this.storage.sign(`ta:${a.id}`)}`,
      uploadedBy: people.get(a.uploadedById) ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private async people(ids: (string | null | undefined)[]): Promise<Map<string, PlanPerson>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true, avatarKey: true } });
    return new Map(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, avatarUrl: avatarUrl(u) }]));
  }
}
