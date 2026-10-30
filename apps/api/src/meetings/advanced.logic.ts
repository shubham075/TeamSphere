import type { MeetingPollInfo, MeetingRole } from '@teamsphere/shared';
import { isOrganizerRole } from './meetings.logic';

// Pure rules for Phase 5b (breakout rooms, guests, polls/Q&A, recordings), kept apart so they're unit-tested.

// ------------------------------------------------------------------ guests

/** What the access-token guard knows about the caller. */
export interface GuestScope {
  role: string;
  guestMeetingId: string | null;
}

/** Anonymous guests may only call routes marked for guests; everyone else may call any route. */
export function guestRouteAllowed(user: GuestScope, routeAllowsGuests: boolean): boolean {
  if (!isGuest(user)) return true;
  return routeAllowsGuests;
}

export function isGuest(user: GuestScope): boolean {
  return user.role === 'guest' && !!user.guestMeetingId;
}

/** A guest's token only works for the one meeting it was issued for. */
export function guestMeetingAllowed(user: GuestScope, meetingId: string): boolean {
  return !isGuest(user) || user.guestMeetingId === meetingId;
}

/** Guest display names: trimmed, control characters removed, marked so nobody mistakes them for colleagues. */
export function guestDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${clean || 'Guest'} (Guest)`;
}

// ------------------------------------------------------------------ breakout rooms

/**
 * Spreads people evenly over the rooms (sizes differ by at most one). `shuffle` decides the order people are dealt
 * in; tests pass identity for a predictable result.
 */
export function assignBreakouts(userIds: string[], roomIds: string[], shuffle: <T>(xs: T[]) => T[] = shuffled): Map<string, string[]> {
  const out = new Map(roomIds.map((id) => [id, [] as string[]]));
  if (!roomIds.length) return out;
  shuffle([...new Set(userIds)]).forEach((uid, i) => out.get(roomIds[i % roomIds.length])!.push(uid));
  return out;
}

export function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Moves people into one room (or out of all rooms with null); each person is in at most one room. */
export function moveToRoom(rooms: { id: string; userIds: Set<string> }[], userIds: string[], roomId: string | null): void {
  if (roomId !== null && !rooms.some((r) => r.id === roomId)) throw new Error('Unknown room');
  for (const r of rooms) for (const uid of userIds) r.userIds.delete(uid);
  if (roomId !== null) for (const uid of userIds) rooms.find((r) => r.id === roomId)!.userIds.add(uid);
}

/** Which room a person should be connected to: their room while rooms are open, else the main meeting (null). */
export function roomFor(breakouts: { open: boolean; rooms: { id: string; userIds: Set<string> }[] } | null, userId: string): string | null {
  if (!breakouts?.open) return null;
  return breakouts.rooms.find((r) => r.userIds.has(userId))?.id ?? null;
}

// ------------------------------------------------------------------ polls & Q&A

/** Organizers and presenters run polls, recordings and Q&A moderation. */
export function canRunMeeting(role: MeetingRole | null): boolean {
  return isOrganizerRole(role) || role === 'presenter';
}

/** Attendees see drafts never; live poll results only after voting; closed results always. */
export function pollVisible(status: MeetingPollInfo['status'], manager: boolean): boolean {
  return manager || status !== 'draft';
}

export function pollResultsVisible(status: MeetingPollInfo['status'], manager: boolean, voted: boolean): boolean {
  return manager || status === 'closed' || voted;
}

/** Validates a ballot: live poll, option indexes in range, one option unless multiple choice. */
export function validBallot(poll: { status: string; options: string[]; multiple: boolean }, options: number[]): string | null {
  if (poll.status !== 'live') return 'This poll isn’t open';
  const unique = [...new Set(options)];
  if (!unique.length || unique.some((o) => o < 0 || o >= poll.options.length)) return 'Pick one of the options';
  if (!poll.multiple && unique.length > 1) return 'Pick one option';
  return null;
}

export type QuestionStatus = 'pending' | 'published' | 'answered' | 'dismissed';

/** Moderators see everything; others see published/answered questions plus their own. */
export function questionVisible(q: { status: QuestionStatus; authorId: string }, me: string, moderator: boolean): boolean {
  if (moderator || q.authorId === me) return true;
  return q.status === 'published' || q.status === 'answered';
}

/** New questions skip moderation when Q&A isn't moderated or a moderator asks. */
export function initialQuestionStatus(moderated: boolean, moderator: boolean): QuestionStatus {
  return moderated && !moderator ? 'pending' : 'published';
}

export type QuestionAction = 'publish' | 'answer' | 'dismiss' | 'upvote' | 'unvote' | 'delete';

/** Who may do what to a question. Upvotes only on visible, open questions; authors may delete their own. */
export function questionActionAllowed(action: QuestionAction, q: { status: QuestionStatus; authorId: string }, me: string, moderator: boolean): boolean {
  switch (action) {
    case 'publish':
    case 'answer':
    case 'dismiss':
      return moderator;
    case 'delete':
      return moderator || q.authorId === me;
    case 'upvote':
    case 'unvote':
      return q.status === 'published' && q.authorId !== me;
  }
}

/** Anonymous authors are hidden from everyone but themselves (moderators included, as in Teams). */
export function showQuestionAuthor(q: { anonymous: boolean; authorId: string }, me: string): boolean {
  return !q.anonymous || q.authorId === me;
}

// ------------------------------------------------------------------ recordings

export function recordingExpiry(startedAt: Date, retentionDays: number): Date {
  return new Date(startedAt.getTime() + retentionDays * 86_400_000);
}

export function isRecordingExpired(r: { expiresAt: Date }, now = new Date()): boolean {
  return r.expiresAt.getTime() <= now.getTime();
}

/** S3 key of a recording file. */
export function recordingKey(meetingId: string, recordingId: string): string {
  return `recordings/${meetingId}/${recordingId}.mp4`;
}

/** Maps LiveKit EgressStatus numbers (protocol enum) to our recording status; null = still running. */
export function recordingStatusFromEgress(status: number): 'processing' | 'ready' | 'failed' | null {
  // 0 starting, 1 active, 2 ending, 3 complete, 4 failed, 5 aborted, 6 limit reached
  if (status <= 1) return null;
  if (status === 2) return 'processing';
  if (status === 3 || status === 6) return 'ready';
  return 'failed';
}
