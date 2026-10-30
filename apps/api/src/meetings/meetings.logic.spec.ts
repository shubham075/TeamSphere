import { describe, expect, it } from 'vitest';
import { DEFAULT_MEETING_OPTIONS, type MeetingOptions } from '@teamsphere/shared';
import {
  bypassesLobby, canPresent, effectiveRole, expandOccurrences, fromZoned, isOccurrenceOf, mergeIntervals,
  publishSources, suggestTimes, summarizeAttendance, withinWorkingHours, zonedParts,
} from './meetings.logic';

const iso = (d: Date) => d.toISOString();
const opts = (o: Partial<MeetingOptions> = {}): MeetingOptions => ({ ...DEFAULT_MEETING_OPTIONS, ...o });

describe('time zones', () => {
  it('round-trips wall clock times across DST', () => {
    const summer = fromZoned(2026, 7, 1, 9, 0, 0, 'Europe/Berlin');
    expect(iso(summer)).toBe('2026-07-01T07:00:00.000Z');
    const winter = fromZoned(2026, 12, 1, 9, 0, 0, 'Europe/Berlin');
    expect(iso(winter)).toBe('2026-12-01T08:00:00.000Z');
    expect(zonedParts(winter, 'Europe/Berlin')).toMatchObject({ hour: 9, weekday: 2 });
  });
});

describe('recurrence expansion', () => {
  const base = { exceptions: {}, timeZone: 'Europe/Berlin' };

  it('expands a weekly rule on several weekdays and keeps local time through DST', () => {
    // Mon 2026-10-19 09:00 Berlin (CEST); DST ends on 2026-10-25.
    const startAt = fromZoned(2026, 10, 19, 9, 0, 0, 'Europe/Berlin');
    const series = { ...base, startAt, endAt: new Date(startAt.getTime() + 30 * 60_000), recurrence: { freq: 'weekly' as const, interval: 1, byWeekday: [1, 3] } };
    const occ = expandOccurrences(series, new Date('2026-10-19T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(occ.map((o) => iso(o.startAt))).toEqual([
      '2026-10-19T07:00:00.000Z', '2026-10-21T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-10-28T08:00:00.000Z',
    ]);
    expect(occ.every((o) => zonedParts(o.startAt, 'Europe/Berlin').hour === 9)).toBe(true);
  });

  it('honours interval, count and until', () => {
    const startAt = new Date('2026-01-01T10:00:00Z');
    const endAt = new Date('2026-01-01T11:00:00Z');
    const daily = expandOccurrences({ ...base, timeZone: 'UTC', startAt, endAt, recurrence: { freq: 'daily', interval: 2, count: 3 } }, startAt, new Date('2027-01-01Z'));
    expect(daily.map((o) => iso(o.startAt))).toEqual(['2026-01-01T10:00:00.000Z', '2026-01-03T10:00:00.000Z', '2026-01-05T10:00:00.000Z']);
    const until = expandOccurrences({ ...base, timeZone: 'UTC', startAt, endAt, recurrence: { freq: 'daily', interval: 1, until: '2026-01-02T23:59:59Z' } }, startAt, new Date('2027-01-01Z'));
    expect(until).toHaveLength(2);
  });

  it('skips months without the day for monthly rules', () => {
    const startAt = new Date('2026-01-31T10:00:00Z');
    const occ = expandOccurrences({ ...base, timeZone: 'UTC', startAt, endAt: new Date('2026-01-31T11:00:00Z'), recurrence: { freq: 'monthly', interval: 1, count: 3 } }, startAt, new Date('2027-01-01Z'));
    expect(occ.map((o) => iso(o.startAt).slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('applies moved and cancelled exceptions', () => {
    const startAt = new Date('2026-03-02T10:00:00Z');
    const series = {
      timeZone: 'UTC', startAt, endAt: new Date('2026-03-02T10:30:00Z'), recurrence: { freq: 'daily' as const, interval: 1, count: 3 },
      exceptions: {
        '2026-03-03T10:00:00.000Z': { startAt: '2026-03-03T15:00:00.000Z', endAt: '2026-03-03T16:00:00.000Z' },
        '2026-03-04T10:00:00.000Z': { cancelled: true },
      },
    };
    const occ = expandOccurrences(series, startAt, new Date('2026-04-01Z'));
    expect(occ.map((o) => [iso(o.startAt), iso(o.endAt), o.cancelled])).toEqual([
      ['2026-03-02T10:00:00.000Z', '2026-03-02T10:30:00.000Z', false],
      ['2026-03-03T15:00:00.000Z', '2026-03-03T16:00:00.000Z', false],
      ['2026-03-04T10:00:00.000Z', '2026-03-04T10:30:00.000Z', true],
    ]);
    expect(occ[1].occurrence.toISOString()).toBe('2026-03-03T10:00:00.000Z');
    expect(isOccurrenceOf(series, new Date('2026-03-03T10:00:00Z'))).toBe(true);
    expect(isOccurrenceOf(series, new Date('2026-03-03T11:00:00Z'))).toBe(false);
  });

  it('returns a single meeting only when it overlaps the window', () => {
    const series = { ...base, startAt: new Date('2026-05-01T10:00:00Z'), endAt: new Date('2026-05-01T11:00:00Z'), recurrence: null };
    expect(expandOccurrences(series, new Date('2026-05-01T10:30:00Z'), new Date('2026-05-02Z'))).toHaveLength(1);
    expect(expandOccurrences(series, new Date('2026-05-01T11:00:00Z'), new Date('2026-05-02Z'))).toHaveLength(0);
  });
});

describe('free/busy', () => {
  const t = (h: number, m = 0) => Date.UTC(2026, 10, 2, h, m); // Monday 2026-11-02
  const wh = { timeZone: 'UTC', days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 };

  it('merges overlapping intervals and keeps tentative only when all parts are tentative', () => {
    expect(mergeIntervals([{ start: t(10), end: t(11), tentative: true }, { start: t(10, 30), end: t(12) }, { start: t(14), end: t(15), tentative: true }])).toEqual([
      { start: t(10), end: t(12), tentative: false },
      { start: t(14), end: t(15), tentative: true },
    ]);
  });

  it('checks working hours', () => {
    expect(withinWorkingHours(new Date(t(9)), new Date(t(17)), wh)).toBe(true);
    expect(withinWorkingHours(new Date(t(16, 30)), new Date(t(17, 30)), wh)).toBe(false);
    expect(withinWorkingHours(new Date(Date.UTC(2026, 10, 1, 10)), new Date(Date.UTC(2026, 10, 1, 11)), wh)).toBe(false); // Sunday
  });

  it('suggests the first free slots inside everyone’s working hours', () => {
    const busyA = [{ start: t(9), end: t(10) }];
    const busyB = [{ start: t(10), end: t(11, 30), tentative: true }];
    const out = suggestTimes({ busy: [busyA, busyB], workingHours: [wh, { ...wh, startMinute: 10 * 60 }], from: new Date(t(8)), to: new Date(t(18)), durationMin: 60, max: 3 });
    expect(out.map((s) => iso(s.start))).toEqual(['2026-11-02T11:30:00.000Z', '2026-11-02T12:00:00.000Z', '2026-11-02T12:30:00.000Z']);
  });
});

describe('roles and lobby', () => {
  it('lets organizers bypass and applies the bypass option to others', () => {
    expect(bypassesLobby('coorganizer', false, opts({ lobbyBypass: 'organizers' }))).toBe(true);
    expect(bypassesLobby('attendee', true, opts({ lobbyBypass: 'organizers' }))).toBe(false);
    expect(bypassesLobby('attendee', true, opts({ lobbyBypass: 'invited' }))).toBe(true);
    expect(bypassesLobby(null, false, opts({ lobbyBypass: 'invited' }))).toBe(false);
    expect(bypassesLobby(null, false, opts({ lobbyBypass: 'everyone' }))).toBe(true);
  });

  it('limits presenting and publishing by role and host switches', () => {
    const o = opts({ whoCanPresent: 'organizers' });
    expect(canPresent('attendee', o)).toBe(false);
    expect(canPresent('presenter', o)).toBe(true);
    expect(publishSources('attendee', o, { allowAttendeeMic: false, allowAttendeeCamera: true })).toEqual(['camera']);
    expect(publishSources('presenter', o, { allowAttendeeMic: false, allowAttendeeCamera: false })).toEqual(['microphone', 'camera', 'screen_share', 'screen_share_audio']);
    expect(effectiveRole(undefined, false, o)).toBe('attendee');
    expect(effectiveRole(undefined, false, opts())).toBe('presenter');
    expect(effectiveRole('attendee', true, o)).toBe('organizer');
  });
});

describe('attendance', () => {
  it('sums rejoins per user and keeps open intervals running', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
    const out = summarizeAttendance([
      { userId: 'a', role: 'organizer', joinedAt: at(0), leftAt: at(10) },
      { userId: 'b', role: 'attendee', joinedAt: at(2), leftAt: at(5) },
      { userId: 'b', role: 'presenter', joinedAt: at(7), leftAt: null },
    ], at(12));
    expect(out.map((r) => [r.userId, r.role, r.durationSec, r.lastLeaveAt && iso(r.lastLeaveAt)])).toEqual([
      ['a', 'organizer', 600, '2026-01-01T10:10:00.000Z'],
      ['b', 'presenter', 480, null],
    ]);
  });
});
