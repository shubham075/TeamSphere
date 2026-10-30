import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type {
  AttendanceReport, FreeBusyInfo, MeetingActivityEvent, MeetingInfo, MeetingOccurrence, MeetingPollInfo, MeetingQuestionInfo,
  RecordingInfo, Recurrence, WorkingHours,
} from '@teamsphere/shared';
import { MEETING_JOIN_EARLY_MINUTES, WS_EVENTS } from '@teamsphere/shared';
import { api } from './api';
import { getSocket } from './socket';

export const mk = {
  all: ['meetings'] as const,
  calendar: (from: string, to: string) => ['meetings', 'calendar', from, to] as const,
  meeting: (id: string) => ['meetings', 'one', id] as const,
  attendance: (id: string) => ['meetings', 'attendance', id] as const,
  workingHours: ['meetings', 'working-hours'] as const,
  live: (key: string) => ['meetings', 'live', key] as const,
};

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function useCalendar(from: Date, to: Date) {
  const f = from.toISOString();
  const t = to.toISOString();
  return useQuery({
    queryKey: mk.calendar(f, t),
    queryFn: () => api<MeetingOccurrence[]>(`/meetings/calendar?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`),
    // Keeps "live" badges and countdowns fresh even if a realtime event was missed.
    refetchInterval: 60_000,
  });
}

export function useMeeting(id: string | null) {
  return useQuery({ queryKey: mk.meeting(id ?? ''), queryFn: () => api<MeetingInfo>(`/meetings/${id}`), enabled: !!id });
}

export function useAttendance(id: string, enabled: boolean) {
  return useQuery({ queryKey: mk.attendance(id), queryFn: () => api<AttendanceReport[]>(`/meetings/${id}/attendance`), enabled });
}

export function useWorkingHours() {
  return useQuery({ queryKey: mk.workingHours, queryFn: () => api<WorkingHours>(`/meetings/working-hours?tz=${encodeURIComponent(browserTimeZone())}`) });
}

/** The meeting currently running in a chat or channel (for the header's Join button). */
export function useLiveMeeting(where: { conversationId?: string; channelId?: string }) {
  const q = where.channelId ? `channelId=${where.channelId}` : `conversationId=${where.conversationId}`;
  return useQuery({
    queryKey: mk.live(q),
    queryFn: () => api<{ meetingId: string; sessionId: string } | null>(`/meetings/live?${q}`),
    refetchInterval: 30_000,
  });
}

export function fetchFreeBusy(q: { userIds: string[]; from: Date; to: Date; durationMin: number; excludeMeetingId?: string }) {
  const params = new URLSearchParams({
    userIds: q.userIds.join(','), from: q.from.toISOString(), to: q.to.toISOString(), duration: String(q.durationMin), tz: browserTimeZone(),
  });
  if (q.excludeMeetingId) params.set('exclude', q.excludeMeetingId);
  return api<FreeBusyInfo>(`/meetings/free-busy?${params}`);
}

// ------------------------------------------------------------------ dates (local time)

export const DAY_MS = 86_400_000;

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based week start. */
export function startOfWeek(d: Date) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtRange = (a: string, b: string) => `${fmtDate(a)} · ${fmtTime(a)} – ${fmtTime(b)}`;

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function recurrenceLabel(r: Recurrence | null): string | null {
  if (!r) return null;
  const every = r.interval > 1 ? `Every ${r.interval} ` : 'Every ';
  let s: string;
  if (r.freq === 'daily') s = r.interval > 1 ? `${every}days` : 'Every day';
  else if (r.freq === 'weekly') {
    const days = r.byWeekday?.length ? r.byWeekday.map((d) => WEEKDAYS[d]).join(', ') : '';
    s = (r.interval > 1 ? `${every}weeks` : 'Every week') + (days ? ` on ${days}` : '');
  } else s = r.interval > 1 ? `${every}months` : 'Every month';
  if (r.until) s += ` until ${new Date(r.until).toLocaleDateString()}`;
  if (r.count) s += `, ${r.count} times`;
  return s;
}

/** "Join" shows from a few minutes before the start until the end, or whenever the meeting is live. */
export function canJoinNow(o: { startAt: string; endAt: string; live?: boolean }, now = Date.now()) {
  return !!o.live || (now >= new Date(o.startAt).getTime() - MEETING_JOIN_EARLY_MINUTES * 60_000 && now < new Date(o.endAt).getTime());
}

export function countdown(startAt: string, now = Date.now()): string | null {
  const ms = new Date(startAt).getTime() - now;
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  if (min < 24 * 60) return `in ${Math.floor(min / 60)} h ${min % 60} min`;
  return null;
}

export const RSVP_LABEL = { none: 'No response', accepted: 'Accepted', tentative: 'Tentative', declined: 'Declined' } as const;
export const ROLE_LABEL = { organizer: 'Organizer', coorganizer: 'Co-organizer', presenter: 'Presenter', attendee: 'Attendee' } as const;

// ---------------------------------------------------------------- Phase 5b: recordings, polls, Q&A

export const mk5 = {
  recordings: (id: string) => ['meetings', 'recordings', id] as const,
  polls: (id: string) => ['meetings', 'polls', id] as const,
  questions: (id: string) => ['meetings', 'questions', id] as const,
};

export function useRecordings(id: string, enabled = true) {
  return useQuery({ queryKey: mk5.recordings(id), queryFn: () => api<RecordingInfo[]>(`/meetings/${id}/recordings`), enabled });
}

export function useMeetingPolls(id: string) {
  return useQuery({ queryKey: mk5.polls(id), queryFn: () => api<MeetingPollInfo[]>(`/meetings/${id}/polls`) });
}

export function useMeetingQuestions(id: string, enabled = true) {
  return useQuery({ queryKey: mk5.questions(id), queryFn: () => api<MeetingQuestionInfo[]>(`/meetings/${id}/questions`), enabled });
}

/** Keeps a meeting's polls / Q&A / recordings fresh; `onLaunch` fires when an organizer launches a poll. */
export function useMeetingActivity(meetingId: string, onLaunch?: (pollId: string) => void) {
  const qc = useQueryClient();
  const launch = useRef(onLaunch);
  launch.current = onLaunch;
  useEffect(() => {
    const socket = getSocket();
    const on = (e: MeetingActivityEvent) => {
      if (e.meetingId !== meetingId) return;
      const key = e.kind === 'polls' ? mk5.polls(meetingId) : e.kind === 'questions' ? mk5.questions(meetingId) : mk5.recordings(meetingId);
      void qc.invalidateQueries({ queryKey: key });
      if (e.launchedPollId) launch.current?.(e.launchedPollId);
    };
    socket.on(WS_EVENTS.meetingActivity, on);
    return () => void socket.off(WS_EVENTS.meetingActivity, on);
  }, [meetingId, qc]);
}

export function fmtBytes(n: number | null) {
  if (n === null) return '';
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`;
}
