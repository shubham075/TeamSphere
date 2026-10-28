import { Prisma } from '@prisma/client';
import { LinkPreview, MessageInfo, PollInfo, PresenceInfo, ReactionSummary, toPlainText, UserSummary } from '@teamsphere/shared';
import type { StorageService } from '../infra/storage';
import { avatarUrl } from '../users/users.mapper';

export { avatarUrl };

export const MESSAGE_INCLUDE = {
  author: { select: { id: true, displayName: true, avatarKey: true } },
  parent: { select: { id: true, body: true, deletedAt: true, author: { select: { displayName: true } } } },
  reactions: { select: { userId: true, emoji: true }, orderBy: { createdAt: 'asc' } },
  attachments: { orderBy: { createdAt: 'asc' } },
  mentions: { select: { userId: true } },
  poll: { include: { votes: { select: { userId: true, option: true }, orderBy: { createdAt: 'asc' } } } },
} satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

export function summarizeReactions(rows: { userId: string; emoji: string }[]): ReactionSummary[] {
  const byEmoji = new Map<string, string[]>();
  for (const r of rows) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.userId]);
  return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
}

export function toPollInfo(p: NonNullable<MessageRow['poll']>): PollInfo {
  return {
    id: p.id,
    question: p.question,
    multiple: p.multiple,
    options: p.options.map((text, i) => ({ text, voterIds: p.votes.filter((v) => v.option === i).map((v) => v.userId) })),
    closedAt: p.closedAt?.toISOString() ?? null,
  };
}

export function toMessageInfo(m: MessageRow, storage: StorageService, clientId?: string): MessageInfo {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    ...(clientId ? { clientId } : {}),
    conversationId: m.conversationId,
    author: m.author ? { id: m.author.id, displayName: m.author.displayName, avatarUrl: avatarUrl(m.author) } : null,
    parent:
      m.parent && !deleted
        ? {
            id: m.parent.id,
            authorName: m.parent.author?.displayName ?? 'Unknown',
            preview: m.parent.deletedAt ? 'This message has been deleted.' : toPlainText(m.parent.body).slice(0, 200),
          }
        : null,
    type: m.type,
    body: deleted ? '' : m.body,
    importance: m.importance,
    reactions: deleted ? [] : summarizeReactions(m.reactions),
    attachments: deleted
      ? []
      : m.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          size: a.size,
          url: `/api/attachments/${a.id}/content?${storage.sign(a.id)}`,
        })),
    mentionIds: deleted ? [] : m.mentions.map((x) => x.userId),
    poll: m.poll && !deleted ? toPollInfo(m.poll) : null,
    linkPreview: deleted ? null : ((m.linkPreview as LinkPreview | null) ?? null),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
  };
}

export function toUserSummary(
  u: { id: string; displayName: string; avatarKey: string | null; jobTitle: string | null },
  presence: PresenceInfo | undefined,
): UserSummary {
  return {
    id: u.id,
    displayName: u.displayName,
    avatarUrl: avatarUrl(u),
    jobTitle: u.jobTitle,
    presence: presence?.status ?? 'offline',
    statusMessage: presence?.statusMessage ?? null,
    outOfOffice: presence?.outOfOffice ?? null,
  };
}
