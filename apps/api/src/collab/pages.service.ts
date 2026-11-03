import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Page, Prisma } from '@prisma/client';
import {
  COLLAB_WS_EVENTS, CollabChangedEvent, CollabPerson, CollabRole, CreatePageInput, createPageSchema, PageDetail, PageLocation,
  PagesHome, PageSummary, UpdatePageInput,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { FileLibraries } from '../files/file-libraries';
import { MeetingsService } from '../meetings/meetings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { avatarUrl } from '../users/users.mapper';
import { CollabService } from './collab.service';
import { canEdit, collabRole, excerpt, fragmentText, pathTo, wouldCycle } from './collab.logic';

type Ctx = { ip?: string | null };
const POLICY_MESSAGE = 'Your organization’s policy doesn’t allow Pages';
const summarySelect = { id: true, title: true, icon: true, parentId: true, rootId: true, position: true, text: true, updatedAt: true, updatedById: true } satisfies Prisma.PageSelect;
type SummaryRow = Prisma.PageGetPayload<{ select: typeof summarySelect }>;

/**
 * Pages: co-edited Tiptap documents. A tree belongs to a person (shared with PageMember rows on its root), a channel
 * (the channel's wiki) or a meeting (its notes). Content lives in Yjs and is synced by CollabService; this service
 * owns the tree, titles and access.
 */
@Injectable()
export class PagesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
    private readonly libraries: FileLibraries,
    private readonly meetings: MeetingsService,
    private readonly collab: CollabService,
  ) {}

  onModuleInit() {
    this.collab.register({
      kind: 'page',
      access: async (userId, id) => {
        const page = await this.prisma.page.findUnique({ where: { id } });
        return page ? this.roleOf(userId, page) : null;
      },
      load: async (id) => {
        const row = await this.prisma.page.findUnique({ where: { id }, select: { state: true } });
        return row?.state ? new Uint8Array(row.state) : null;
      },
      save: async (id, state, doc, editorId) => {
        const text = fragmentText(doc.getXmlFragment('default')).slice(0, 200_000);
        const page = await this.prisma.page.update({ where: { id }, data: { state: Buffer.from(state), text, updatedById: editorId ?? undefined } }).catch(() => null);
        if (page) await this.changed(page);
      },
    });
  }

  // ------------------------------------------------------------------ reading

  async home(me: string): Promise<PagesHome> {
    const [mine, memberships, channelIds] = await Promise.all([
      this.prisma.page.findMany({ where: { ownerType: 'user', ownerId: me }, select: summarySelect, orderBy: { position: 'asc' } }),
      this.prisma.pageMember.findMany({ where: { userId: me }, select: { pageId: true } }),
      this.myChannelIds(me),
    ]);
    const shared = await this.prisma.page.findMany({
      where: { ownerType: 'user', rootId: { in: memberships.map((m) => m.pageId) } },
      select: { ...summarySelect, ownerId: true },
      orderBy: { position: 'asc' },
    });
    const recent = await this.prisma.page.findMany({
      where: {
        OR: [
          { ownerType: 'user', ownerId: me },
          { ownerType: 'user', rootId: { in: memberships.map((m) => m.pageId) } },
          { ownerType: 'channel', ownerId: { in: channelIds } },
        ],
      },
      select: { ...summarySelect, ownerType: true, ownerId: true },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    const people = await this.people([...mine.map((p) => p.updatedById), ...shared.flatMap((p) => [p.updatedById, p.ownerId]), ...recent.map((p) => p.updatedById)]);
    const locations = await this.locations(recent);
    return {
      mine: mine.map((p) => this.summary(p, people)),
      shared: shared.map((p) => ({ ...this.summary(p, people), owner: people.get(p.ownerId) ?? null })),
      recent: recent.map((p) => ({ ...this.summary(p, people), ...locations.get(p.id)! })),
    };
  }

  /** The channel's wiki: every page of the channel, flat (the client builds the tree). */
  async channelPages(me: string, channelId: string): Promise<PageSummary[]> {
    if (!(await this.libraries.roleFor(me, 'channel', channelId))) throw new NotFoundException('Channel not found');
    const rows = await this.prisma.page.findMany({ where: { ownerType: 'channel', ownerId: channelId }, select: summarySelect, orderBy: { position: 'asc' } });
    const people = await this.people(rows.map((r) => r.updatedById));
    return rows.map((r) => this.summary(r, people));
  }

  async get(me: string, id: string): Promise<PageDetail> {
    const { page, role } = await this.require(me, id, 'read');
    await this.collab.flush('page', id);
    const tree = await this.prisma.page.findMany({ where: { rootId: page.rootId }, select: summarySelect, orderBy: { position: 'asc' } });
    const fresh = tree.find((p) => p.id === id) ?? page;
    const members = page.ownerType === 'user' ? await this.prisma.pageMember.findMany({ where: { pageId: page.rootId }, select: { userId: true } }) : [];
    const people = await this.people([...tree.map((p) => p.updatedById), page.createdById, page.ownerType === 'user' ? page.ownerId : null, ...members.map((m) => m.userId)]);
    const byId = new Map(tree.map((p) => [p.id, p]));
    const location = (await this.locations([page])).get(page.id)!;
    return {
      ...this.summary(fresh, people),
      ...location,
      role,
      breadcrumbs: pathTo(id, byId).map((p) => ({ id: p.id, title: p.title })),
      children: tree.filter((p) => p.parentId === id).map((p) => this.summary(p, people)),
      owner: page.ownerType === 'user' ? (people.get(page.ownerId) ?? null) : null,
      members: members.map((m) => people.get(m.userId)).filter((p): p is CollabPerson => !!p),
      createdBy: people.get(page.createdById) ?? null,
      createdAt: page.createdAt.toISOString(),
    };
  }

  /** The meeting's notes page, created on first open (anyone in the meeting may open it). */
  async meetingNotes(me: string, meetingId: string): Promise<PageDetail> {
    const { m } = await this.meetings.access(me, meetingId);
    let page = await this.prisma.page.findFirst({ where: { ownerType: 'meeting', ownerId: meetingId, parentId: null } });
    if (!page) {
      page = await this.prisma.$transaction(async (tx) => {
        const created = await tx.page.create({ data: { ownerType: 'meeting', ownerId: meetingId, rootId: '', title: `Notes: ${m.title}`.slice(0, 200), createdById: me } });
        return tx.page.update({ where: { id: created.id }, data: { rootId: created.id } });
      });
    }
    return this.get(me, page.id);
  }

  // ------------------------------------------------------------------ writing

  async create(me: string, raw: CreatePageInput, ctx: Ctx): Promise<PageDetail> {
    await this.policies.assert(me, (p) => p.apps.pages, POLICY_MESSAGE);
    const input = createPageSchema.parse(raw);
    let data: Prisma.PageUncheckedCreateInput;
    if (input.parentId) {
      const { page: parent } = await this.require(me, input.parentId, 'edit');
      const siblings = await this.prisma.page.findMany({ where: { parentId: parent.id }, select: { position: true } });
      data = { ownerType: parent.ownerType, ownerId: parent.ownerId, rootId: parent.rootId, parentId: parent.id, title: input.title, position: this.next(siblings), createdById: me };
    } else if (input.channelId) {
      if (!canEdit(await this.libraries.roleFor(me, 'channel', input.channelId))) throw new ForbiddenException('You can’t add pages to this channel');
      const roots = await this.prisma.page.findMany({ where: { ownerType: 'channel', ownerId: input.channelId, parentId: null }, select: { position: true } });
      data = { ownerType: 'channel', ownerId: input.channelId, rootId: '', title: input.title, position: this.next(roots), createdById: me };
    } else {
      const roots = await this.prisma.page.findMany({ where: { ownerType: 'user', ownerId: me, parentId: null }, select: { position: true } });
      data = { ownerType: 'user', ownerId: me, rootId: '', title: input.title, position: this.next(roots), createdById: me };
    }
    const page = await this.prisma.$transaction(async (tx) => {
      const created = await tx.page.create({ data });
      if (created.rootId) return created;
      const memberIds = created.ownerType === 'user' ? await this.activeUsers(input.memberIds.filter((id) => id !== me)) : [];
      await tx.pageMember.createMany({ data: memberIds.map((userId) => ({ pageId: created.id, userId })) });
      return tx.page.update({ where: { id: created.id }, data: { rootId: created.id } });
    });
    this.audit.log({ actorId: me, action: 'page.create', targetType: 'page', targetId: page.id, meta: { ownerType: page.ownerType, ownerId: page.ownerId }, ip: ctx.ip });
    await this.changed(page);
    return this.get(me, page.id);
  }

  async update(me: string, id: string, input: UpdatePageInput): Promise<PageDetail> {
    const { page } = await this.require(me, id, 'edit');
    const data: Prisma.PageUncheckedUpdateInput = { title: input.title, icon: input.icon, position: input.position, updatedById: me };
    if (input.parentId !== undefined && input.parentId !== page.parentId) {
      // Roots of personal and meeting trees carry the sharing; only pages inside a tree (or channel pages) move.
      if (page.ownerType !== 'channel' && (page.id === page.rootId || input.parentId === null)) throw new BadRequestException('This page can’t be moved there');
      if (input.parentId) {
        const target = await this.prisma.page.findUnique({ where: { id: input.parentId } });
        if (!target || target.ownerType !== page.ownerType || target.ownerId !== page.ownerId) throw new BadRequestException('Pages can only move within the same place');
        const tree = await this.prisma.page.findMany({ where: { ownerType: page.ownerType, ownerId: page.ownerId }, select: { id: true, parentId: true } });
        if (wouldCycle(id, input.parentId, new Map(tree.map((p) => [p.id, p.parentId])))) throw new BadRequestException('A page can’t move under itself');
        data.rootId = target.rootId;
      } else {
        data.rootId = id;
      }
      data.parentId = input.parentId;
    }
    const updated = await this.prisma.page.update({ where: { id }, data });
    // Moving a subtree to another root: its descendants follow.
    if (data.rootId && data.rootId !== page.rootId) await this.reroot(id, data.rootId as string);
    if (input.title) await this.prisma.channelTab.updateMany({ where: { app: 'wiki', refId: id }, data: { title: input.title.slice(0, 60) } });
    await this.changed(updated);
    return this.get(me, id);
  }

  async remove(me: string, id: string, ctx: Ctx) {
    const { page, role } = await this.require(me, id, 'edit');
    if (page.ownerType === 'meeting' && page.id === page.rootId) throw new BadRequestException('Meeting notes can’t be deleted');
    if (page.ownerType === 'user' && page.id === page.rootId && role !== 'owner') throw new ForbiddenException('Only the owner can delete this page');
    const subtree = await this.subtreeIds(id);
    await this.prisma.page.delete({ where: { id } });
    for (const pid of subtree) this.collab.forget('page', pid);
    this.audit.log({ actorId: me, action: 'page.delete', targetType: 'page', targetId: id, meta: { title: page.title, pages: subtree.length }, ip: ctx.ip });
    await this.changed(page, subtree);
  }

  async addMembers(me: string, id: string, userIds: string[]): Promise<PageDetail> {
    const { page, role } = await this.require(me, id, 'read');
    if (page.ownerType !== 'user') throw new BadRequestException('Channel pages include everyone in the channel');
    if (role !== 'owner') throw new ForbiddenException('Only the owner can share this page');
    const ids = await this.activeUsers(userIds.filter((u) => u !== page.ownerId));
    await this.prisma.pageMember.createMany({ data: ids.map((userId) => ({ pageId: page.rootId, userId })), skipDuplicates: true });
    await this.changed(page, [], ids);
    return this.get(me, id);
  }

  async removeMember(me: string, id: string, userId: string) {
    const { page, role } = await this.require(me, id, 'read');
    if (page.ownerType !== 'user') throw new BadRequestException('Channel pages include everyone in the channel');
    if (userId !== me && role !== 'owner') throw new ForbiddenException('Only the owner can remove people');
    const audience = await this.audience(page);
    await this.prisma.pageMember.deleteMany({ where: { pageId: page.rootId, userId } });
    this.realtime.toUsers(audience, COLLAB_WS_EVENTS.changed, { kind: 'page', ids: [id] } satisfies CollabChangedEvent);
  }

  // ------------------------------------------------------------------ access

  async roleOf(userId: string, page: Page): Promise<CollabRole | null> {
    switch (page.ownerType) {
      case 'user': {
        const members = await this.prisma.pageMember.findMany({ where: { pageId: page.rootId }, select: { userId: true } });
        return collabRole({ userId, ownerType: 'user', ownerId: page.ownerId, memberIds: members.map((m) => m.userId) });
      }
      case 'channel':
        return collabRole({ userId, ownerType: 'channel', ownerId: page.ownerId, memberIds: [], channelRole: await this.libraries.roleFor(userId, 'channel', page.ownerId) });
      case 'meeting': {
        const meeting = await this.meetings.access(userId, page.ownerId).then((a) => ({ allowed: true, moderator: a.moderator })).catch(() => null);
        return collabRole({ userId, ownerType: 'meeting', ownerId: page.ownerId, memberIds: [], meeting });
      }
    }
  }

  private async require(me: string, id: string, action: 'read' | 'edit'): Promise<{ page: Page; role: CollabRole }> {
    const page = await this.prisma.page.findUnique({ where: { id } });
    const role = page ? await this.roleOf(me, page) : null;
    if (!page || !role) throw new NotFoundException('Page not found');
    if (action === 'edit' && !canEdit(role)) throw new ForbiddenException('This page is read-only');
    return { page, role };
  }

  private async audience(page: Page): Promise<string[]> {
    if (page.ownerType === 'channel') return this.libraries.audience('channel', page.ownerId);
    if (page.ownerType === 'meeting') return [];
    const members = await this.prisma.pageMember.findMany({ where: { pageId: page.rootId }, select: { userId: true } });
    return [page.ownerId, ...members.map((m) => m.userId)];
  }

  private async changed(page: Page, extraIds: string[] = [], extraUsers: string[] = []) {
    const audience = new Set([...(await this.audience(page)), ...extraUsers]);
    this.realtime.toUsers(audience, COLLAB_WS_EVENTS.changed, { kind: 'page', ids: [page.id, ...extraIds] } satisfies CollabChangedEvent);
  }

  // ------------------------------------------------------------------ helpers

  private async myChannelIds(me: string): Promise<string[]> {
    const memberships = await this.prisma.conversationMember.findMany({ where: { userId: me }, select: { conversationId: true } });
    const channels = await this.prisma.channel.findMany({
      where: { conversationId: { in: memberships.map((m) => m.conversationId) }, deletedAt: null, team: { deletedAt: null } },
      select: { id: true },
    });
    return channels.map((c) => c.id);
  }

  private async subtreeIds(id: string): Promise<string[]> {
    const out = [id];
    for (let frontier = [id]; frontier.length; ) {
      const kids = await this.prisma.page.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
      frontier = kids.map((k) => k.id);
      out.push(...frontier);
    }
    return out;
  }

  private async reroot(id: string, rootId: string) {
    const ids = await this.subtreeIds(id);
    await this.prisma.page.updateMany({ where: { id: { in: ids } }, data: { rootId } });
  }

  private next(siblings: { position: number }[]) {
    return siblings.reduce((max, s) => Math.max(max, s.position), 0) + 1024;
  }

  private async activeUsers(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, isActive: true, role: { not: 'guest' } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async locations(pages: { id: string; ownerType: Page['ownerType']; ownerId: string }[]): Promise<Map<string, PageLocation>> {
    const channelIds = [...new Set(pages.filter((p) => p.ownerType === 'channel').map((p) => p.ownerId))];
    const meetingIds = [...new Set(pages.filter((p) => p.ownerType === 'meeting').map((p) => p.ownerId))];
    const [channels, meetings] = await Promise.all([
      channelIds.length ? this.prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, team: { select: { name: true } } } }) : [],
      meetingIds.length ? this.prisma.meeting.findMany({ where: { id: { in: meetingIds } }, select: { id: true, title: true } }) : [],
    ]);
    const c = new Map(channels.map((x) => [x.id, { id: x.id, name: x.name, teamName: x.team.name }]));
    const m = new Map(meetings.map((x) => [x.id, x]));
    return new Map(pages.map((p) => [p.id, {
      ownerType: p.ownerType,
      channel: p.ownerType === 'channel' ? (c.get(p.ownerId) ?? null) : null,
      meeting: p.ownerType === 'meeting' ? (m.get(p.ownerId) ?? null) : null,
    }]));
  }

  private summary(p: SummaryRow, people: Map<string, CollabPerson>): PageSummary {
    return {
      id: p.id,
      title: p.title,
      icon: p.icon,
      parentId: p.parentId,
      rootId: p.rootId,
      position: p.position,
      excerpt: excerpt(p.text),
      updatedAt: p.updatedAt.toISOString(),
      updatedBy: (p.updatedById && people.get(p.updatedById)) || null,
    };
  }

  private async people(ids: (string | null | undefined)[]): Promise<Map<string, CollabPerson>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true, avatarKey: true } });
    return new Map(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, avatarUrl: avatarUrl(u) }]));
  }
}
