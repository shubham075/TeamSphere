import { CallEndReason, CallParticipantStatus, CallStatus, RING_TIMEOUT_MS } from '@teamsphere/shared';

/**
 * Pure call state machine (no I/O) so the rules can be unit tested. CallsService loads rows, asks these
 * functions what should happen, and persists the result.
 */

const PARTICIPANT_TRANSITIONS: Record<CallParticipantStatus, readonly CallParticipantStatus[]> = {
  // "left" from ringing = answered on another ring of the same person (forwarding / simultaneous ring).
  ringing: ['joined', 'declined', 'missed', 'busy', 'forwarded', 'left'],
  joined: ['left'],
  // Re-invited (ringing again) or joining a still-running group call from the chat.
  left: ['joined', 'ringing'],
  declined: ['joined', 'ringing'],
  missed: ['joined', 'ringing'],
  busy: ['joined', 'ringing'],
  forwarded: ['ringing'],
};

export function canTransition(from: CallParticipantStatus, to: CallParticipantStatus): boolean {
  return PARTICIPANT_TRANSITIONS[from].includes(to);
}

export const FINAL_CALL_STATUSES: readonly CallStatus[] = ['ended', 'missed', 'declined'];
export const isFinal = (status: CallStatus) => FINAL_CALL_STATUSES.includes(status);

export interface ParticipantState {
  status: CallParticipantStatus;
  isCaller: boolean;
}

export interface CallState {
  status: CallStatus;
  /** Someone other than the caller has joined at least once. */
  answered: boolean;
  /** Group calls keep running while anyone is in them; 1:1 calls end when either side leaves. */
  group: boolean;
}

/** The status a call should have given its participants. Final statuses never change. */
export function nextCallStatus(call: CallState, participants: ParticipantState[]): CallStatus {
  if (isFinal(call.status)) return call.status;
  const joined = participants.filter((p) => p.status === 'joined').length;
  const ringing = participants.some((p) => p.status === 'ringing');

  if (!call.answered) {
    const caller = participants.find((p) => p.isCaller);
    // The caller hung up (or never connected) before anyone answered.
    if (!caller || caller.status !== 'joined') return 'missed';
    if (ringing) return 'ringing';
    const callees = participants.filter((p) => !p.isCaller && p.status !== 'left');
    return callees.length > 0 && callees.every((p) => p.status === 'declined') ? 'declined' : 'missed';
  }

  if (call.group) return joined === 0 ? 'ended' : 'active';
  return joined < 2 && !ringing ? 'ended' : 'active';
}

/** Default end reason for a final status; CallsService overrides it when it knows better (busy, DND, transfer…). */
export function defaultEndReason(status: CallStatus, participants: ParticipantState[]): CallEndReason | null {
  switch (status) {
    case 'ended':
      return 'hangup';
    case 'declined':
      return 'declined';
    case 'missed': {
      const caller = participants.find((p) => p.isCaller);
      if (caller && caller.status !== 'joined') return 'cancelled';
      const callees = participants.filter((p) => !p.isCaller);
      if (callees.length && callees.every((p) => p.status === 'busy')) return 'busy';
      if (callees.some((p) => p.status === 'forwarded') && !callees.some((p) => p.status === 'missed')) return 'voicemail';
      return 'no_answer';
    }
    default:
      return null;
  }
}

export function isRingExpired(invitedAt: Date, now = new Date()): boolean {
  return now.getTime() - invitedAt.getTime() >= RING_TIMEOUT_MS;
}

export function callDurationSec(answeredAt: Date | null, endedAt: Date | null): number {
  if (!answeredAt || !endedAt) return 0;
  return Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000));
}

export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function historyDirection(
  call: { startedById: string },
  me: { userId: string; joinedAt: Date | null },
): 'outgoing' | 'incoming' | 'missed' {
  if (call.startedById === me.userId) return 'outgoing';
  return me.joinedAt ? 'incoming' : 'missed';
}
