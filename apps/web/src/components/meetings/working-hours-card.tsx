'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { WorkingHours } from '@teamsphere/shared';
import { api, ApiError } from '@/lib/api';
import { browserTimeZone, mk, useWorkingHours } from '@/lib/meetings';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromTime = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Settings → Calendar: working hours used by the scheduling assistant (free/busy and suggested times). */
export function WorkingHoursCard() {
  const qc = useQueryClient();
  const { data } = useWorkingHours();
  const [wh, setWh] = useState<WorkingHours | null>(null);
  useEffect(() => { if (data) setWh(data); }, [data]);
  const save = useMutation({
    mutationFn: (body: WorkingHours) => api<WorkingHours>('/meetings/working-hours', { method: 'PUT', json: body }),
    onSuccess: (saved) => qc.setQueryData(mk.workingHours, saved),
  });
  if (!wh) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-1 text-base font-semibold">Working hours</h2>
      <p className="mb-4 text-sm text-muted">Others see these when scheduling with you; suggested times stay inside them.</p>
      <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium">Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const on = wh.days.includes(i);
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => setWh({ ...wh, days: on ? wh.days.filter((x) => x !== i) : [...wh.days, i].sort() })}
                className={clsx('rounded-full border px-3 py-1 text-sm', on ? 'border-brand bg-brand-soft text-brand' : 'border-border')}>
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1"><span className="font-medium">Start</span>
          <input type="time" value={toTime(wh.startMinute)} onChange={(e) => setWh({ ...wh, startMinute: fromTime(e.target.value) })} className="rounded-md border border-border bg-surface px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1"><span className="font-medium">End</span>
          <input type="time" value={toTime(wh.endMinute)} onChange={(e) => setWh({ ...wh, endMinute: fromTime(e.target.value) })} className="rounded-md border border-border bg-surface px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1"><span className="font-medium">Time zone</span>
          <input value={wh.timeZone} onChange={(e) => setWh({ ...wh, timeZone: e.target.value })} list="tz-list" className="rounded-md border border-border bg-surface px-3 py-2" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate(wh)} disabled={save.isPending} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50">Save</button>
        <button type="button" onClick={() => setWh({ ...wh, timeZone: browserTimeZone() })} className="text-sm text-brand hover:underline">Use my current time zone</button>
        {save.isSuccess && <span role="status" className="text-sm text-success">Saved</span>}
        {save.error && <span role="alert" className="text-sm text-danger">{save.error instanceof ApiError ? save.error.message : 'Could not save'}</span>}
      </div>
    </section>
  );
}
