import type {
  MeetingException, MeetingOptions, MeetingRole, Recurrence, WorkingHours,
} from '@teamsphere/shared';

// Pure scheduling logic (no I/O) so it can be unit-tested: time zones, recurrence, free/busy, roles.

const DAY_MS = 86_400_000;
/** Hard stop for runaway rules (e.g. a daily series with no end, expanded over a long range). */
const MAX_ITERATIONS = 5_000;

// ------------------------------------------------------------------ time zones

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
    } catch {
      // Unknown zone names fall back to UTC rather than failing the whole calendar.
      f = formatter('UTC');
    }
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at `date`, in ms (positive east of UTC). */
function offsetMs(date: Date, tz: string): number {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock fields of `date` in `tz`. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const local = new Date(date.getTime() + offsetMs(date, tz));
  return {
    year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(), weekday: local.getUTCDay(),
  };
}

/** The instant whose wall clock in `tz` reads the given fields (DST gaps resolve forward). */
export function fromZoned(year: number, month: number, day: number, hour: number, minute: number, second: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = offsetMs(new Date(guess), tz);
  let t = guess - first;
  const second2 = offsetMs(new Date(t), tz);
  if (second2 !== first) t = guess - second2;
  return new Date(t);
}

/** Calendar date `n` days after (year, month, day), as UTC-normalized fields. */
function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

// ------------------------------------------------------------------ recurrence

export interface SeriesInput {
  startAt: Date;
  endAt: Date;
  timeZone: string;
  recurrence: Recurrence | null;
  exceptions: Record<string, MeetingException>;
}

export interface Occurrence {
  /** Original (rule-generated) start; the occurrence's id within the series. */
  occurrence: Date;
  startAt: Date;
  endAt: Date;
  cancelled: boolean;
}

/** Rule-generated starts in order, before exceptions; stops at `until`, `count`, or once past `before`. */
export function* ruleStarts(series: Pick<SeriesInput, 'startAt' | 'timeZone' | 'recurrence'>, before: Date): Generator<Date> {
  const { startAt, timeZone: tz, recurrence: r } = series;
  if (!r) {
    yield startAt;
    return;
  }
  const base = zonedParts(startAt, tz);
  const until = r.until ? new Date(r.until) : null;
  const interval = Math.max(1, r.interval ?? 1);
  let produced = 0;
  const emit = (y: number, m: number, d: number): Date | null => {
    const at = fromZoned(y, m, d, base.hour, base.minute, base.second, tz);
    if (at < startAt) return null;
    return at;
  };
  const done = (at: Date) => (until && at > until) || (r.count && produced >= r.count) || at >= before;

  for (let k = 0; k < MAX_ITERATIONS; k++) {
    let candidates: Date[] = [];
    if (r.freq === 'daily') {
      const d = addDays(base.year, base.month, base.day, k * interval);
      candidates = [emit(d.year, d.month, d.day)].filter((x): x is Date => !!x);
    } else if (r.freq === 'weekly') {
      const days = [...new Set(r.byWeekday?.length ? r.byWeekday : [base.weekday])].sort((a, b) => a - b);
      const weekStart = addDays(base.year, base.month, base.day, -base.weekday + k * interval * 7);
      candidates = days
        .map((wd) => addDays(weekStart.year, weekStart.month, weekStart.day, wd))
        .map((d) => emit(d.year, d.month, d.day))
        .filter((x): x is Date => !!x);
    } else {
      const monthIndex = base.month - 1 + k * interval;
      const y = base.year + Math.floor(monthIndex / 12);
      const m = (monthIndex % 12) + 1;
      // Months without that day (e.g. the 31st) are skipped, like most calendar apps.
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (base.day <= daysInMonth) candidates = [emit(y, m, base.day)].filter((x): x is Date => !!x);
    }
    for (const at of candidates) {
      if (done(at)) return;
      produced++;
      yield at;
    }
  }
}

/** Occurrences overlapping [from, to), exceptions applied (moved / cancelled). Cancelled ones are kept, flagged. */
export function expandOccurrences(series: SeriesInput, from: Date, to: Date): Occurrence[] {
  const duration = series.endAt.getTime() - series.startAt.getTime();
  // A moved occurrence can land inside the window although its original start is outside; look a bit wider.
  const slack = 31 * DAY_MS;
  const out: Occurrence[] = [];
  for (const original of ruleStarts(series, new Date(to.getTime() + slack))) {
    if (original.getTime() + duration < from.getTime() - slack) continue;
    const ex = series.exceptions[original.toISOString()];
    const startAt = ex?.startAt ? new Date(ex.startAt) : original;
    const endAt = ex?.endAt ? new Date(ex.endAt) : new Date(startAt.getTime() + duration);
    if (endAt > from && startAt < to) out.push({ occurrence: original, startAt, endAt, cancelled: !!ex?.cancelled });
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Whether `occurrence` (an original start) is generated by the series. */
export function isOccurrenceOf(series: SeriesInput, occurrence: Date): boolean {
  for (const at of ruleStarts(series, new Date(occurrence.getTime() + 1))) if (at.getTime() === occurrence.getTime()) return true;
  return false;
}

// ------------------------------------------------------------------ free/busy

export interface Interval {
  start: number;
  end: number;
  tentative?: boolean;
}

/** Sorted, merged busy intervals. A merged block is tentative only if every part of it was tentative. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      last.end = Math.max(last.end, i.end);
      last.tentative = !!last.tentative && !!i.tentative;
    } else out.push({ ...i, tentative: !!i.tentative });
  }
  return out;
}

export function overlaps(a: Interval, list: Interval[]): boolean {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

/** Whether [start, end) lies within one working day of `wh`. */
export function withinWorkingHours(start: Date, end: Date, wh: WorkingHours): boolean {
  const s = zonedParts(start, wh.timeZone);
  const e = zonedParts(new Date(end.getTime() - 1), wh.timeZone);
  if (s.year !== e.year || s.month !== e.month || s.day !== e.day) return false;
  if (!wh.days.includes(s.weekday)) return false;
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute + 1;
  return startMin >= wh.startMinute && endMin <= wh.endMinute;
}

/**
 * Suggested meeting times: the first `max` slots in [from, to) on a `stepMin` grid that fall in everyone's
 * working hours and clash with nobody's busy time (tentative counts as busy).
 */
export function suggestTimes(opts: {
  busy: Interval[][];
  workingHours: WorkingHours[];
  from: Date;
  to: Date;
  durationMin: number;
  stepMin?: number;
  max?: number;
}): { start: Date; end: Date }[] {
  const step = (opts.stepMin ?? 30) * 60_000;
  const duration = opts.durationMin * 60_000;
  const out: { start: Date; end: Date }[] = [];
  let t = Math.ceil(opts.from.getTime() / step) * step;
  for (let i = 0; i < MAX_ITERATIONS * 4 && t + duration <= opts.to.getTime() && out.length < (opts.max ?? 5); i++, t += step) {
    const slot = { start: t, end: t + duration };
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    if (!opts.workingHours.every((wh) => withinWorkingHours(start, end, wh))) continue;
    if (opts.busy.some((b) => overlaps(slot, b))) continue;
    out.push({ start, end });
  }
  return out;
}

// ------------------------------------------------------------------ roles & lobby

export const isOrganizerRole = (role: MeetingRole | null | undefined) => role === 'organizer' || role === 'coorganizer';

export function canPresent(role: MeetingRole | null, options: MeetingOptions): boolean {
  if (isOrganizerRole(role) || role === 'presenter') return true;
  return options.whoCanPresent === 'everyone';
}

/**
 * Whether a joining user skips the lobby. `invited` = on the attendee list or a member of the meeting's channel.
 * Organizers always bypass; a locked meeting is handled separately (nobody new gets in, not even the lobby).
 */
export function bypassesLobby(role: MeetingRole | null, invited: boolean, options: MeetingOptions): boolean {
  if (isOrganizerRole(role)) return true;
  if (options.lobbyBypass === 'everyone') return true;
  if (options.lobbyBypass === 'invited') return invited;
  return false;
}

export type PublishSource = 'microphone' | 'camera' | 'screen_share' | 'screen_share_audio';

/** What a participant may publish, given role, meeting options and the live "disable attendee mic/camera" switches. */
export function publishSources(role: MeetingRole | null, options: MeetingOptions, live: { allowAttendeeMic: boolean; allowAttendeeCamera: boolean }): PublishSource[] {
  const elevated = isOrganizerRole(role) || role === 'presenter';
  const out: PublishSource[] = [];
  if (elevated || live.allowAttendeeMic) out.push('microphone');
  if (elevated || live.allowAttendeeCamera) out.push('camera');
  if (canPresent(role, options)) out.push('screen_share', 'screen_share_audio');
  return out;
}

/** Effective role of a user: attendee row role, else attendee (joined by link / channel membership). */
export function effectiveRole(attendeeRole: MeetingRole | undefined, isOrganizer: boolean, options: MeetingOptions): MeetingRole {
  if (isOrganizer) return 'organizer';
  if (attendeeRole && attendeeRole !== 'attendee') return attendeeRole;
  // "Everyone can present" makes plain attendees presenters, as in the options page wording.
  return options.whoCanPresent === 'everyone' ? 'presenter' : 'attendee';
}

// ------------------------------------------------------------------ attendance

export interface AttendanceRow {
  userId: string;
  role: MeetingRole;
  joinedAt: Date;
  leftAt: Date | null;
}

/** Folds join/leave rows into one record per user; open intervals count up to `now` (or the session end). */
export function summarizeAttendance(rows: AttendanceRow[], until: Date) {
  const byUser = new Map<string, AttendanceRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  return [...byUser.entries()]
    .map(([userId, list]) => {
      const sorted = list.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
      const merged = mergeIntervals(sorted.map((r) => ({ start: r.joinedAt.getTime(), end: (r.leftAt ?? until).getTime() })));
      const durationSec = Math.round(merged.reduce((s, i) => s + (i.end - i.start), 0) / 1000);
      const open = sorted.some((r) => !r.leftAt);
      const lastLeave = open ? null : new Date(Math.max(...sorted.map((r) => r.leftAt!.getTime())));
      // The highest role the user had (roles can change mid-meeting).
      const rank: MeetingRole[] = ['organizer', 'coorganizer', 'presenter', 'attendee'];
      const role = rank.find((x) => sorted.some((r) => r.role === x)) ?? 'attendee';
      return { userId, role, firstJoinAt: sorted[0].joinedAt, lastLeaveAt: lastLeave, durationSec, intervals: sorted.map((r) => ({ joinedAt: r.joinedAt, leftAt: r.leftAt })) };
    })
    .sort((a, b) => a.firstJoinAt.getTime() - b.firstJoinAt.getTime());
}
