import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityItem, AddMembersInput, ConversationInfo, CreateConversationInput, extractMentionIds, MAX_GROUP_MEMBERS,
  MemberSettingsInput, MessageInfo, MessagePage, ReactionEvent, ReadEvent, SendMessageInput, toPlainText, WS_EVENTS,
} from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../infra/storage';
import { PresenceService } from '../presence/presence.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MESSAGE_INCLUDE, summarizeReactions, toMessageInfo, toUserSummary } from './chat.mapper';

const USER_SELECT = { id: true, displayName: true, avatarKey: true, jobTitle: true } as const;

const CONVERSATION_INCLUDE = {
  members: { include: { user: { select: USER_SELECT } }, orderBy: { joinedAt: 'asc' } },
  messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, include: MESSAGE_INCLUDE },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
  ) {}

  // ------------------------------------------------------------------ conversations

  async list(me: string): Promise<ConversationInfo[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { members: { some: { userId: me } } },
      include: CONVERSATION_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return this.present(rows, me);
  }

  async get(me: string, id: string): Promise<ConversationInfo> {
    const row = await this.prisma.conversation.findFirst({
      where: { id, members: { some: { userId: me } } },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) throw new NotFoundException('Chat not found');
    return (await this.present([row], me))[0];
  }

  async create(me: string, input: CreateConversationInput): Promise<ConversationInfo> {
    if (input.type === 'self' || (input.type === 'direct' && input.userId === me)) {
      return this.findOrCreateDirect(me, me, `self:${me}`, 'self');
    }
    if (input.type === 'direct') {
      await this.assertActiveUsers([input.userId]);
      return this.findOrCreateDirect(me, input.userId, [me, input.userId].sort().join(':'), 'direct');
    }

    const others = [...new Set(input.userIds)].filter((id) => id !== me);
    if (!others.length) throw new BadRequestException('Add at least one other person');
    if (others.length + 1 > MAX_GROUP_MEMBERS) throw new BadRequestException(`Group chats are limited to ${MAX_GROUP_MEMBERS} people`);
    await this.assertActiveUsers(others);
    const conversation = await this.prisma.conversation.create({
      data: {
        type: 'group',
        title: input.title || null,
        createdById: me,
        members: { create: [me, ...others].map((userId) => ({ userId, lastReadAt: new Date() })) },
      },
    });
    await this.systemMessage(conversation.id, me, `{actor} created the chat${input.title ? ` "${input.title}"` : ''}.`);
    return this.emitConversation(conversation.id, me);
  }

  async rename(me: string, id: string, title: string | null): Promise<ConversationInfo> {
    const conversation = await this.requireMembership(me, id);
    if (conversation.type !== 'group') throw new BadRequestException('Only group chats can be renamed');
    await this.prisma.conversation.update({ where: { id }, data: { title: title || null } });
    await this.systemMessage(id, me, title ? `{actor} renamed the chat to "${title}".` : '{actor} removed the chat name.');
    return this.emitConversation(id, me);
  }

  async addMembers(me: string, id: string, input: AddMembersInput): Promise<ConversationInfo> {
    const conversation = await this.requireMembership(me, id);
    if (conversation.type !== 'group') throw new BadRequestException('Start a new group chat to add people to a one-on-one chat');
    const existing = new Set(conversation.members.map((m) => m.userId));
    const added = [...new Set(input.userIds)].filter((uid) => !existing.has(uid));
    if (!added.length) return this.get(me, id);
    if (existing.size + added.length > MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`Group chats are limited to ${MAX_GROUP_MEMBERS} people`);
    }
    const users = await this.assertActiveUsers(added);
    const now = new Date();
    await this.prisma.conversationMember.createMany({
      data: added.map((userId) => ({ conversationId: id, userId, lastReadAt: now, historySince: input.shareHistory ? null : now })),
    });
    const names = users.map((u) => u.displayName).join(', ');
    await this.systemMessage(id, me, `{actor} added ${names} to the chat.`);
    return this.emitConversation(id, me);
  }

  async removeMember(me: string, id: string, userId: string): Promise<void> {
    const conversation = await this.requireMembership(me, id);
    if (conversation.type !== 'group') throw new BadRequestException('You can only leave group chats');
    const target = conversation.members.find((m) => m.userId === userId);
    if (!target) throw new NotFoundException('Not a member of this chat');
    await this.prisma.conversationMember.delete({ where: { conversationId_userId: { conversationId: id, userId } } });
    const name = (await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }))?.displayName;
    await this.systemMessage(id, me, userId === me ? '{actor} left the chat.' : `{actor} removed ${name} from the chat.`);
    // The removed person's client drops the chat on this event.
    this.realtime.toUsers([userId], WS_EVENTS.conversationUpdated, { id, removed: true });
    if (conversation.members.length > 1) await this.emitConversation(id, me);
  }

  async updateMySettings(me: string, id: string, input: MemberSettingsInput): Promise<ConversationInfo> {
    await this.requireMembership(me, id);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: me } },
      data: input,
    });
    const info = await this.get(me, id);
    this.realtime.toUsers([me], WS_EVENTS.conversationUpdated, info);
    return info;
  }

  async markRead(me: string, id: string): Promise<ReadEvent> {
    const conversation = await this.requireMembership(me, id);
    const lastReadAt = new Date();
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: me } },
      data: { lastReadAt },
    });
    const event: ReadEvent = { conversationId: id, userId: me, lastReadAt: lastReadAt.toISOString() };
    this.realtime.toUsers(conversation.members.map((m) => m.userId), WS_EVENTS.readUpdated, event);
    return event;
  }

  // ------------------------------------------------------------------ messages

  async messages(me: string, id: string, before?: string, limit = 50): Promise<MessagePage> {
    const conversation = await this.requireMembership(me, id);
    const since = conversation.members.find((m) => m.userId === me)?.historySince;
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      take: take + 1,
      include: MESSAGE_INCLUDE,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take).reverse();
    return {
      messages: page.map((m) => toMessageInfo(m, this.storage)),
      nextCursor: hasMore ? page[0].id : null,
    };
  }

  async send(me: string, id: string, input: SendMessageInput & { importance: 'normal' | 'important' | 'urgent'; attachmentIds: string[] }): Promise<MessageInfo> {
    const conversation = await this.requireMembership(me, id);
    const memberIds = conversation.members.map((m) => m.userId);
    const body = (input.body ?? '').trim();

    let parentAuthorId: string | null = null;
    if (input.parentId) {
      const parent = await this.prisma.message.findFirst({ where: { id: input.parentId, conversationId: id } });
      if (!parent) throw new BadRequestException('The message you replied to was not found');
      parentAuthorId = parent.authorId;
    }

    if (input.attachmentIds.length) {
      const owned = await this.prisma.attachment.count({
        where: { id: { in: input.attachmentIds }, conversationId: id, uploaderId: me, messageId: null },
      });
      if (owned !== new Set(input.attachmentIds).size) throw new BadRequestException('Invalid attachment');
    }

    const mentionIds = extractMentionIds(body).filter((uid) => memberIds.includes(uid));
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: id,
          authorId: me,
          parentId: input.parentId,
          body,
          importance: input.importance,
          mentions: { create: mentionIds.map((userId) => ({ userId })) },
        },
      });
      if (input.attachmentIds.length) {
        await tx.attachment.updateMany({ where: { id: { in: input.attachmentIds } }, data: { messageId: created.id } });
      }
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: created.createdAt } });
      await tx.conversationMember.updateMany({ where: { conversationId: id, hidden: true }, data: { hidden: false } });
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: me } },
        data: { lastReadAt: created.createdAt },
      });
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: MESSAGE_INCLUDE });
    });

    const info = toMessageInfo(message, this.storage, input.clientId);
    this.realtime.toUsers(memberIds, WS_EVENTS.messageNew, info);

    const preview = toPlainText(body).slice(0, 200) || (input.attachmentIds.length ? 'Sent a file' : '');
    const notify = new Map<string, 'mention' | 'reply'>();
    for (const uid of mentionIds) if (uid !== me) notify.set(uid, 'mention');
    if (parentAuthorId && parentAuthorId !== me && !notify.has(parentAuthorId)) notify.set(parentAuthorId, 'reply');
    await Promise.all([...notify].map(([userId, type]) => this.notify(userId, type, me, id, message.id, preview)));
    return info;
  }

  async edit(me: string, messageId: string, body: string): Promise<MessageInfo> {
    const message = await this.ownMessage(me, messageId);
    const members = await this.memberIds(message.conversationId);
    const mentionIds = extractMentionIds(body).filter((uid) => members.includes(uid));
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        body,
        editedAt: new Date(),
        mentions: { deleteMany: {}, create: mentionIds.map((userId) => ({ userId })) },
      },
      include: MESSAGE_INCLUDE,
    });
    const info = toMessageInfo(updated, this.storage);
    this.realtime.toUsers(members, WS_EVENTS.messageUpdated, info);
    return info;
  }

  async remove(me: string, messageId: string): Promise<MessageInfo> {
    const message = await this.ownMessage(me, messageId);
    const attachments = await this.prisma.attachment.findMany({ where: { messageId } });
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: '', reactions: { deleteMany: {} }, mentions: { deleteMany: {} } },
      include: MESSAGE_INCLUDE,
    });
    await this.prisma.attachment.deleteMany({ where: { messageId } });
    await Promise.all(attachments.map((a) => this.storage.remove(a.storageKey)));
    const info = toMessageInfo(updated, this.storage);
    this.realtime.toUsers(await this.memberIds(message.conversationId), WS_EVENTS.messageUpdated, info);
    return info;
  }

  async react(me: string, messageId: string, emoji: string, add: boolean): Promise<ReactionEvent> {
    if (!emoji || [...emoji].length > 8 || /[\s<>]/.test(emoji)) throw new BadRequestException('Invalid reaction');
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    const members = await this.memberIds(message.conversationId);
    if (!members.includes(me)) throw new NotFoundException('Message not found');

    if (add) {
      await this.prisma.reaction.upsert({
        where: { messageId_userId_emoji: { messageId, userId: me, emoji } },
        create: { messageId, userId: me, emoji },
        update: {},
      });
      if (message.authorId && message.authorId !== me) {
        await this.notify(message.authorId, 'reaction', me, message.conversationId, messageId, `${emoji} ${toPlainText(message.body).slice(0, 160)}`);
      }
    } else {
      await this.prisma.reaction.deleteMany({ where: { messageId, userId: me, emoji } });
    }
    const rows = await this.prisma.reaction.findMany({ where: { messageId }, orderBy: { createdAt: 'asc' } });
    const event: ReactionEvent = { conversationId: message.conversationId, messageId, reactions: summarizeReactions(rows) };
    this.realtime.toUsers(members, WS_EVENTS.reactionChanged, event);
    return event;
  }

  // ------------------------------------------------------------------ attachments

  async addAttachment(me: string, conversationId: string, file: { originalname: string; mimetype: string; size: number }, store: (key: string) => Promise<void>) {
    await this.requireMembership(me, conversationId);
    const key = `attachments/${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await store(key);
    const attachment = await this.prisma.attachment.create({
      data: {
        conversationId,
        uploaderId: me,
        fileName: file.originalname.slice(0, 255) || 'file',
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        storageKey: key,
      },
    });
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/attachments/${attachment.id}/content?${this.storage.sign(attachment.id)}`,
    };
  }

  // ------------------------------------------------------------------ activity

  async activity(me: string, take = 50): Promise<ActivityItem[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId: me },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
      include: {
        actor: { select: { id: true, displayName: true, avatarKey: true } },
        conversation: { select: { id: true, title: true, type: true } },
      },
    });
    return rows.map((n) => this.toActivity(n));
  }

  async markActivityRead(me: string, ids?: string[]) {
    await this.prisma.notification.updateMany({
      where: { userId: me, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
  }

  // ------------------------------------------------------------------ helpers

  private async notify(userId: string, type: ActivityItem['type'], actorId: string, conversationId: string, messageId: string, preview: string) {
    const row = await this.prisma.notification.create({
      data: { userId, type, actorId, conversationId, messageId, preview },
      include: {
        actor: { select: { id: true, displayName: true, avatarKey: true } },
        conversation: { select: { id: true, title: true, type: true } },
      },
    });
    this.realtime.toUsers([userId], WS_EVENTS.notificationNew, this.toActivity(row));
  }

  private toActivity(n: {
    id: string;
    type: string;
    actor: { id: string; displayName: string; avatarKey: string | null } | null;
    conversation: { id: string; title: string | null; type: string } | null;
    messageId: string | null;
    preview: string | null;
    readAt: Date | null;
    createdAt: Date;
  }): ActivityItem {
    return {
      id: n.id,
      type: n.type as ActivityItem['type'],
      actor: n.actor
        ? { id: n.actor.id, displayName: n.actor.displayName, avatarUrl: n.actor.avatarKey ? `/api/users/${n.actor.id}/avatar` : null }
        : null,
      conversationId: n.conversation?.id ?? null,
      conversationTitle: n.conversation?.title ?? (n.conversation?.type === 'direct' ? 'Chat' : null),
      messageId: n.messageId,
      preview: n.preview,
      read: !!n.readAt,
      createdAt: n.createdAt.toISOString(),
    };
  }

  private async findOrCreateDirect(me: string, other: string, directKey: string, type: 'direct' | 'self') {
    let conversation = await this.prisma.conversation.findUnique({ where: { directKey } });
    if (!conversation) {
      try {
        conversation = await this.prisma.conversation.create({
          data: {
            type,
            directKey,
            createdById: me,
            members: { create: [...new Set([me, other])].map((userId) => ({ userId, lastReadAt: new Date() })) },
          },
        });
      } catch (e) {
        // Both people opened the chat at the same moment; use the one that won.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { directKey } });
      }
    }
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId: me } },
      data: { hidden: false },
    });
    return this.get(me, conversation.id);
  }

  /** System messages use `{actor}` as a placeholder for the acting user's name. */
  private async systemMessage(conversationId: string, actorId: string, template: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
    const message = await this.prisma.message.create({
      data: { conversationId, authorId: actorId, type: 'system', body: template.replace('{actor}', actor?.displayName ?? 'Someone') },
      include: MESSAGE_INCLUDE,
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
    this.realtime.toUsers(await this.memberIds(conversationId), WS_EVENTS.messageNew, toMessageInfo(message, this.storage));
  }

  /** Sends each member their own view of the conversation (unread counts and settings differ per person). */
  private async emitConversation(id: string, me: string): Promise<ConversationInfo> {
    const row = await this.prisma.conversation.findUniqueOrThrow({ where: { id }, include: CONVERSATION_INCLUDE });
    const memberIds = row.members.map((m) => m.userId);
    await Promise.all(
      memberIds.map(async (uid) => {
        const [info] = await this.present([row], uid);
        this.realtime.toUsers([uid], WS_EVENTS.conversationUpdated, info);
      }),
    );
    return (await this.present([row], me))[0];
  }

  private async present(rows: ConversationRow[], me: string): Promise<ConversationInfo[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const unreadRows = await this.prisma.$queryRaw<{ conversationId: string; unread: number }[]>`
      SELECT cm."conversationId", COUNT(m.id)::int AS unread
      FROM "ConversationMember" cm
      JOIN "Message" m ON m."conversationId" = cm."conversationId"
        AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
        AND m."authorId" IS DISTINCT FROM cm."userId"
        AND m."deletedAt" IS NULL
        AND m."type" = 'text'
      WHERE cm."userId" = ${me} AND cm."conversationId" IN (${Prisma.join(ids)})
      GROUP BY cm."conversationId"`;
    const unread = new Map(unreadRows.map((r) => [r.conversationId, r.unread]));
    const presence = await this.presence.getMany(rows.flatMap((r) => r.members.map((m) => m.userId)));

    return rows.map((r) => {
      const mine = r.members.find((m) => m.userId === me);
      const last = r.messages[0];
      const visibleLast = last && (!mine?.historySince || last.createdAt >= mine.historySince) ? last : null;
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        members: r.members.map((m) => ({
          user: toUserSummary(m.user, presence.get(m.userId)?.status ?? 'offline'),
          lastReadAt: m.lastReadAt?.toISOString() ?? null,
        })),
        lastMessage: visibleLast ? toMessageInfo(visibleLast, this.storage) : null,
        lastMessageAt: r.lastMessageAt.toISOString(),
        unread: unread.get(r.id) ?? 0,
        muted: mine?.muted ?? false,
        pinned: mine?.pinned ?? false,
        hidden: mine?.hidden ?? false,
      };
    });
  }

  private async requireMembership(me: string, id: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id }, include: { members: true } });
    if (!conversation || !conversation.members.some((m) => m.userId === me)) throw new NotFoundException('Chat not found');
    return conversation;
  }

  private async memberIds(conversationId: string) {
    const rows = await this.prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private async ownMessage(me: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (message.authorId !== me || message.type !== 'text') throw new ForbiddenException('You can only change your own messages');
    return message;
  }

  private async assertActiveUsers(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, displayName: true } });
    if (users.length !== new Set(ids).size) throw new BadRequestException('Some people could not be found');
    return users;
  }
}
