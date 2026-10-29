import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityItem, AddMembersInput, ChatSectionInfo, ConversationInfo, CreateConversationInput, extractMentionIds,
  MAX_GROUP_MEMBERS, MemberSettingsInput, MessageInfo, MessagePage, PollInput, ReactionEvent, ReadEvent,
  SavedMessageInfo, ScheduledMessageInfo, toPlainText, WS_EVENTS,
} from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../infra/storage';
import { isOutOfOffice, PresenceService } from '../presence/presence.service';
import { RealtimeService } from '../realtime/realtime.service';
import { avatarUrl, MESSAGE_INCLUDE, summarizeReactions, toMessageInfo, toUserSummary } from './chat.mapper';
import { firstUrl, LinkPreviewService } from './link-preview.service';

const USER_SELECT = { id: true, displayName: true, avatarKey: true, jobTitle: true } as const;

const CONVERSATION_INCLUDE = {
  members: { include: { user: { select: USER_SELECT } }, orderBy: { joinedAt: 'asc' } },
  messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, include: MESSAGE_INCLUDE },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

type Importance = 'normal' | 'important' | 'urgent';

/** Parsed send body (zod defaults applied). */
export interface SendInput {
  body?: string;
  parentId?: string;
  importance: Importance;
  attachmentIds: string[];
  poll?: PollInput;
  clientId?: string;
}

const MIN_SCHEDULE_MS = 30_000;
const MAX_SCHEDULE_MS = 90 * 24 * 60 * 60 * 1000;
const OOO_REPLY_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly linkPreviews: LinkPreviewService,
  ) {}

  // ------------------------------------------------------------------ conversations

  async list(me: string): Promise<ConversationInfo[]> {
    const rows = await this.prisma.conversation.findMany({
      // Channel conversations belong to Teams (Phase 2) and are listed there.
      where: { members: { some: { userId: me } }, type: { not: 'channel' } },
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
    // Messages the removed person scheduled here would fail to send; drop them now.
    await this.prisma.scheduledMessage.deleteMany({ where: { conversationId: id, authorId: userId } });
    const name = (await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }))?.displayName;
    await this.systemMessage(id, me, userId === me ? '{actor} left the chat.' : `{actor} removed ${name} from the chat.`);
    // The removed person's client drops the chat on this event.
    this.realtime.toUsers([userId], WS_EVENTS.conversationUpdated, { id, removed: true });
    if (conversation.members.length > 1) await this.emitConversation(id, me);
  }

  async updateMySettings(me: string, id: string, input: MemberSettingsInput): Promise<ConversationInfo> {
    await this.requireMembership(me, id);
    if (input.sectionId) {
      const section = await this.prisma.chatSection.findFirst({ where: { id: input.sectionId, userId: me } });
      if (!section) throw new NotFoundException('Section not found');
    }
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: me } },
      data: input,
    });
    return this.emitToMe(me, id);
  }

  async markRead(me: string, id: string): Promise<ReadEvent> {
    const conversation = await this.requireMembership(me, id);
    const lastReadAt = new Date();
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: me } },
      data: { lastReadAt, markedUnread: false },
    });
    const event: ReadEvent = { conversationId: id, userId: me, lastReadAt: lastReadAt.toISOString() };
    this.realtime.toUsers(conversation.members.map((m) => m.userId), WS_EVENTS.readUpdated, event);
    return event;
  }

  /** Marks a whole chat, or everything from one message on, as unread for me only. */
  async markUnread(me: string, id: string, messageId?: string): Promise<ConversationInfo> {
    await this.requireMembership(me, id);
    const where = { conversationId_userId: { conversationId: id, userId: me } };
    if (messageId) {
      const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId: id } });
      if (!message) throw new NotFoundException('Message not found');
      await this.prisma.conversationMember.update({ where, data: { lastReadAt: new Date(message.createdAt.getTime() - 1) } });
    } else {
      await this.prisma.conversationMember.update({ where, data: { markedUnread: true } });
    }
    return this.emitToMe(me, id);
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

  /** In-chat search: newest matches first, limited to the history the caller can see. */
  async search(me: string, id: string, q: string): Promise<MessageInfo[]> {
    const term = q.trim();
    if (term.length < 2) return [];
    const conversation = await this.requireMembership(me, id);
    const since = conversation.members.find((m) => m.userId === me)?.historySince;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        deletedAt: null,
        type: 'text',
        ...(since ? { createdAt: { gte: since } } : {}),
        OR: [
          { body: { contains: term, mode: 'insensitive' } },
          { attachments: { some: { fileName: { contains: term, mode: 'insensitive' } } } },
          { poll: { question: { contains: term, mode: 'insensitive' } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: MESSAGE_INCLUDE,
    });
    return rows.map((m) => toMessageInfo(m, this.storage));
  }

  async send(me: string, id: string, input: SendInput): Promise<MessageInfo> {
    const conversation = await this.requireMembership(me, id);
    // Channel posts go through ChannelPostsService, which applies moderation and threading.
    if (conversation.type === 'channel') throw new BadRequestException('Post in the channel instead');
    const memberIds = conversation.members.map((m) => m.userId);
    const body = (input.body ?? '').trim();

    let parentAuthorId: string | null = null;
    if (input.parentId) {
      const parent = await this.prisma.message.findFirst({ where: { id: input.parentId, conversationId: id } });
      if (!parent) throw new BadRequestException('The message you replied to was not found');
      parentAuthorId = parent.authorId;
    }
    await this.assertOwnAttachments(me, id, input.attachmentIds);

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
          ...(input.poll
            ? { poll: { create: { question: input.poll.question, options: input.poll.options, multiple: input.poll.multiple ?? false } } }
            : {}),
        },
      });
      if (input.attachmentIds.length) {
        await tx.attachment.updateMany({ where: { id: { in: input.attachmentIds } }, data: { messageId: created.id } });
      }
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: created.createdAt } });
      await tx.conversationMember.updateMany({ where: { conversationId: id, hidden: true }, data: { hidden: false } });
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: me } },
        data: { lastReadAt: created.createdAt, markedUnread: false },
      });
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: MESSAGE_INCLUDE });
    });

    const info = toMessageInfo(message, this.storage, input.clientId);
    this.realtime.toUsers(memberIds, WS_EVENTS.messageNew, info);

    const preview =
      toPlainText(body).slice(0, 200) || (input.poll ? `Poll: ${input.poll.question}` : input.attachmentIds.length ? 'Sent a file' : '');
    const notify = new Map<string, 'mention' | 'reply'>();
    for (const uid of mentionIds) if (uid !== me) notify.set(uid, 'mention');
    if (parentAuthorId && parentAuthorId !== me && !notify.has(parentAuthorId)) notify.set(parentAuthorId, 'reply');
    await Promise.all([...notify].map(([userId, type]) => this.notify(userId, type, me, id, message.id, preview)));

    this.unfurl(message.id, body, memberIds);
    if (conversation.type === 'direct') await this.outOfOfficeReply(me, conversation);
    return info;
  }

  async edit(me: string, messageId: string, body: string): Promise<MessageInfo> {
    const message = await this.ownMessage(me, messageId);
    const members = await this.memberIds(message.conversationId);
    const mentionIds = extractMentionIds(body).filter((uid) => members.includes(uid));
    const linkChanged = firstUrl(body) !== firstUrl(message.body);
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        body,
        editedAt: new Date(),
        mentions: { deleteMany: {}, create: mentionIds.map((userId) => ({ userId })) },
        ...(linkChanged ? { linkPreview: Prisma.DbNull } : {}),
      },
      include: MESSAGE_INCLUDE,
    });
    const info = toMessageInfo(updated, this.storage);
    this.realtime.toUsers(members, WS_EVENTS.messageUpdated, info);
    if (linkChanged) this.unfurl(messageId, body, members);
    return info;
  }

  async remove(me: string, messageId: string): Promise<MessageInfo> {
    const message = await this.ownMessage(me, messageId);
    const attachments = await this.prisma.attachment.findMany({ where: { messageId } });
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        body: '',
        linkPreview: Prisma.DbNull,
        reactions: { deleteMany: {} },
        mentions: { deleteMany: {} },
        savedBy: { deleteMany: {} },
      },
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

  // ------------------------------------------------------------------ polls

  /** Replaces my votes on a poll (an empty list withdraws my vote). */
  async vote(me: string, messageId: string, options: number[]): Promise<MessageInfo> {
    const { poll, members } = await this.pollForMember(me, messageId);
    if (poll.closedAt) throw new BadRequestException('This poll is closed');
    const picked = [...new Set(options)];
    if (picked.some((o) => o >= poll.options.length)) throw new BadRequestException('Invalid option');
    if (!poll.multiple && picked.length > 1) throw new BadRequestException('Pick one option');
    await this.prisma.$transaction([
      this.prisma.pollVote.deleteMany({ where: { pollId: poll.id, userId: me } }),
      this.prisma.pollVote.createMany({ data: picked.map((option) => ({ pollId: poll.id, userId: me, option })) }),
    ]);
    return this.emitMessage(messageId, members);
  }

  async closePoll(me: string, messageId: string): Promise<MessageInfo> {
    const { poll, message, members } = await this.pollForMember(me, messageId);
    if (message.authorId !== me) throw new ForbiddenException('Only the person who created the poll can close it');
    if (!poll.closedAt) await this.prisma.poll.update({ where: { id: poll.id }, data: { closedAt: new Date() } });
    return this.emitMessage(messageId, members);
  }

  // ------------------------------------------------------------------ saved messages

  async listSaved(me: string): Promise<SavedMessageInfo[]> {
    const rows = await this.prisma.savedMessage.findMany({
      // Saved messages from chats I've since left are hidden (not deleted, in case I'm re-added).
      where: { userId: me, message: { deletedAt: null, conversation: { members: { some: { userId: me } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { message: { include: { ...MESSAGE_INCLUDE, conversation: { select: { title: true, type: true } } } } },
    });
    return rows.map((r) => ({
      message: toMessageInfo(r.message, this.storage),
      conversationTitle: r.message.conversation.title,
      savedAt: r.createdAt.toISOString(),
    }));
  }

  async setSaved(me: string, messageId: string, saved: boolean): Promise<{ messageId: string; saved: boolean }> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || !(await this.memberIds(message.conversationId)).includes(me)) {
      throw new NotFoundException('Message not found');
    }
    if (saved) {
      await this.prisma.savedMessage.upsert({
        where: { userId_messageId: { userId: me, messageId } },
        create: { userId: me, messageId },
        update: {},
      });
    } else {
      await this.prisma.savedMessage.deleteMany({ where: { userId: me, messageId } });
    }
    const event = { messageId, saved };
    this.realtime.toUsers([me], WS_EVENTS.savedUpdated, event);
    return event;
  }

  // ------------------------------------------------------------------ chat sections

  async listSections(me: string): Promise<ChatSectionInfo[]> {
    const rows = await this.prisma.chatSection.findMany({ where: { userId: me }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((s) => ({ id: s.id, name: s.name, position: s.position }));
  }

  async createSection(me: string, name: string): Promise<ChatSectionInfo[]> {
    const count = await this.prisma.chatSection.count({ where: { userId: me } });
    if (count >= 50) throw new BadRequestException('You can have up to 50 sections');
    await this.prisma.chatSection.create({ data: { userId: me, name, position: count } });
    return this.emitSections(me);
  }

  async renameSection(me: string, id: string, name: string): Promise<ChatSectionInfo[]> {
    const { count } = await this.prisma.chatSection.updateMany({ where: { id, userId: me }, data: { name } });
    if (!count) throw new NotFoundException('Section not found');
    return this.emitSections(me);
  }

  /** Deleting a section moves its chats back to Recent (sectionId is SET NULL by the database). */
  async deleteSection(me: string, id: string): Promise<ChatSectionInfo[]> {
    const { count } = await this.prisma.chatSection.deleteMany({ where: { id, userId: me } });
    if (!count) throw new NotFoundException('Section not found');
    const sections = await this.emitSections(me);
    // Chats that were in the section changed too.
    this.realtime.toUsers([me], WS_EVENTS.conversationUpdated, { sectionRemoved: id });
    return sections;
  }

  async reorderSections(me: string, ids: string[]): Promise<ChatSectionInfo[]> {
    await this.prisma.$transaction(
      ids.map((id, position) => this.prisma.chatSection.updateMany({ where: { id, userId: me }, data: { position } })),
    );
    return this.emitSections(me);
  }

  // ------------------------------------------------------------------ scheduled send

  async schedule(me: string, id: string, input: Omit<SendInput, 'poll' | 'clientId'> & { sendAt: string }): Promise<ScheduledMessageInfo> {
    await this.requireMembership(me, id);
    const sendAt = new Date(input.sendAt);
    const delay = sendAt.getTime() - Date.now();
    if (delay < MIN_SCHEDULE_MS) throw new BadRequestException('Pick a time at least a minute from now');
    if (delay > MAX_SCHEDULE_MS) throw new BadRequestException('Messages can be scheduled up to 90 days ahead');
    if (input.parentId && !(await this.prisma.message.findFirst({ where: { id: input.parentId, conversationId: id } }))) {
      throw new BadRequestException('The message you replied to was not found');
    }
    await this.assertOwnAttachments(me, id, input.attachmentIds);
    const row = await this.prisma.scheduledMessage.create({
      data: {
        conversationId: id,
        authorId: me,
        body: (input.body ?? '').trim(),
        parentId: input.parentId,
        importance: input.importance,
        attachmentIds: input.attachmentIds,
        sendAt,
      },
    });
    this.emitScheduled(me, id);
    return toScheduledInfo(row);
  }

  async listScheduled(me: string, conversationId?: string): Promise<ScheduledMessageInfo[]> {
    const rows = await this.prisma.scheduledMessage.findMany({
      where: { authorId: me, ...(conversationId ? { conversationId } : {}) },
      orderBy: { sendAt: 'asc' },
    });
    return rows.map(toScheduledInfo);
  }

  async cancelScheduled(me: string, id: string): Promise<void> {
    const row = await this.prisma.scheduledMessage.findFirst({ where: { id, authorId: me } });
    if (!row) throw new NotFoundException('Scheduled message not found');
    await this.prisma.scheduledMessage.delete({ where: { id } });
    this.emitScheduled(me, row.conversationId);
  }

  async sendScheduledNow(me: string, id: string): Promise<MessageInfo> {
    const row = await this.prisma.scheduledMessage.findFirst({ where: { id, authorId: me } });
    if (!row) throw new NotFoundException('Scheduled message not found');
    return this.deliverScheduled(row);
  }

  /** Called by the scheduler for each due message; the row is claimed (deleted) first so it's sent at most once. */
  async deliverScheduled(row: { id: string; conversationId: string; authorId: string; body: string; parentId: string | null; importance: Importance; attachmentIds: string[] }) {
    const { count } = await this.prisma.scheduledMessage.deleteMany({ where: { id: row.id } });
    if (!count) throw new NotFoundException('Scheduled message not found');
    this.emitScheduled(row.authorId, row.conversationId);
    // The reply target may have been deleted in the meantime; send without the quote rather than fail.
    const parentExists = row.parentId && (await this.prisma.message.count({ where: { id: row.parentId, conversationId: row.conversationId } }));
    const attachments = await this.prisma.attachment.findMany({
      where: { id: { in: row.attachmentIds }, conversationId: row.conversationId, uploaderId: row.authorId, messageId: null },
      select: { id: true },
    });
    return this.send(row.authorId, row.conversationId, {
      body: row.body,
      parentId: parentExists ? row.parentId! : undefined,
      importance: row.importance,
      attachmentIds: attachments.map((a) => a.id),
    });
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
      actor: n.actor ? { id: n.actor.id, displayName: n.actor.displayName, avatarUrl: avatarUrl(n.actor) } : null,
      conversationId: n.conversation?.id ?? null,
      conversationTitle: n.conversation?.title ?? (n.conversation?.type === 'direct' ? 'Chat' : null),
      messageId: n.messageId,
      preview: n.preview,
      read: !!n.readAt,
      createdAt: n.createdAt.toISOString(),
    };
  }

  /** Fetches a link preview after sending, then pushes the updated message. Never blocks or fails the send. */
  private unfurl(messageId: string, body: string, memberIds: string[]) {
    const url = this.linkPreviews.enabled ? firstUrl(body) : null;
    if (!url) return;
    void (async () => {
      const preview = await this.linkPreviews.preview(url);
      if (!preview) return;
      // Only apply if the message still links to the same URL (it may have been edited or deleted meanwhile).
      const current = await this.prisma.message.findUnique({ where: { id: messageId }, select: { body: true, deletedAt: true } });
      if (!current || current.deletedAt || firstUrl(current.body) !== url) return;
      await this.prisma.message.update({ where: { id: messageId }, data: { linkPreview: preview as unknown as Prisma.InputJsonValue } });
      await this.emitMessage(messageId, memberIds);
    })().catch((e) => this.logger.warn(`Link preview failed: ${e}`));
  }

  /** In a direct chat with someone who is out of office, post their message once a day. */
  private async outOfOfficeReply(me: string, conversation: { id: string; members: { userId: string; oooRepliedAt: Date | null }[] }) {
    const other = conversation.members.find((m) => m.userId !== me);
    if (!other || (other.oooRepliedAt && Date.now() - other.oooRepliedAt.getTime() < OOO_REPLY_INTERVAL_MS)) return;
    const user = await this.prisma.user.findUnique({
      where: { id: other.userId },
      select: { oooEnabled: true, oooStartAt: true, oooEndAt: true, oooMessage: true },
    });
    if (!user || !isOutOfOffice(user)) return;
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId: other.userId } },
      data: { oooRepliedAt: new Date() },
    });
    const until = user.oooEndAt
      ? ` until ${user.oooEndAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
      : '';
    await this.systemMessage(conversation.id, other.userId, `{actor} is out of office${until}.${user.oooMessage ? ` "${user.oooMessage}"` : ''}`);
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

  private async emitMessage(messageId: string, memberIds: string[]): Promise<MessageInfo> {
    const row = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: MESSAGE_INCLUDE });
    const info = toMessageInfo(row, this.storage);
    this.realtime.toUsers(memberIds, WS_EVENTS.messageUpdated, info);
    return info;
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

  /** Per-person changes (settings, unread flags) go to my other devices only. */
  private async emitToMe(me: string, id: string): Promise<ConversationInfo> {
    const info = await this.get(me, id);
    this.realtime.toUsers([me], WS_EVENTS.conversationUpdated, info);
    return info;
  }

  private async emitSections(me: string) {
    const sections = await this.listSections(me);
    this.realtime.toUsers([me], WS_EVENTS.sectionsUpdated, sections);
    return sections;
  }

  private emitScheduled(me: string, conversationId: string) {
    this.realtime.toUsers([me], WS_EVENTS.scheduledUpdated, { conversationId });
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
          user: toUserSummary(m.user, presence.get(m.userId)),
          lastReadAt: m.lastReadAt?.toISOString() ?? null,
        })),
        lastMessage: visibleLast ? toMessageInfo(visibleLast, this.storage) : null,
        lastMessageAt: r.lastMessageAt.toISOString(),
        unread: unread.get(r.id) ?? 0,
        markedUnread: mine?.markedUnread ?? false,
        muted: mine?.muted ?? false,
        pinned: mine?.pinned ?? false,
        hidden: mine?.hidden ?? false,
        sectionId: mine?.sectionId ?? null,
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

  private async pollForMember(me: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, include: { poll: true } });
    if (!message || message.deletedAt || !message.poll) throw new NotFoundException('Poll not found');
    const members = await this.memberIds(message.conversationId);
    if (!members.includes(me)) throw new NotFoundException('Poll not found');
    return { message, poll: message.poll, members };
  }

  private async assertOwnAttachments(me: string, conversationId: string, ids: string[]) {
    if (!ids.length) return;
    const owned = await this.prisma.attachment.count({ where: { id: { in: ids }, conversationId, uploaderId: me, messageId: null } });
    if (owned !== new Set(ids).size) throw new BadRequestException('Invalid attachment');
  }

  private async assertActiveUsers(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, displayName: true } });
    if (users.length !== new Set(ids).size) throw new BadRequestException('Some people could not be found');
    return users;
  }
}

function toScheduledInfo(r: {
  id: string;
  conversationId: string;
  body: string;
  importance: Importance;
  parentId: string | null;
  attachmentIds: string[];
  sendAt: Date;
  createdAt: Date;
}): ScheduledMessageInfo {
  return {
    id: r.id,
    conversationId: r.conversationId,
    body: r.body,
    importance: r.importance,
    parentId: r.parentId,
    attachmentCount: r.attachmentIds.length,
    sendAt: r.sendAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
