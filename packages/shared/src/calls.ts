import { z } from 'zod';

/** Unanswered rings become missed calls after this long (SOURCE_OF_TRUTH §6 "Call flow"). */
export const RING_TIMEOUT_MS = 30_000;
export const MAX_CALL_PARTICIPANTS = 50;
export const MAX_VOICEMAIL_BYTES = 10 * 1024 * 1024;
export const MAX_VOICEMAIL_SECONDS = 180;

export const CALL_KINDS = ['audio', 'video'] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/** ringing → active → ended, or ringing → missed / declined when nobody answers. */
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
export type CallParticipantStatus = 'ringing' | 'joined' | 'left' | 'declined' | 'missed' | 'busy' | 'forwarded';
export type CallEndReason = 'hangup' | 'no_answer' | 'declined' | 'busy' | 'dnd' | 'voicemail' | 'transferred' | 'cancelled';

export const FORWARD_MODES = ['off', 'user', 'voicemail'] as const;
export type ForwardMode = (typeof FORWARD_MODES)[number];

// ---------- requests ----------

export const startCallSchema = z
  .object({
    /** Call the members of an existing direct or group chat… */
    conversationId: z.string().min(1).optional(),
    /** …or one person (finds or creates the 1:1 chat). Used by "call back" and speed dial. */
    userId: z.string().min(1).optional(),
    kind: z.enum(CALL_KINDS).default('audio'),
  })
  .refine((v) => !!v.conversationId !== !!v.userId, { message: 'Give either conversationId or userId' });
export type StartCallInput = z.input<typeof startCallSchema>;

export const inviteToCallSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(MAX_CALL_PARTICIPANTS) });
export type InviteToCallInput = z.infer<typeof inviteToCallSchema>;

export const holdCallSchema = z.object({ onHold: z.boolean() });
export type HoldCallInput = z.infer<typeof holdCallSchema>;

export const transferCallSchema = z.object({ userId: z.string().min(1) });
export type TransferCallInput = z.infer<typeof transferCallSchema>;

export const callSettingsSchema = z
  .object({
    forwardMode: z.enum(FORWARD_MODES),
    forwardToId: z.string().min(1).nullable().default(null),
    /** Also ring this person at the same time (simultaneous ring). */
    alsoRingId: z.string().min(1).nullable().default(null),
  })
  .refine((v) => v.forwardMode !== 'user' || !!v.forwardToId, { message: 'Pick who to forward calls to', path: ['forwardToId'] });
export type CallSettingsInput = z.input<typeof callSettingsSchema>;

// ---------- responses ----------

export interface CallUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CallParticipantInfo {
  user: CallUser;
  status: CallParticipantStatus;
  isCaller: boolean;
  onHold: boolean;
  invitedAt: string;
  joinedAt: string | null;
  leftAt: string | null;
  /** Set when this person is ringing because someone else's calls are forwarded to them. */
  forwardedFor: CallUser | null;
}

export interface CallInfo {
  id: string;
  conversationId: string | null;
  conversationType: 'direct' | 'group' | 'self' | 'channel' | null;
  /** Group chat name, if any. Clients fall back to participant names. */
  title: string | null;
  kind: CallKind;
  status: CallStatus;
  endReason: CallEndReason | null;
  startedBy: CallUser;
  /** Who handed this call over, for calls created by a transfer. */
  transferredBy: CallUser | null;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  participants: CallParticipantInfo[];
}

/** What a client needs to connect to the LiveKit room. */
export interface CallJoinInfo {
  call: CallInfo;
  url: string;
  token: string;
}

export interface CallHistoryItem {
  call: CallInfo;
  direction: 'outgoing' | 'incoming' | 'missed';
  /** Seconds from the first answer to the end; 0 when never answered. */
  durationSec: number;
}

export interface CallHistoryPage {
  items: CallHistoryItem[];
  nextCursor: string | null;
}

export interface VoicemailInfo {
  id: string;
  from: CallUser | null;
  callId: string | null;
  durationSec: number;
  url: string;
  listened: boolean;
  createdAt: string;
}

export interface CallSettingsInfo {
  forwardMode: ForwardMode;
  forwardTo: CallUser | null;
  alsoRing: CallUser | null;
}

export interface SpeedDialEntry {
  user: CallUser & { jobTitle: string | null };
  createdAt: string;
}

// ---------- realtime payloads ----------

/** `call:ended`: the final state, plus whether the caller should be offered to leave a voicemail. */
export interface CallEndedEvent {
  call: CallInfo;
  /** Present for the caller when a 1:1 call went unanswered and voicemail is possible. */
  voicemailFor: CallUser | null;
}

/** `call:transferred`: sent to the person being transferred; they switch rooms and ring the target. */
export interface CallTransferredEvent {
  fromCallId: string;
  join: CallJoinInfo;
}
