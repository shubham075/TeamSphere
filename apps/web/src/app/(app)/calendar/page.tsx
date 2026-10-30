'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Loader2, Plus, Repeat, Video } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { MeetingInfo, MeetingOccurrence } from '@teamsphere/shared';
import { MeetingDetails } from '@/components/meetings/meeting-details';
import { MeetingForm } from '@/components/meetings/meeting-form';
import { errorText, primaryButton, secondaryButton } from '@/components/teams/ui';
import { api } from '@/lib/api';
import {
  addDays, canJoinNow, countdown, DAY_MS, fmtTime, mk, sameDay, startOfDay, startOfMonth, startOfWeek, useCalendar,
} from '@/lib/meetings';

type View = 'day' | 'workweek' | 'week' | 'month' | 'agenda';
const VIEWS: { id: View; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'workweek', label: 'Work week' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Agenda' },
];
const HOUR_PX = 48;
const VIEW_KEY = 'teamsphere.calendarView';

function range(view: View, anchor: Date): { from: Date; to: Date; days: Date[] } {
  if (view === 'day') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1), days: [from] };
  }
  if (view === 'workweek' || view === 'week') {
    const from = startOfWeek(anchor);
    const n = view === 'week' ? 7 : 5;
    return { from, to: addDays(from, n), days: Array.from({ length: n }, (_, i) => addDays(from, i)) };
  }
  if (view === 'month') {
    const from = startOfWeek(startOfMonth(anchor));
    return { from, to: addDays(from, 42), days: Array.from({ length: 42 }, (_, i) => addDays(from, i)) };
  }
  const from = startOfDay(anchor);
  return { from, to: addDays(from, 30), days: Array.from({ length: 30 }, (_, i) => addDays(from, i)) };
}

function step(view: View, anchor: Date, dir: number) {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  if (view === 'agenda') return addDays(anchor, dir * 30);
  return addDays(anchor, dir * 7);
}

export default function CalendarPage() {
  return (
    <Suspense>
      <Calendar />
    </Suspense>
  );
}

function Calendar() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('workweek');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<{ meetingId: string; occ: MeetingOccurrence | null } | null>(null);
  const [form, setForm] = useState<{ start?: Date } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const now = useNow();

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as View | null;
      if (v && VIEWS.some((x) => x.id === v)) setView(v);
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    const id = params.get('meeting');
    if (id) setSelected({ meetingId: id, occ: null });
  }, [params]);

  const { from, to, days } = useMemo(() => range(view, anchor), [view, anchor]);
  const { data: occurrences, isLoading } = useCalendar(from, to);
  const visible = useMemo(() => (occurrences ?? []).filter((o) => view === 'agenda' || (!o.cancelled && o.myRsvp !== 'declined')), [occurrences, view]);

  function chooseView(v: View) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }

  async function meetNow() {
    setStarting(true);
    setError(null);
    try {
      const m = await api<MeetingInfo>('/meetings/instant', { method: 'POST', json: {} });
      await qc.invalidateQueries({ queryKey: mk.all });
      router.push(`/meetings/${m.id}`);
    } catch (e) {
      setError(errorText(e));
      setStarting(false);
    }
  }

  const title = view === 'month'
    ? anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : view === 'day'
      ? anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[days.length - 1].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const open = (o: MeetingOccurrence) => setSelected({ meetingId: o.meetingId, occ: o });

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h1 className="mr-2 text-xl font-semibold">Calendar</h1>
          <button onClick={() => setAnchor(new Date())} className={secondaryButton}>Today</button>
          <button onClick={() => setAnchor((a) => step(view, a, -1))} aria-label="Previous" className="rounded p-1.5 hover:bg-surface-hover"><ChevronLeft size={18} /></button>
          <button onClick={() => setAnchor((a) => step(view, a, 1))} aria-label="Next" className="rounded p-1.5 hover:bg-surface-hover"><ChevronRight size={18} /></button>
          <span className="font-medium" aria-live="polite">{title}</span>
          {isLoading && <Loader2 size={16} className="animate-spin text-muted" />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Calendar view" className="flex rounded-md border border-border p-0.5">
              {VIEWS.map((v) => (
                <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => chooseView(v.id)} className={clsx('rounded px-2.5 py-1 text-sm', view === v.id ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover')}>
                  {v.label}
                </button>
              ))}
            </div>
            <button onClick={() => void meetNow()} disabled={starting} className={clsx(secondaryButton, 'flex items-center gap-1.5')}>
              <Video size={16} /> Meet now
            </button>
            <button onClick={() => setForm({})} className={clsx(primaryButton, 'flex items-center gap-1.5')}>
              <Plus size={16} /> New meeting
            </button>
          </div>
        </header>
        {error && <p role="alert" className="px-4 py-2 text-sm text-danger">{error}</p>}
        <UpNext occurrences={occurrences ?? []} now={now} onOpen={open} />
        {view === 'month' ? (
          <MonthGrid days={days} month={anchor.getMonth()} items={visible} onOpen={open} onDay={(d) => { setAnchor(d); chooseView('day'); }} />
        ) : view === 'agenda' ? (
          <Agenda items={visible} now={now} onOpen={open} />
        ) : (
          <TimeGrid days={days} items={visible} now={now} onOpen={open} onSlot={(start) => setForm({ start })} />
        )}
      </section>
      {selected && <MeetingDetails key={`${selected.meetingId}:${selected.occ?.occurrence}`} meetingId={selected.meetingId} occurrence={selected.occ} onClose={() => { setSelected(null); if (params.get('meeting')) router.replace('/calendar'); }} />}
      {form && (
        <MeetingForm
          initialStart={form.start}
          onClose={() => setForm(null)}
          onSaved={(m) => { setForm(null); setSelected({ meetingId: m.id, occ: null }); }}
        />
      )}
    </div>
  );
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Next meeting in the coming hours with its countdown and Join button. */
function UpNext({ occurrences, now, onOpen }: { occurrences: MeetingOccurrence[]; now: number; onOpen: (o: MeetingOccurrence) => void }) {
  const router = useRouter();
  const next = occurrences.find((o) => !o.cancelled && o.myRsvp !== 'declined' && new Date(o.endAt).getTime() > now && new Date(o.startAt).getTime() - now < 8 * 3_600_000);
  if (!next) return null;
  const joinable = canJoinNow(next, now);
  return (
    <div className="flex items-center gap-3 border-b border-border bg-brand-soft/40 px-4 py-2 text-sm">
      <button onClick={() => onOpen(next)} className="min-w-0 flex-1 truncate text-left">
        <strong>{next.title}</strong> · {fmtTime(next.startAt)}–{fmtTime(next.endAt)}
        <span className="ml-2 text-muted">{next.live ? 'In progress' : countdown(next.startAt, now) ?? 'Now'}</span>
      </button>
      {joinable && (
        <button onClick={() => router.push(`/meetings/${next.meetingId}?occurrence=${encodeURIComponent(next.occurrence)}`)} className={clsx(primaryButton, 'flex items-center gap-1.5 py-1')}>
          <Video size={14} /> Join
        </button>
      )}
    </div>
  );
}

function EventChip({ o, onOpen, compact, style, now }: { o: MeetingOccurrence; onOpen: (o: MeetingOccurrence) => void; compact?: boolean; style?: React.CSSProperties; now?: number }) {
  const router = useRouter();
  const tentative = o.myRsvp === 'tentative' || o.myRsvp === 'none';
  const joinable = !compact && now !== undefined && canJoinNow(o, now) && !o.cancelled;
  return (
    <div
      style={style}
      className={clsx(
        'group flex overflow-hidden rounded border-l-4 border-brand text-left text-xs',
        o.cancelled || o.myRsvp === 'declined' ? 'bg-surface-2 text-muted line-through' : tentative ? 'bg-brand-soft/60' : 'bg-brand-soft',
        compact ? 'items-center' : 'flex-col',
      )}
    >
      <button onClick={() => onOpen(o)} className="min-w-0 flex-1 px-1.5 py-0.5 text-left" aria-label={`${o.title}, ${fmtTime(o.startAt)} to ${fmtTime(o.endAt)}${o.live ? ', in progress' : ''}`}>
        <span className="flex items-center gap-1 truncate font-semibold">
          {o.live && <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />}
          {o.isRecurring && <Repeat size={10} className="shrink-0" aria-hidden />}
          <span className="truncate">{compact ? `${fmtTime(o.startAt)} ${o.title}` : o.title}</span>
        </span>
        {!compact && <span className="block truncate text-muted">{fmtTime(o.startAt)} – {fmtTime(o.endAt)}{o.channelName ? ` · ${o.channelName}` : ''}</span>}
      </button>
      {joinable && (
        <button onClick={() => router.push(`/meetings/${o.meetingId}?occurrence=${encodeURIComponent(o.occurrence)}`)} className="m-1 self-start rounded bg-brand px-2 py-0.5 font-semibold text-brand-text">
          Join
        </button>
      )}
    </div>
  );
}

/** Lays out overlapping events side by side (greedy columns per cluster). */
function layoutDay(items: MeetingOccurrence[], day: Date) {
  const dayStart = day.getTime();
  const dayEnd = dayStart + DAY_MS;
  const evts = items
    .map((o) => ({ o, s: Math.max(new Date(o.startAt).getTime(), dayStart), e: Math.min(new Date(o.endAt).getTime(), dayEnd) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: { o: MeetingOccurrence; s: number; e: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => (c.cols = cols));
    out.push(...cluster);
    cluster = [];
  };
  for (const x of evts) {
    if (cluster.length && x.s >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.e > x.s).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...x, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, x.e);
  }
  flush();
  return out;
}

function TimeGrid({ days, items, now, onOpen, onSlot }: { days: Date[]; items: MeetingOccurrence[]; now: number; onOpen: (o: MeetingOccurrence) => void; onSlot: (d: Date) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 8 * HOUR_PX });
  }, []);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-border pl-14">
        {days.map((d) => (
          <div key={d.toISOString()} className={clsx('flex-1 px-2 py-1.5 text-center text-sm', sameDay(d, new Date(now)) && 'font-semibold text-brand')}>
            {d.toLocaleDateString([], { weekday: 'short' })} <span className="text-lg">{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-14 shrink-0">
            {hours.map((h) => (
              <div key={h} className="relative text-right text-[11px] text-muted" style={{ height: HOUR_PX }}>
                <span className="absolute -top-2 right-2">{h ? `${String(h).padStart(2, '0')}:00` : ''}</span>
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d.toISOString()} className="relative flex-1 border-l border-border">
              {hours.map((h) => (
                <button
                  key={h}
                  onClick={() => { const s = new Date(d); s.setHours(h, 0, 0, 0); onSlot(s); }}
                  // Mouse shortcut only; keyboard and screen reader users have the "New meeting" button.
                  tabIndex={-1}
                  aria-hidden
                  className="block w-full border-b border-border/60 hover:bg-surface-hover"
                  style={{ height: HOUR_PX }}
                />
              ))}
              {layoutDay(items, d).map(({ o, s, e, col, cols }) => (
                <EventChip
                  key={`${o.meetingId}:${o.occurrence}`}
                  o={o}
                  now={now}
                  onOpen={onOpen}
                  style={{
                    position: 'absolute', top: ((s - d.getTime()) / 3_600_000) * HOUR_PX, height: Math.max(20, ((e - s) / 3_600_000) * HOUR_PX - 2),
                    left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
                  }}
                />
              ))}
              {sameDay(d, new Date(now)) && (
                <div aria-hidden className="pointer-events-none absolute right-0 left-0 border-t-2 border-danger" style={{ top: ((now - d.getTime()) / 3_600_000) * HOUR_PX }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ days, month, items, onOpen, onDay }: { days: Date[]; month: number; items: MeetingOccurrence[]; onOpen: (o: MeetingOccurrence) => void; onDay: (d: Date) => void }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] overflow-y-auto">
      {days.slice(0, 7).map((d) => (
        <div key={d.toISOString()} className="border-b border-border px-2 py-1 text-xs text-muted">{d.toLocaleDateString([], { weekday: 'short' })}</div>
      ))}
      {days.map((d) => {
        const list = items.filter((o) => sameDay(new Date(o.startAt), d));
        return (
          <div key={d.toISOString()} className={clsx('min-h-24 border-r border-b border-border p-1', d.getMonth() !== month && 'bg-surface-2/40 text-muted')}>
            <button onClick={() => onDay(d)} className={clsx('mb-1 rounded px-1 text-xs hover:bg-surface-hover', sameDay(d, new Date()) && 'bg-brand font-semibold text-brand-text')}>
              {d.getDate()}
            </button>
            <div className="space-y-0.5">
              {list.slice(0, 3).map((o) => <EventChip key={`${o.meetingId}:${o.occurrence}`} o={o} onOpen={onOpen} compact />)}
              {list.length > 3 && <button onClick={() => onDay(d)} className="text-xs text-muted hover:underline">+{list.length - 3} more</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Agenda({ items, now, onOpen }: { items: MeetingOccurrence[]; now: number; onOpen: (o: MeetingOccurrence) => void }) {
  const groups = new Map<string, MeetingOccurrence[]>();
  for (const o of items) {
    if (new Date(o.endAt).getTime() < now) continue;
    const key = startOfDay(new Date(o.startAt)).toISOString();
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  if (!groups.size) return <p className="p-8 text-center text-sm text-muted">No upcoming meetings in the next 30 days.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {[...groups.entries()].map(([day, list]) => (
        <section key={day} className="mb-4">
          <h2 className="mb-1.5 text-sm font-semibold">{new Date(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <ul className="space-y-1.5">
            {list.map((o) => (
              <li key={`${o.meetingId}:${o.occurrence}`} className="max-w-2xl">
                <EventChip o={o} onOpen={onOpen} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
