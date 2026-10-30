'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Loader2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CreateMeetingInput, FreeBusyInfo, MeetingInfo, PublicUser, Recurrence, UpdateMeetingInput } from '@teamsphere/shared';
import { Field, inputClass, Modal, PeoplePicker, primaryButton, secondaryButton, errorText } from '@/components/teams/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import {
  addDays, browserTimeZone, fetchFreeBusy, fmtTime, mk, startOfDay, toLocalInput,
} from '@/lib/meetings';
import { useTeams } from '@/lib/teams';

type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';

function repeatOf(r: Recurrence | null): Repeat {
  if (!r) return 'none';
  if (r.freq === 'daily') return 'daily';
  if (r.freq === 'monthly') return 'monthly';
  if (r.byWeekday?.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byWeekday!.includes(d))) return 'weekdays';
  return r.interval === 2 ? 'biweekly' : 'weekly';
}

function toRecurrence(repeat: Repeat, start: Date, until: string): Recurrence | null {
  const end = until ? { until: new Date(`${until}T23:59:59`).toISOString() } : {};
  switch (repeat) {
    case 'none': return null;
    case 'daily': return { freq: 'daily', interval: 1, ...end };
    case 'weekdays': return { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5], ...end };
    case 'weekly': return { freq: 'weekly', interval: 1, byWeekday: [start.getDay()], ...end };
    case 'biweekly': return { freq: 'weekly', interval: 2, byWeekday: [start.getDay()], ...end };
    case 'monthly': return { freq: 'monthly', interval: 1, ...end };
  }
}

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

/**
 * New / edit meeting. `occurrence` set = edit just that occurrence (only its time). Times are entered in local
 * time; recurring series repeat in the chosen time zone.
 */
export function MeetingForm({ meeting, occurrence, initialStart, onClose, onSaved }: {
  meeting?: MeetingInfo;
  occurrence?: { occurrence: string; startAt: string; endAt: string };
  initialStart?: Date;
  onClose: () => void;
  onSaved: (m: MeetingInfo) => void;
}) {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  const { data: teams } = useTeams();
  const defaultStart = useMemo(() => {
    if (initialStart) return initialStart;
    const d = new Date(Date.now() + 30 * 60_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return d;
  }, [initialStart]);

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [people, setPeople] = useState<PublicUser[]>(
    meeting?.attendees.filter((a) => a.role !== 'organizer').map((a) => ({ ...a.user, username: '', presence: undefined }) as unknown as PublicUser) ?? [],
  );
  const [optional, setOptional] = useState<Set<string>>(new Set(meeting?.attendees.filter((a) => !a.required).map((a) => a.user.id)));
  const [start, setStart] = useState(toLocalInput(new Date(occurrence?.startAt ?? meeting?.startAt ?? defaultStart)));
  const [end, setEnd] = useState(toLocalInput(new Date(occurrence?.endAt ?? meeting?.endAt ?? new Date(defaultStart.getTime() + 30 * 60_000))));
  const [timeZone, setTimeZone] = useState(meeting?.timeZone ?? browserTimeZone());
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(meeting?.recurrence ?? null));
  const [until, setUntil] = useState(meeting?.recurrence?.until?.slice(0, 10) ?? '');
  const [channelId, setChannelId] = useState(meeting?.channelId ?? '');
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [assistant, setAssistant] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationMin = Math.max(5, Math.round((endDate.getTime() - startDate.getTime()) / 60_000) || 30);
  const occurrenceOnly = !!occurrence;

  function moveTo(s: Date) {
    setStart(toLocalInput(s));
    setEnd(toLocalInput(new Date(s.getTime() + durationMin * 60_000)));
  }

  async function save() {
    setError(null);
    if (!title.trim() && !occurrenceOnly) return setError('Add a title');
    if (!(endDate > startDate)) return setError('End must be after start');
    setSaving(true);
    try {
      const attendees = people.map((p) => ({ userId: p.id, required: !optional.has(p.id) }));
      let saved: MeetingInfo;
      if (occurrenceOnly && meeting) {
        const body: UpdateMeetingInput = { occurrence: occurrence.occurrence, startAt: startDate.toISOString(), endAt: endDate.toISOString() };
        saved = await api<MeetingInfo>(`/meetings/${meeting.id}`, { method: 'PATCH', json: body });
      } else if (meeting) {
        const body: UpdateMeetingInput = {
          title, description, location, startAt: startDate.toISOString(), endAt: endDate.toISOString(), timeZone,
          recurrence: toRecurrence(repeat, startDate, until), attendees,
        };
        saved = await api<MeetingInfo>(`/meetings/${meeting.id}`, { method: 'PATCH', json: body });
      } else {
        const body: CreateMeetingInput = {
          title, description, location, startAt: startDate.toISOString(), endAt: endDate.toISOString(), timeZone,
          recurrence: toRecurrence(repeat, startDate, until), attendees, channelId: channelId || null,
        };
        saved = await api<MeetingInfo>('/meetings', { method: 'POST', json: body });
      }
      await qc.invalidateQueries({ queryKey: mk.all });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const channels = (teams ?? []).flatMap((t) => t.channels.filter((c) => c.permissions.post).map((c) => ({ id: c.id, label: `${t.name} › ${c.name}` })));

  return (
    <Modal
      title={occurrenceOnly ? 'Edit this occurrence' : meeting ? 'Edit meeting' : 'New meeting'}
      onClose={onClose}
      wide
      footer={
        <>
          {error && <span role="alert" className="mr-auto text-sm text-danger">{error}</span>}
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button onClick={() => void save()} disabled={saving} className={primaryButton}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : meeting ? 'Save' : 'Send'}
          </button>
        </>
      }
    >
      {!occurrenceOnly && (
        <>
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} autoFocus maxLength={200} />
          </Field>
          <Field label="Attendees" hint="Select a person below to mark them optional.">
            <PeoplePicker picked={people} onChange={setPeople} exclude={meId ? [meId] : []} />
          </Field>
          {people.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Required and optional attendees">
              {people.map((p) => {
                const opt = optional.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={opt}
                      onClick={() => setOptional((s) => { const n = new Set(s); if (opt) n.delete(p.id); else n.add(p.id); return n; })}
                      className={clsx('rounded-full border px-2.5 py-0.5 text-xs', opt ? 'border-dashed border-border text-muted' : 'border-brand text-brand')}
                    >
                      {p.displayName} · {opt ? 'Optional' : 'Required'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <input type="datetime-local" value={start} onChange={(e) => {
            const s = new Date(e.target.value);
            if (!Number.isNaN(s.getTime())) moveTo(s);
          }} className={inputClass} />
        </Field>
        <Field label="End">
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>
      {!occurrenceOnly && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeat">
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className={inputClass}>
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Every weekday (Mon–Fri)</option>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
            {repeat !== 'none' ? (
              <Field label="Until (optional)">
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={inputClass} />
              </Field>
            ) : <span />}
          </div>
          <Field label="Time zone" hint="Times above are in your local time; a series repeats at the same local time in this zone.">
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={inputClass}>
              {(ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES]).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          {!meeting && (
            <Field label="Channel (optional)" hint="Channel meetings are posted in the channel; its members can join.">
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={inputClass}>
                <option value="">None</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Location (optional)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} maxLength={200} />
          </Field>
          <Field label="Details">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
          </Field>
        </>
      )}
      <button type="button" onClick={() => setAssistant((v) => !v)} aria-expanded={assistant} className="mb-2 text-sm font-medium text-brand hover:underline">
        {assistant ? 'Hide' : 'Show'} scheduling assistant
      </button>
      {assistant && (
        <SchedulingAssistant
          userIds={meeting && occurrenceOnly ? meeting.attendees.map((a) => a.user.id) : people.map((p) => p.id)}
          day={startDate}
          start={startDate}
          durationMin={durationMin}
          excludeMeetingId={meeting?.id}
          onPick={moveTo}
        />
      )}
    </Modal>
  );
}

const HOUR_PX = 36;
const FIRST_HOUR = 7;
const LAST_HOUR = 20;

/** Free/busy grid for one day (attendees × hours) with working hours shaded and suggested times. */
function SchedulingAssistant({ userIds, day, start, durationMin, excludeMeetingId, onPick }: {
  userIds: string[];
  day: Date;
  start: Date;
  durationMin: number;
  excludeMeetingId?: string;
  onPick: (start: Date) => void;
}) {
  const from = startOfDay(Number.isNaN(day.getTime()) ? new Date() : day);
  const to = addDays(from, 1);
  const { data, isLoading } = useQuery({
    queryKey: ['meetings', 'free-busy', userIds.join(','), from.toISOString(), durationMin, excludeMeetingId],
    queryFn: () => fetchFreeBusy({ userIds, from, to: addDays(from, 7), durationMin, excludeMeetingId }),
  });
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const x = (d: Date) => ((d.getTime() - from.getTime()) / 3_600_000 - FIRST_HOUR) * HOUR_PX;
  const width = hours.length * HOUR_PX;

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs text-muted">{from.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · hatched = outside working hours</p>
      {isLoading || !data ? (
        <Loader2 className="animate-spin" size={16} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="flex">
              <div className="w-32 shrink-0" />
              <div className="relative flex" style={{ width }}>
                {hours.map((h) => (
                  <span key={h} className="shrink-0 text-[10px] text-muted" style={{ width: HOUR_PX }}>{h}:00</span>
                ))}
              </div>
            </div>
            {data.users.map((u) => (
              <div key={u.user.id} className="flex items-center border-t border-border/50">
                <span className="w-32 shrink-0 truncate py-1 pr-2 text-xs">{u.user.displayName}</span>
                <div className="relative h-6" style={{ width }} role="img" aria-label={`${u.user.displayName}: ${busyText(u.busy, from, to)}`}>
                  <OffHours wh={u.workingHours} from={from} x={x} width={width} />
                  {u.busy.map((b, i) => {
                    const s = new Date(b.startAt);
                    const e = new Date(b.endAt);
                    if (e <= from || s >= to) return null;
                    const left = Math.max(0, x(s));
                    const right = Math.min(width, x(e));
                    if (right <= left) return null;
                    return <span key={i} className={clsx('absolute top-1 bottom-1 rounded-sm', b.tentative ? 'bg-brand/40' : 'bg-brand')} style={{ left, width: right - left }} />;
                  })}
                </div>
              </div>
            ))}
            <div className="flex">
              <div className="w-32 shrink-0" />
              <div className="relative h-2" style={{ width }}>
                <span className="absolute top-0 h-2 rounded-sm bg-success" style={{ left: Math.max(0, x(start)), width: (durationMin / 60) * HOUR_PX }} aria-hidden />
              </div>
            </div>
          </div>
          <Suggestions data={data} onPick={onPick} />
        </>
      )}
    </div>
  );
}

function busyText(busy: FreeBusyInfo['users'][number]['busy'], from: Date, to: Date) {
  const today = busy.filter((b) => new Date(b.endAt) > from && new Date(b.startAt) < to);
  return today.length ? `busy ${today.map((b) => `${fmtTime(b.startAt)}–${fmtTime(b.endAt)}`).join(', ')}` : 'free';
}

function OffHours({ wh, from, x, width }: { wh: FreeBusyInfo['users'][number]['workingHours']; from: Date; x: (d: Date) => number; width: number }) {
  // Working hours are in the person's own zone; place them on this local day.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: wh.timeZone, weekday: 'short' }).format(new Date(from.getTime() + 12 * 3_600_000));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts);
  const offsetMin = zoneOffsetMin(wh.timeZone, from) - -from.getTimezoneOffset();
  const s = new Date(from.getTime() + (wh.startMinute - offsetMin) * 60_000);
  const e = new Date(from.getTime() + (wh.endMinute - offsetMin) * 60_000);
  const hatch = { backgroundImage: 'repeating-linear-gradient(45deg, var(--surface-2) 0 4px, transparent 4px 8px)' };
  if (!wh.days.includes(weekday)) return <span className="absolute inset-0" style={hatch} />;
  return (
    <>
      <span className="absolute top-0 bottom-0" style={{ ...hatch, left: 0, width: Math.max(0, Math.min(width, x(s))) }} />
      <span className="absolute top-0 bottom-0" style={{ ...hatch, left: Math.max(0, x(e)), right: 0 }} />
    </>
  );
}

/** Minutes east of UTC for `tz` at `at`. */
function zoneOffsetMin(tz: string, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

function Suggestions({ data, onPick }: { data: FreeBusyInfo; onPick: (d: Date) => void }) {
  if (!data.suggestions.length) return <p className="mt-2 text-xs text-muted">No common free time in the next week.</p>;
  return (
    <div className="mt-3">
      <p className="mb-1 flex items-center gap-1 text-xs font-medium"><Sparkles size={12} /> Suggested times</p>
      <div className="flex flex-wrap gap-1.5">
        {data.suggestions.map((s) => (
          <button key={s.startAt} type="button" onClick={() => onPick(new Date(s.startAt))} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-hover">
            {new Date(s.startAt).toLocaleDateString([], { weekday: 'short', day: 'numeric' })} {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
          </button>
        ))}
      </div>
    </div>
  );
}
