import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { List, ListItem, Prisma } from '@prisma/client';
import {
  CollabPerson, CollabRole, CreateListInput, createListSchema, ListColumn, ListDetail, ListItemInfo, ListItemInput, LISTS_WS_EVENTS,
  ListsChangedEvent, ListSummary, ListView, ListWithItems, UpdateListInput, updateListSchema,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { canEdit } from '../collab/collab.logic';
import { ChannelTabsService } from '../planner/channel-tabs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CellValue, checkColumns, normalizeRow, pruneValues, toCsv } from './lists.logic';
import { Ownership } from './ownership';

type Ctx = { ip?: string | null };
type ListRow = List & { members: { userId: string }[] };
const MAX_ITEMS = 5000;

/** Lists: custom-column tables owned by a person (shared with members) or a channel. */
@Injectable()
export class ListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
    private readonly ownership: Ownership,
    private readonly tabs: ChannelTabsService,
  ) {}

  async list(me: string): Promise<ListSummary[]> {
    const channelIds = await this.ownership.myChannelIds(me);
    const rows = await this.prisma.list.findMany({
      where: { OR: [{ ownerType: 'user', ownerId: me }, { ownerType: 'user', members: { some: { userId: me } } }, { ownerType: 'channel', ownerId: { in: channelIds } }] },
      include: { members: { select: { userId: true } }, _count: { select: { items: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const channels = await this.ownership.channels(rows.filter((r) => r.ownerType === 'channel').map((r) => r.ownerId));
    const out: ListSummary[] = [];
    for (const r of rows) {
      const role = await this.ownership.role(me, r, r.members.map((m) => m.userId));
      if (role) out.push(this.summary(r, role, r._count.items, channels));
    }
    return out;
  }

  async get(me: string, id: string): Promise<ListWithItems> {
    const { list, role } = await this.require(me, id, 'read');
    const items = await this.prisma.listItem.findMany({ where: { listId: id }, orderBy: { position: 'asc' }, take: MAX_ITEMS });
    const audience = await this.ownership.audience(list, list.members.map((m) => m.userId));
    const people = await this.ownership.people([...audience, ...items.flatMap((i) => [i.createdById, i.updatedById])]);
    return { list: await this.detail(list, role, items.length, audience, people), items: items.map((i) => this.item(i, people)) };
  }

  async create(me: string, raw: CreateListInput, ctx: Ctx): Promise<ListDetail> {
    await this.policies.assert(me, (p) => p.apps.lists, 'Your organization’s policy doesn’t allow Lists');
    const input = createListSchema.parse(raw);
    const owner = await this.ownership.placeFor(me, input.channelId);
    if (!owner) throw new ForbiddenException('You can’t add a list to this channel');
    const problem = checkColumns(input.columns);
    if (problem) throw new BadRequestException(problem);
    const memberIds = owner.ownerType === 'user' ? await this.ownership.activeUsers(input.memberIds.filter((u) => u !== me)) : [];
    const rows: Record<string, CellValue>[] = [];
    for (const raw of input.items) {
      const r = normalizeRow(input.columns, raw);
      if ('error' in r) throw new BadRequestException(r.error);
      rows.push(r.values);
    }
    const list = await this.prisma.list.create({
      data: {
        ...owner,
        title: input.title,
        description: input.description,
        columns: input.columns,
        createdById: me,
        members: { create: memberIds.map((userId) => ({ userId })) },
        items: { create: rows.map((values, i) => ({ values, position: (i + 1) * 1024, createdById: me })) },
      },
      include: { members: { select: { userId: true } } },
    });
    this.audit.log({ actorId: me, action: 'list.create', targetType: 'list', targetId: list.id, meta: owner, ip: ctx.ip });
    if (owner.ownerType === 'channel' && input.addTab) await this.tabs.add(me, owner.ownerId, { app: 'list', refId: list.id, title: list.title });
    await this.changed(list, memberIds);
    return (await this.get(me, list.id)).list;
  }

  async update(me: string, id: string, raw: UpdateListInput): Promise<ListDetail> {
    const { list } = await this.require(me, id, 'edit');
    const input = updateListSchema.parse(raw);
    const data: Prisma.ListUpdateInput = { title: input.title, description: input.description };
    if (input.columns) {
      const problem = checkColumns(input.columns);
      if (problem) throw new BadRequestException(problem);
      data.columns = input.columns;
    }
    if (input.views) data.views = input.views;
    await this.prisma.$transaction(async (tx) => {
      await tx.list.update({ where: { id }, data });
      // Changed columns: drop values that no longer fit (removed columns, removed choices, changed types).
      if (input.columns) {
        const items = await tx.listItem.findMany({ where: { listId: id }, select: { id: true, values: true } });
        for (const item of items) {
          const before = item.values as Record<string, CellValue>;
          const after = pruneValues(input.columns, before);
          if (JSON.stringify(after) !== JSON.stringify(before)) await tx.listItem.update({ where: { id: item.id }, data: { values: after } });
        }
      }
    });
    if (input.title) await this.tabs.renameFor('list', id, input.title);
    await this.changed(list);
    return (await this.get(me, id)).list;
  }

  async remove(me: string, id: string, ctx: Ctx) {
    const { list, role } = await this.require(me, id, 'edit');
    if (list.ownerType === 'user' && role !== 'owner') throw new ForbiddenException('Only the owner can delete this list');
    const audience = await this.ownership.audience(list, list.members.map((m) => m.userId));
    await this.prisma.list.delete({ where: { id } });
    await this.tabs.removeFor('list', id);
    this.audit.log({ actorId: me, action: 'list.delete', targetType: 'list', targetId: id, meta: { title: list.title }, ip: ctx.ip });
    this.realtime.toUsers(audience, LISTS_WS_EVENTS.listsChanged, { ids: [id] } satisfies ListsChangedEvent);
  }

  async addItem(me: string, id: string, input: ListItemInput): Promise<ListItemInfo> {
    const { list } = await this.require(me, id, 'edit');
    if ((await this.prisma.listItem.count({ where: { listId: id } })) >= MAX_ITEMS) throw new BadRequestException(`A list can have up to ${MAX_ITEMS} items`);
    const values = await this.normalize(list, input.values);
    const last = await this.prisma.listItem.findFirst({ where: { listId: id }, orderBy: { position: 'desc' }, select: { position: true } });
    const item = await this.prisma.listItem.create({ data: { listId: id, values, position: input.position ?? (last?.position ?? 0) + 1024, createdById: me } });
    await this.touch(list);
    return this.item(item, await this.ownership.people([me]));
  }

  /** Partial update: only the given columns change (inline grid edits send one cell). */
  async updateItem(me: string, itemId: string, input: ListItemInput): Promise<ListItemInfo> {
    const existing = await this.prisma.listItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Item not found');
    const { list } = await this.require(me, existing.listId, 'edit');
    const values = await this.normalize(list, { ...(existing.values as Record<string, unknown>), ...input.values });
    const item = await this.prisma.listItem.update({ where: { id: itemId }, data: { values, position: input.position, updatedById: me } });
    await this.touch(list);
    return this.item(item, await this.ownership.people([item.createdById, me]));
  }

  async removeItem(me: string, itemId: string) {
    const existing = await this.prisma.listItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Item not found');
    const { list } = await this.require(me, existing.listId, 'edit');
    await this.prisma.listItem.delete({ where: { id: itemId } });
    await this.touch(list);
  }

  async csv(me: string, id: string): Promise<{ title: string; csv: string }> {
    const { list } = await this.require(me, id, 'read');
    const columns = list.columns as ListColumn[];
    const items = await this.prisma.listItem.findMany({ where: { listId: id }, orderBy: { position: 'asc' }, take: MAX_ITEMS });
    const people = await this.ownership.people(items.flatMap((i) => columns.filter((c) => c.type === 'person').map((c) => (i.values as Record<string, CellValue>)[c.id] as string)));
    const rows = items.map((i) => {
      const v = i.values as Record<string, CellValue>;
      return columns.map((c) => (c.type === 'person' && v[c.id] ? (people.get(v[c.id] as string)?.displayName ?? '') : c.type === 'boolean' ? (v[c.id] ? 'Yes' : 'No') : v[c.id]));
    });
    return { title: list.title, csv: toCsv(columns.map((c) => c.name), rows) };
  }

  async addMembers(me: string, id: string, userIds: string[]): Promise<ListDetail> {
    const { list, role } = await this.require(me, id, 'read');
    if (list.ownerType !== 'user') throw new BadRequestException('Channel lists include everyone in the channel');
    if (role !== 'owner') throw new ForbiddenException('Only the owner can share this list');
    const ids = await this.ownership.activeUsers(userIds.filter((u) => u !== list.ownerId));
    await this.prisma.listMember.createMany({ data: ids.map((userId) => ({ listId: id, userId })), skipDuplicates: true });
    await this.changed(list, ids);
    return (await this.get(me, id)).list;
  }

  async removeMember(me: string, id: string, userId: string) {
    const { list, role } = await this.require(me, id, 'read');
    if (list.ownerType !== 'user') throw new BadRequestException('Channel lists include everyone in the channel');
    if (userId !== me && role !== 'owner') throw new ForbiddenException('Only the owner can remove people');
    if (userId === list.ownerId) throw new BadRequestException('The owner can’t leave their own list');
    const audience = await this.ownership.audience(list, list.members.map((m) => m.userId));
    await this.prisma.listMember.deleteMany({ where: { listId: id, userId } });
    this.realtime.toUsers(audience, LISTS_WS_EVENTS.listsChanged, { ids: [id] } satisfies ListsChangedEvent);
  }

  // ------------------------------------------------------------------ helpers

  private async require(me: string, id: string, action: 'read' | 'edit'): Promise<{ list: ListRow; role: CollabRole }> {
    const list = await this.prisma.list.findUnique({ where: { id }, include: { members: { select: { userId: true } } } });
    const role = list ? await this.ownership.role(me, list, list.members.map((m) => m.userId)) : null;
    if (!list || !role) throw new NotFoundException('List not found');
    if (action === 'edit' && !canEdit(role)) throw new ForbiddenException('This list is read-only');
    return { list, role };
  }

  private async normalize(list: ListRow, raw: Record<string, unknown>) {
    const columns = list.columns as ListColumn[];
    // Person columns only accept people who can open the list.
    const people = columns.some((c) => c.type === 'person') ? new Set(await this.ownership.audience(list, list.members.map((m) => m.userId))) : undefined;
    const r = normalizeRow(columns, raw, people);
    if ('error' in r) throw new BadRequestException(r.error);
    return r.values;
  }

  private async touch(list: ListRow) {
    await this.prisma.list.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
    await this.changed(list);
  }

  private async changed(list: ListRow, extra: string[] = []) {
    const audience = new Set([...(await this.ownership.audience(list, list.members.map((m) => m.userId))), ...extra]);
    this.realtime.toUsers(audience, LISTS_WS_EVENTS.listsChanged, { ids: [list.id] } satisfies ListsChangedEvent);
  }

  private summary(l: List, role: CollabRole, itemCount: number, channels: Map<string, ListSummary['channel'] & object>): ListSummary {
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      ownerType: l.ownerType,
      channel: l.ownerType === 'channel' ? (channels.get(l.ownerId) ?? null) : null,
      role,
      itemCount,
      updatedAt: l.updatedAt.toISOString(),
    };
  }

  private async detail(l: ListRow, role: CollabRole, itemCount: number, audience: string[], people: Map<string, CollabPerson>): Promise<ListDetail> {
    const channels = await this.ownership.channels(l.ownerType === 'channel' ? [l.ownerId] : []);
    const byName = (a: CollabPerson, b: CollabPerson) => a.displayName.localeCompare(b.displayName);
    return {
      ...this.summary(l, role, itemCount, channels),
      columns: l.columns as ListColumn[],
      views: l.views as ListView[],
      owner: l.ownerType === 'user' ? (people.get(l.ownerId) ?? null) : null,
      members: l.members.map((m) => people.get(m.userId)).filter((p): p is CollabPerson => !!p).sort(byName),
      people: audience.map((u) => people.get(u)).filter((p): p is CollabPerson => !!p).sort(byName),
    };
  }

  private item(i: ListItem, people: Map<string, CollabPerson>): ListItemInfo {
    return {
      id: i.id,
      values: i.values as Record<string, CellValue>,
      position: i.position,
      createdBy: people.get(i.createdById) ?? null,
      updatedBy: (i.updatedById && people.get(i.updatedById)) || null,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }
}
