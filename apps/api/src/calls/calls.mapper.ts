import { Prisma } from '@prisma/client';
import { ActivityItem, CallEndReason, CallInfo, CallUser, VoicemailInfo } from '@teamsphere/shared';
import { avatarUrl } from '../chat/chat.mapper';
import type { StorageService } from '../infra/storage';

const USER = { id: true, displayName: true, avatarKey: true } as const;

export const CALL_INCLUDE = {
  conversation: { select: { id: true, type: true, title: true } },
  startedBy: { select: USER },
  transferredBy: { select: USER },
  participants: {
    include: { user: { select: USER }, forwardedFor: { select: USER } },
    orderBy: { invitedAt: 'asc' },
  },
} satisfies Prisma.CallInclude;

export type CallRow = Prisma.CallGetPayload<{ include: typeof CALL_INCLUDE }>;

export const VOICEMAIL_INCLUDE = { fromUser: { select: USER } } satisfies Prisma.VoicemailInclude;
export type VoicemailRow = Prisma.VoicemailGetPayload<{ include: typeof VOICEMAIL_INCLUDE }>;

export const NOTIFICATION_INCLUDE = {
  actor: { select: USER },
  conversation: { select: { id: true, title: true, type: true } },
} satisfies Prisma.NotificationInclude;
export type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof NOTIFICATION_INCLUDE }>;

export function toCallUser(u: { id: string; displayName: string; avatarKey: string | null }): CallUser {
  return { id: u.id, displayName: u.displayName, avatarUrl: avatarUrl(u) };
}

export function toCallInfo(c: CallRow): CallInfo {
  // Caller first, then in invite order; the client shows them in this order.
  const participants = [...c.participants].sort((a, b) => Number(b.isCaller) - Number(a.isCaller));
  return {
    id: c.id,
    conversationId: c.conversationId,
    conversationType: c.conversation?.type ?? null,
    title: c.conversation?.title ?? null,
    kind: c.kind,
    status: c.status,
    endReason: (c.endReason as CallEndReason | null) ?? null,
    startedBy: toCallUser(c.startedBy),
    transferredBy: c.transferredBy ? toCallUser(c.transferredBy) : null,
    createdAt: c.createdAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    participants: participants.map((p) => ({
      user: toCallUser(p.user),
      status: p.status,
      isCaller: p.isCaller,
      onHold: p.onHold,
      invitedAt: p.invitedAt.toISOString(),
      joinedAt: p.joinedAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
      forwardedFor: p.forwardedFor ? toCallUser(p.forwardedFor) : null,
    })),
  };
}

export function toVoicemailInfo(v: VoicemailRow, storage: StorageService): VoicemailInfo {
  return {
    id: v.id,
    from: v.fromUser ? toCallUser(v.fromUser) : null,
    callId: v.callId,
    durationSec: Math.round(v.durationMs / 1000),
    url: `/api/voicemails/${v.id}/content?${storage.sign(v.id)}`,
    listened: !!v.listenedAt,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Same shape the chat module's Activity feed returns, for missed-call and voicemail entries. */
export function toActivityItem(n: NotificationRow): ActivityItem {
  return {
    id: n.id,
    type: n.type as ActivityItem['type'],
    actor: n.actor ? toCallUser(n.actor) : null,
    conversationId: n.conversation?.id ?? null,
    conversationTitle: n.conversation?.title ?? (n.conversation?.type === 'direct' ? 'Chat' : null),
    messageId: n.messageId,
    preview: n.preview,
    read: !!n.readAt,
    createdAt: n.createdAt.toISOString(),
  };
}
