import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttachmentInfo, ChannelMessageEvent, ChannelNotes, ChannelPost, ChannelPostPage, extractMentionIds, MessageInfo,
  PostMeta, TEAMS_WS_EVENTS, toPlainText, WS_EVENTS,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { MESSAGE_INCLUDE, MessageRow, toMessageInfo } from '../chat/chat.mapper';
import { StorageService } from '../infra/storage';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PolicyService } from '../admin/policy.service';
import { resolveMentions } from './teams.policy';
import { ChannelAccess, TeamsService } from './teams.service';

const PAGE = 20;

interface PostInput {
  body: string;
  subject?: string;
  announcement: boolean;
  headerAttachmentId?: string;
  importance: MessageInfo['importance'];
  attachmentIds: string[];
  alsoChannelIds: string[];
  clientId?: string;
}

/** Threaded channel posts stored as Messages in the channel's conversation (parentId = thread root). */
@Injectable()
export class ChannelPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly teams: TeamsService,
    private readonly policies: PolicyService,
  ) {}

  async posts(me: string, channelId: string, before?: string): Promise<ChannelPostPage> {
    const { channel } = await this.teams.requireChannel(me, channelId);
    const roots = await this.prisma.message.findMany({
      where: { conversationId: channel.conversationId, parentId: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      take: PAGE + 1,
      include: MESSAGE_INCLUDE,
    });
    const hasMore = roots.length > PAGE;
    const page = roots.slice(0, PAGE).reverse();
    return { posts: await this.present(page), nextCursor: hasMore ? page[0].id : null };
  }

  async post(me: string, channelId: string, input: PostInput): Promise<ChannelPost[]> {
    if (input.importance === 'urgent') {
      await this.policies.assert(me, (p) => p.messaging.allowUrgent, 'Your organization’s policy doesn’t allow urgent messages');
    }
    const targets = [channelId, ...input.alsoChannelIds.filter((id) => id !== channelId)];
    const accesses: ChannelAccess[] = [];
    for (const id of [...new Set(targets)]) {
      const access = await this.teams.requireChannel(me, id);
      if (!access.permissions.post) throw new ForbiddenException(`You can’t start posts in ${access.channel.name}`);
      accesses.push(access);
    }
    const primary = accesses[0];
    const body = input.body.trim();
    if (accesses.length > 1 && input.attachmentIds.length) throw new BadRequestException('Files can only be attached when posting to one channel');
    await this.assertOwnAttachments(me, primary.channel.conversationId, [...input.attachmentIds, ...(input.headerAttachmentId ? [input.headerAttachmentId] : [])]);
    if (input.headerAttachmentId) {
      const header = await this.prisma.attachment.findUniqueOrThrow({ where: { id: input.headerAttachmentId } });
      if (!header.mimeType.startsWith('image/')) throw new BadRequestException('The header must be an image');
    }

    const crossPostId = accesses.length > 1 ? randomUUID() : null;
    const created: ChannelPost[] = [];
    for (const [i, access] of accesses.entries()) {
      const isPrimary = i === 0;
      const { personal, group, all } = await this.mentionsFor(me, access, body);
      const subject = input.subject?.trim() || null;
      const row = await this.prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: access.channel.conversationId,
            authorId: me,
            body,
            importance: input.importance,
            mentions: { create: all.map((userId) => ({ userId })) },
          },
        });
        const files = isPrimary ? [...input.attachmentIds, ...(input.headerAttachmentId ? [input.headerAttachmentId] : [])] : [];
        if (files.length) await tx.attachment.updateMany({ where: { id: { in: files } }, data: { messageId: message.id } });
        await tx.channelPost.create({
          data: {
            messageId: message.id,
            channelId: access.channel.id,
            subject,
            announcement: input.announcement,
            // Copies reuse the primary's banner image (signed URLs are per attachment, not per conversation).
            headerAttachmentId: input.announcement ? (input.headerAttachmentId ?? null) : null,
            crossPostId,
          },
        });
        await this.touch(tx, access.channel.conversationId, me, message.createdAt);
        return tx.message.findUniqueOrThrow({ where: { id: message.id }, include: MESSAGE_INCLUDE });
      });
      const [post] = await this.present([row], isPrimary ? input.clientId : undefined);
      created.push(post);
      await this.broadcast(access, { channelId: access.channel.id, conversationId: access.channel.conversationId, post });
      const preview = (subject ? `${subject}: ` : '') + (toPlainText(body).slice(0, 180) || 'Shared a file');
      await this.notifyMentions(me, access, row.id, personal, group, preview);
    }
    // Cross-post labels are only complete once every copy exists.
    if (crossPostId) {
      const fresh = await this.present(
        await this.prisma.message.findMany({ where: { id: { in: created.map((p) => p.root.id) } }, include: MESSAGE_INCLUDE }),
      );
      for (const [i, access] of accesses.entries()) {
        const post = fresh.find((p) => p.root.conversationId === access.channel.conversationId)!;
        if (i === 0 && input.clientId) post.root = { ...post.root, clientId: input.clientId };
        await this.broadcast(access, { channelId: access.channel.id, conversationId: access.channel.conversationId, post });
      }
      this.audit.log({ actorId: me, action: 'channel.cross_posted', targetType: 'message', targetId: created[0].root.id, meta: { channelIds: accesses.map((a) => a.channel.id) } });
      return fresh;
    }
    return created;
  }

  async reply(me: string, channelId: string, rootId: string, input: { body: string; attachmentIds: string[]; clientId?: string }): Promise<MessageInfo> {
    const access = await this.teams.requireChannel(me, channelId);
    if (!access.permissions.reply) throw new ForbiddenException('Replies are turned off in this channel');
    const root = await this.prisma.message.findFirst({ where: { id: rootId, conversationId: access.channel.conversationId, parentId: null } });
    if (!root || root.deletedAt || root.type !== 'text') throw new NotFoundException('Post not found');
    await this.assertOwnAttachments(me, access.channel.conversationId, input.attachmentIds);
    const body = input.body.trim();
    const { personal, group, all } = await this.mentionsFor(me, access, body);

    const row = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: access.channel.conversationId,
          authorId: me,
          parentId: rootId,
          body,
          mentions: { create: all.map((userId) => ({ userId })) },
        },
      });
      if (input.attachmentIds.length) await tx.attachment.updateMany({ where: { id: { in: input.attachmentIds } }, data: { messageId: message.id } });
      await this.touch(tx, access.channel.conversationId, me, message.createdAt);
      return tx.message.findUniqueOrThrow({ where: { id: message.id }, include: MESSAGE_INCLUDE });
    });
    const reply = toMessageInfo(row, this.storage, input.clientId);
    await this.broadcast(access, { channelId, conversationId: access.channel.conversationId, reply, rootId });

    const preview = toPlainText(body).slice(0, 200) || 'Shared a file';
    await this.notifyMentions(me, access, row.id, personal, group, preview);
    if (root.authorId && root.authorId !== me && !personal.includes(root.authorId)) {
      const stillMember = (await this.teams.conversationMemberIds(access.channel.conversationId)).includes(root.authorId);
      if (stillMember) await this.teams.notify(root.authorId, 'reply', me, access.channel.conversationId, row.id, preview);
    }
    return reply;
  }

  /** Moderators (team owners, channel owners, listed moderators) can remove other people's messages. */
  async moderatorDelete(me: string, channelId: string, messageId: string): Promise<MessageInfo> {
    const access = await this.teams.requireChannel(me, channelId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId: access.channel.conversationId, deletedAt: null } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.authorId !== me && !access.permissions.moderate) throw new ForbiddenException('You can’t delete this message');
    if (message.authorId === me && !access.permissions.moderate) {
      await this.policies.assert(me, (p) => p.messaging.allowDelete, 'Your organization’s policy doesn’t allow deleting sent messages');
    }
    const attachments = await this.prisma.attachment.findMany({ where: { messageId } });
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: '', reactions: { deleteMany: {} }, mentions: { deleteMany: {} } },
      include: MESSAGE_INCLUDE,
    });
    await this.prisma.attachment.deleteMany({ where: { messageId } });
    await Promise.all(attachments.map((a) => this.storage.remove(a.storageKey)));
    const info = toMessageInfo(updated, this.storage);
    this.realtime.toUsers(await this.teams.conversationMemberIds(access.channel.conversationId), WS_EVENTS.messageUpdated, info);
    if (message.authorId !== me) {
      this.audit.log({ actorId: me, action: 'channel.message_removed', targetType: 'message', targetId: messageId, meta: { channelId, authorId: message.authorId } });
    }
    return info;
  }

  // ------------------------------------------------------------------ tabs

  async files(me: string, channelId: string): Promise<(AttachmentInfo & { uploadedBy: string; createdAt: string })[]> {
    const { channel } = await this.teams.requireChannel(me, channelId);
    const headers = await this.prisma.channelPost.findMany({ where: { channelId, headerAttachmentId: { not: null } }, select: { headerAttachmentId: true } });
    const rows = await this.prisma.attachment.findMany({
      where: {
        conversationId: channel.conversationId,
        message: { deletedAt: null },
        id: { notIn: headers.map((h) => h.headerAttachmentId!) },
      },
      include: { uploader: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      url: `/api/attachments/${a.id}/content?${this.storage.sign(a.id)}`,
      uploadedBy: a.uploader.displayName,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async notes(me: string, channelId: string): Promise<ChannelNotes> {
    const { channel } = await this.teams.requireChannel(me, channelId);
    return this.toNotes(channel);
  }

  async saveNotes(me: string, channelId: string, notes: string, version: number): Promise<ChannelNotes> {
    const access = await this.teams.requireChannel(me, channelId);
    if (access.channel.archivedAt || access.team.archivedAt) throw new ForbiddenException('This channel is archived');
    // Optimistic concurrency: only save on top of the version the editor started from.
    const updated = await this.prisma.channel.updateMany({
      where: { id: channelId, notesVersion: version },
      data: { notes, notesVersion: { increment: 1 }, notesUpdatedAt: new Date(), notesUpdatedBy: me },
    });
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const result = await this.toNotes(channel);
    if (!updated.count) throw new ConflictException({ message: 'Someone else changed these notes. Review their version and try again.', current: result });
    this.realtime.toUsers(await this.teams.conversationMemberIds(channel.conversationId), TEAMS_WS_EVENTS.channelNotes, result);
    return result;
  }

  // ------------------------------------------------------------------ internals

  private async toNotes(channel: { id: string; notes: string; notesVersion: number; notesUpdatedAt: Date | null; notesUpdatedBy: string | null }): Promise<ChannelNotes> {
    const by = channel.notesUpdatedBy ? await this.prisma.user.findUnique({ where: { id: channel.notesUpdatedBy }, select: { id: true, displayName: true } }) : null;
    return { channelId: channel.id, notes: channel.notes, version: channel.notesVersion, updatedAt: channel.notesUpdatedAt?.toISOString() ?? null, updatedBy: by };
  }

  private async mentionsFor(me: string, access: ChannelAccess, body: string) {
    const ids = extractMentionIds(body);
    if (!ids.length) return { personal: [], group: [], all: [] };
    const [members, tags] = await Promise.all([this.teams.conversationMemberIds(access.channel.conversationId), this.teams.tagsOf(access.team.id)]);
    const { personal, group } = resolveMentions(ids, {
      authorId: me,
      teamId: access.team.id,
      channelId: access.channel.id,
      channelType: access.channel.type,
      channelMemberIds: members,
      tags,
      settings: access.settings,
      canMentionGroups: access.permissions.mentionGroups,
    });
    return { personal, group, all: [...personal, ...group] };
  }

  private async notifyMentions(me: string, access: ChannelAccess, messageId: string, personal: string[], group: string[], preview: string) {
    const conversationId = access.channel.conversationId;
    for (const userId of personal) await this.teams.notify(userId, 'mention', me, conversationId, messageId, preview);
    if (!group.length) return;
    // Muted channels still surface personal mentions, but not @team/@channel/@tag broadcasts.
    const muted = new Set(
      (await this.prisma.conversationMember.findMany({ where: { conversationId, userId: { in: group }, muted: true }, select: { userId: true } })).map((m) => m.userId),
    );
    for (const userId of group.filter((u) => !muted.has(u))) await this.teams.notify(userId, 'channel_mention', me, conversationId, messageId, preview);
  }

  private async broadcast(access: ChannelAccess, event: ChannelMessageEvent) {
    this.realtime.toUsers(await this.teams.conversationMemberIds(access.channel.conversationId), TEAMS_WS_EVENTS.channelMessage, event);
  }

  private async touch(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], conversationId: string, me: string, at: Date) {
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at } });
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: me } }, data: { lastReadAt: at } });
  }

  private async assertOwnAttachments(me: string, conversationId: string, ids: string[]) {
    if (!ids.length) return;
    const owned = await this.prisma.attachment.count({ where: { id: { in: ids }, conversationId, uploaderId: me, messageId: null } });
    if (owned !== new Set(ids).size) throw new BadRequestException('Invalid attachment');
  }

  /** Root messages → posts with meta and all replies (oldest first). */
  private async present(roots: MessageRow[], clientId?: string): Promise<ChannelPost[]> {
    if (!roots.length) return [];
    const ids = roots.map((r) => r.id);
    const [replies, metas] = await Promise.all([
      this.prisma.message.findMany({ where: { parentId: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: MESSAGE_INCLUDE }),
      this.prisma.channelPost.findMany({ where: { messageId: { in: ids } } }),
    ]);
    const metaOf = new Map(metas.map((m) => [m.messageId, m]));
    const crossIds = [...new Set(metas.map((m) => m.crossPostId).filter((x): x is string => !!x))];
    const siblings = crossIds.length
      ? await this.prisma.channelPost.findMany({ where: { crossPostId: { in: crossIds } }, include: { channel: { select: { id: true, name: true, team: { select: { name: true } } } } } })
      : [];

    return roots.map((r) => {
      const meta = metaOf.get(r.id);
      const info = toMessageInfo(r, this.storage, clientId);
      const headerId = meta?.headerAttachmentId ?? null;
      const postMeta: PostMeta = {
        subject: r.deletedAt ? null : (meta?.subject ?? null),
        announcement: !r.deletedAt && !!meta?.announcement,
        headerImageUrl: headerId && !r.deletedAt ? `/api/attachments/${headerId}/content?${this.storage.sign(headerId)}` : null,
        crossPostedTo: meta?.crossPostId
          ? siblings
              .filter((s) => s.crossPostId === meta.crossPostId && s.messageId !== r.id)
              .map((s) => ({ channelId: s.channel.id, label: `${s.channel.team.name} › ${s.channel.name}` }))
          : [],
      };
      return {
        root: { ...info, attachments: info.attachments.filter((a) => a.id !== headerId) },
        meta: postMeta,
        replies: replies.filter((x) => x.parentId === r.id).map((x) => toMessageInfo(x, this.storage)),
      };
    });
  }
}
