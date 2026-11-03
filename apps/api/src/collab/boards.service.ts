import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Board } from '@prisma/client';
import {
  BoardDetail, BoardSummary, COLLAB_WS_EVENTS, CollabChangedEvent, CollabPerson, CollabRole, CreateBoardInput, createBoardSchema,
  UpdateBoardInput,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { FileLibraries } from '../files/file-libraries';
import { ChannelTabsService } from '../planner/channel-tabs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { avatarUrl } from '../users/users.mapper';
import { CollabService } from './collab.service';
import { canEdit, collabRole } from './collab.logic';

type Ctx = { ip?: string | null };
const POLICY_MESSAGE = 'Your organization’s policy doesn’t allow whiteboards';

/**
 * Whiteboard app: standalone tldraw boards owned by a person (shared with members) or a channel. The tldraw records
 * live in a Yjs map synced by CollabService, exactly like the meeting whiteboard, which the list also shows.
 */
@Injectable()
export class BoardsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
    private readonly libraries: FileLibraries,
    private readonly tabs: ChannelTabsService,
    private readonly collab: CollabService,
  ) {}

  onModuleInit() {
    this.collab.register({
      kind: 'board',
      access: async (userId, id) => {
        const board = await this.prisma.board.findUnique({ where: { id } });
        return board ? this.roleOf(userId, board) : null;
      },
      load: async (id) => {
        const row = await this.prisma.board.findUnique({ where: { id }, select: { state: true } });
        return row?.state ? new Uint8Array(row.state) : null;
      },
      save: async (id, state, _doc, editorId) => {
        const board = await this.prisma.board.update({ where: { id }, data: { state: Buffer.from(state), updatedById: editorId ?? undefined } }).catch(() => null);
        if (board) await this.changed(board);
      },
    });
  }

  async list(me: string): Promise<BoardSummary[]> {
    const memberships = await this.prisma.conversationMember.findMany({ where: { userId: me }, select: { conversationId: true } });
    const channels = await this.prisma.channel.findMany({
      where: { conversationId: { in: memberships.map((m) => m.conversationId) }, deletedAt: null, team: { deletedAt: null } },
      select: { id: true },
    });
    const boards = await this.prisma.board.findMany({
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
    // Meeting whiteboards someone drew on, for meetings the person organizes or is invited to.
    const meetingBoards = await this.prisma.meetingWhiteboard.findMany({
      where: { meeting: { cancelledAt: null, OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }] } },
      select: { meetingId: true, updatedAt: true, meeting: { select: { title: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const people = await this.people(boards.map((b) => b.updatedById));
    const out: BoardSummary[] = [];
    for (const b of boards) {
      const role = await this.roleOf(me, b, b.members.map((m) => m.userId));
      if (role) out.push(await this.summary(b, role, people));
    }
    for (const m of meetingBoards) {
      out.push({ id: m.meetingId, title: m.meeting.title, ownerType: 'meeting', channel: null, role: 'edit', updatedAt: m.updatedAt.toISOString(), updatedBy: null });
    }
    return out;
  }

  async get(me: string, id: string): Promise<BoardDetail> {
    const { board, role } = await this.require(me, id, 'read');
    const members = board.ownerType === 'user' ? await this.prisma.boardMember.findMany({ where: { boardId: id }, select: { userId: true } }) : [];
    const people = await this.people([board.updatedById, board.ownerType === 'user' ? board.ownerId : null, ...members.map((m) => m.userId)]);
    return {
      ...(await this.summary(board, role, people)),
      owner: board.ownerType === 'user' ? (people.get(board.ownerId) ?? null) : null,
      members: members.map((m) => people.get(m.userId)).filter((p): p is CollabPerson => !!p),
    };
  }

  async create(me: string, raw: CreateBoardInput, ctx: Ctx): Promise<BoardDetail> {
    await this.policies.assert(me, (p) => p.apps.whiteboard, POLICY_MESSAGE);
    const input = createBoardSchema.parse(raw);
    let ownerType: Board['ownerType'] = 'user';
    let ownerId = me;
    if (input.channelId) {
      if (!canEdit(await this.libraries.roleFor(me, 'channel', input.channelId))) throw new ForbiddenException('You can’t add a whiteboard to this channel');
      ownerType = 'channel';
      ownerId = input.channelId;
    }
    const memberIds = ownerType === 'user' ? await this.activeUsers(input.memberIds.filter((id) => id !== me)) : [];
    const board = await this.prisma.board.create({
      data: { ownerType, ownerId, title: input.title, createdById: me, members: { create: memberIds.map((userId) => ({ userId })) } },
    });
    this.audit.log({ actorId: me, action: 'board.create', targetType: 'board', targetId: board.id, meta: { ownerType, ownerId }, ip: ctx.ip });
    if (ownerType === 'channel' && input.addTab) await this.tabs.add(me, ownerId, { app: 'whiteboard', refId: board.id, title: board.title });
    await this.changed(board, memberIds);
    return this.get(me, board.id);
  }

  async update(me: string, id: string, input: UpdateBoardInput): Promise<BoardDetail> {
    await this.require(me, id, 'edit');
    const board = await this.prisma.board.update({ where: { id }, data: { title: input.title, updatedById: me } });
    if (input.title) await this.tabs.renameFor('whiteboard', id, input.title);
    await this.changed(board);
    return this.get(me, id);
  }

  async remove(me: string, id: string, ctx: Ctx) {
    const { board, role } = await this.require(me, id, 'edit');
    if (board.ownerType === 'user' && role !== 'owner') throw new ForbiddenException('Only the owner can delete this whiteboard');
    const audience = await this.audience(board);
    await this.prisma.board.delete({ where: { id } });
    this.collab.forget('board', id);
    await this.tabs.removeFor('whiteboard', id);
    this.audit.log({ actorId: me, action: 'board.delete', targetType: 'board', targetId: id, meta: { title: board.title }, ip: ctx.ip });
    this.realtime.toUsers(audience, COLLAB_WS_EVENTS.changed, { kind: 'board', ids: [id] } satisfies CollabChangedEvent);
  }

  async addMembers(me: string, id: string, userIds: string[]): Promise<BoardDetail> {
    const { board, role } = await this.require(me, id, 'read');
    if (board.ownerType !== 'user') throw new BadRequestException('Channel whiteboards include everyone in the channel');
    if (role !== 'owner') throw new ForbiddenException('Only the owner can share this whiteboard');
    const ids = await this.activeUsers(userIds.filter((u) => u !== board.ownerId));
    await this.prisma.boardMember.createMany({ data: ids.map((userId) => ({ boardId: id, userId })), skipDuplicates: true });
    await this.changed(board, ids);
    return this.get(me, id);
  }

  async removeMember(me: string, id: string, userId: string) {
    const { board, role } = await this.require(me, id, 'read');
    if (board.ownerType !== 'user') throw new BadRequestException('Channel whiteboards include everyone in the channel');
    if (userId !== me && role !== 'owner') throw new ForbiddenException('Only the owner can remove people');
    if (userId === board.ownerId) throw new BadRequestException('The owner can’t leave their own whiteboard');
    const audience = await this.audience(board);
    await this.prisma.boardMember.deleteMany({ where: { boardId: id, userId } });
    this.realtime.toUsers(audience, COLLAB_WS_EVENTS.changed, { kind: 'board', ids: [id] } satisfies CollabChangedEvent);
  }

  // ------------------------------------------------------------------ helpers

  private async roleOf(userId: string, board: Board, memberIds?: string[]): Promise<CollabRole | null> {
    if (board.ownerType === 'channel') {
      return collabRole({ userId, ownerType: 'channel', ownerId: board.ownerId, memberIds: [], channelRole: await this.libraries.roleFor(userId, 'channel', board.ownerId) });
    }
    const members = memberIds ?? (await this.prisma.boardMember.findMany({ where: { boardId: board.id }, select: { userId: true } })).map((m) => m.userId);
    return collabRole({ userId, ownerType: 'user', ownerId: board.ownerId, memberIds: members });
  }

  private async require(me: string, id: string, action: 'read' | 'edit'): Promise<{ board: Board; role: CollabRole }> {
    const board = await this.prisma.board.findUnique({ where: { id } });
    const role = board ? await this.roleOf(me, board) : null;
    if (!board || !role) throw new NotFoundException('Whiteboard not found');
    if (action === 'edit' && !canEdit(role)) throw new ForbiddenException('This whiteboard is read-only');
    return { board, role };
  }

  private async audience(board: Board): Promise<string[]> {
    if (board.ownerType === 'channel') return this.libraries.audience('channel', board.ownerId);
    const members = await this.prisma.boardMember.findMany({ where: { boardId: board.id }, select: { userId: true } });
    return [board.ownerId, ...members.map((m) => m.userId)];
  }

  private async changed(board: Board, extra: string[] = []) {
    const audience = new Set([...(await this.audience(board)), ...extra]);
    this.realtime.toUsers(audience, COLLAB_WS_EVENTS.changed, { kind: 'board', ids: [board.id] } satisfies CollabChangedEvent);
  }

  private async summary(b: Board, role: CollabRole, people: Map<string, CollabPerson>): Promise<BoardSummary> {
    let channel: BoardSummary['channel'] = null;
    if (b.ownerType === 'channel') {
      const c = await this.prisma.channel.findUnique({ where: { id: b.ownerId }, select: { id: true, name: true, team: { select: { name: true } } } });
      if (c) channel = { id: c.id, name: c.name, teamName: c.team.name };
    }
    return { id: b.id, title: b.title, ownerType: b.ownerType, channel, role, updatedAt: b.updatedAt.toISOString(), updatedBy: (b.updatedById && people.get(b.updatedById)) || null };
  }

  private async activeUsers(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, isActive: true, role: { not: 'guest' } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async people(ids: (string | null | undefined)[]): Promise<Map<string, CollabPerson>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true, avatarKey: true } });
    return new Map(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, avatarUrl: avatarUrl(u) }]));
  }
}
