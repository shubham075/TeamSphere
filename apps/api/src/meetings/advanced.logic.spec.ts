import { describe, expect, it } from 'vitest';
import {
  assignBreakouts, canRunMeeting, guestDisplayName, guestMeetingAllowed, guestRouteAllowed, initialQuestionStatus, isRecordingExpired,
  moveToRoom, pollResultsVisible, pollVisible, questionActionAllowed, questionVisible, recordingExpiry, recordingKey,
  recordingStatusFromEgress, roomFor, showQuestionAuthor, validBallot,
} from './advanced.logic';

const identity = <T,>(xs: T[]) => xs;

describe('breakout assignment', () => {
  it('spreads people evenly (sizes differ by at most one)', () => {
    const out = assignBreakouts(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['r1', 'r2', 'r3'], identity);
    expect(out.get('r1')).toEqual(['a', 'd', 'g']);
    expect(out.get('r2')).toEqual(['b', 'e']);
    expect(out.get('r3')).toEqual(['c', 'f']);
  });

  it('puts everyone in exactly one room even when shuffled, and ignores duplicates', () => {
    const people = Array.from({ length: 23 }, (_, i) => `u${i}`);
    const out = assignBreakouts([...people, 'u1'], ['r1', 'r2', 'r3', 'r4']);
    const all = [...out.values()].flat();
    expect(all.sort()).toEqual([...people].sort());
    const sizes = [...out.values()].map((r) => r.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('leaves rooms empty when there are more rooms than people, and handles no rooms', () => {
    const out = assignBreakouts(['a'], ['r1', 'r2'], identity);
    expect(out.get('r1')).toEqual(['a']);
    expect(out.get('r2')).toEqual([]);
    expect(assignBreakouts(['a'], []).size).toBe(0);
  });

  it('moves people between rooms and back to the main room', () => {
    const rooms = [{ id: 'r1', userIds: new Set(['a', 'b']) }, { id: 'r2', userIds: new Set(['c']) }];
    moveToRoom(rooms, ['a'], 'r2');
    expect([...rooms[0].userIds]).toEqual(['b']);
    expect([...rooms[1].userIds].sort()).toEqual(['a', 'c']);
    moveToRoom(rooms, ['c'], null);
    expect([...rooms[1].userIds]).toEqual(['a']);
    expect(() => moveToRoom(rooms, ['a'], 'nope')).toThrow();
  });

  it('sends people to their room only while rooms are open', () => {
    const b = { open: false, rooms: [{ id: 'r1', userIds: new Set(['a']) }] };
    expect(roomFor(b, 'a')).toBeNull();
    b.open = true;
    expect(roomFor(b, 'a')).toBe('r1');
    expect(roomFor(b, 'z')).toBeNull();
    expect(roomFor(null, 'a')).toBeNull();
  });
});

describe('guest token scoping', () => {
  const guest = { role: 'guest', guestMeetingId: 'm1' };
  const user = { role: 'user', guestMeetingId: null };

  it('blocks guests from routes not marked for guests', () => {
    expect(guestRouteAllowed(guest, false)).toBe(false);
    expect(guestRouteAllowed(guest, true)).toBe(true);
    expect(guestRouteAllowed(user, false)).toBe(true);
    // Directory-style guest accounts (role guest without a meeting) aren't meeting-scoped.
    expect(guestRouteAllowed({ role: 'guest', guestMeetingId: null }, false)).toBe(true);
  });

  it('limits guests to their own meeting', () => {
    expect(guestMeetingAllowed(guest, 'm1')).toBe(true);
    expect(guestMeetingAllowed(guest, 'm2')).toBe(false);
    expect(guestMeetingAllowed(user, 'm2')).toBe(true);
  });

  it('marks and cleans guest names', () => {
    expect(guestDisplayName('  Ada   Lovelace ')).toBe('Ada Lovelace (Guest)');
    expect(guestDisplayName('\u0000\u0007')).toBe('Guest (Guest)');
    expect(guestDisplayName('x'.repeat(100)).length).toBe(60 + ' (Guest)'.length);
  });
});

describe('poll permissions', () => {
  it('lets organizers and presenters run polls, not attendees', () => {
    expect(canRunMeeting('organizer')).toBe(true);
    expect(canRunMeeting('coorganizer')).toBe(true);
    expect(canRunMeeting('presenter')).toBe(true);
    expect(canRunMeeting('attendee')).toBe(false);
    expect(canRunMeeting(null)).toBe(false);
  });

  it('hides drafts and live results from attendees until they vote', () => {
    expect(pollVisible('draft', false)).toBe(false);
    expect(pollVisible('draft', true)).toBe(true);
    expect(pollVisible('live', false)).toBe(true);
    expect(pollResultsVisible('live', false, false)).toBe(false);
    expect(pollResultsVisible('live', false, true)).toBe(true);
    expect(pollResultsVisible('closed', false, false)).toBe(true);
    expect(pollResultsVisible('live', true, false)).toBe(true);
  });

  it('validates ballots', () => {
    const poll = { status: 'live', options: ['a', 'b', 'c'], multiple: false };
    expect(validBallot(poll, [1])).toBeNull();
    expect(validBallot(poll, [0, 1])).toMatch(/one option/);
    expect(validBallot(poll, [3])).toMatch(/options/);
    expect(validBallot({ ...poll, multiple: true }, [0, 2, 2])).toBeNull();
    expect(validBallot({ ...poll, status: 'closed' }, [0])).toMatch(/isn’t open/);
    expect(validBallot({ ...poll, status: 'draft' }, [0])).toMatch(/isn’t open/);
  });
});

describe('Q&A permissions', () => {
  const q = (status: 'pending' | 'published' | 'answered' | 'dismissed', authorId = 'author') => ({ status, authorId, anonymous: false });

  it('keeps pending questions between the author and moderators', () => {
    expect(questionVisible(q('pending'), 'someone', false)).toBe(false);
    expect(questionVisible(q('pending'), 'author', false)).toBe(true);
    expect(questionVisible(q('pending'), 'mod', true)).toBe(true);
    expect(questionVisible(q('published'), 'someone', false)).toBe(true);
    expect(questionVisible(q('dismissed'), 'someone', false)).toBe(false);
  });

  it('skips moderation for moderators or when moderation is off', () => {
    expect(initialQuestionStatus(true, false)).toBe('pending');
    expect(initialQuestionStatus(true, true)).toBe('published');
    expect(initialQuestionStatus(false, false)).toBe('published');
  });

  it('allows moderation actions only to moderators and upvotes only on others’ published questions', () => {
    expect(questionActionAllowed('publish', q('pending'), 'x', false)).toBe(false);
    expect(questionActionAllowed('publish', q('pending'), 'mod', true)).toBe(true);
    expect(questionActionAllowed('dismiss', q('published'), 'author', false)).toBe(false);
    expect(questionActionAllowed('delete', q('pending'), 'author', false)).toBe(true);
    expect(questionActionAllowed('delete', q('pending'), 'x', false)).toBe(false);
    expect(questionActionAllowed('upvote', q('published'), 'x', false)).toBe(true);
    expect(questionActionAllowed('upvote', q('published'), 'author', false)).toBe(false);
    expect(questionActionAllowed('upvote', q('pending'), 'mod', true)).toBe(false);
    expect(questionActionAllowed('upvote', q('answered'), 'x', false)).toBe(false);
  });

  it('hides anonymous authors from everyone but themselves', () => {
    expect(showQuestionAuthor({ anonymous: true, authorId: 'a' }, 'b')).toBe(false);
    expect(showQuestionAuthor({ anonymous: true, authorId: 'a' }, 'a')).toBe(true);
    expect(showQuestionAuthor({ anonymous: false, authorId: 'a' }, 'b')).toBe(true);
  });
});

describe('recording expiry', () => {
  it('expires after the retention period (default 90 days)', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    const exp = recordingExpiry(start, 90);
    expect(exp.toISOString()).toBe('2026-04-01T10:00:00.000Z');
    expect(isRecordingExpired({ expiresAt: exp }, new Date('2026-04-01T09:59:59Z'))).toBe(false);
    expect(isRecordingExpired({ expiresAt: exp }, new Date('2026-04-01T10:00:00Z'))).toBe(true);
  });

  it('maps egress status and builds the storage key', () => {
    expect(recordingStatusFromEgress(0)).toBeNull();
    expect(recordingStatusFromEgress(1)).toBeNull();
    expect(recordingStatusFromEgress(2)).toBe('processing');
    expect(recordingStatusFromEgress(3)).toBe('ready');
    expect(recordingStatusFromEgress(6)).toBe('ready');
    expect(recordingStatusFromEgress(4)).toBe('failed');
    expect(recordingStatusFromEgress(5)).toBe('failed');
    expect(recordingKey('m1', 'r1')).toBe('recordings/m1/r1.mp4');
  });
});
