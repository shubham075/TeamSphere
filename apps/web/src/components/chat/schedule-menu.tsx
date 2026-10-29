'use client';

import { CalendarClock } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDismiss } from '@/lib/use-dismiss';

function at(daysAhead: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function nextMonday(hour: number) {
  const d = at(0, hour);
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}

/** Value for <input type="datetime-local"> in local time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export const formatWhen = (d: Date) =>
  d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Clock button next to Send: pick a time to deliver the message later. */
export function ScheduleMenu({ disabled, onSchedule }: { disabled: boolean; onSchedule: (when: Date) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(() => localInput(at(1, 9)));
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const presets = [
    { label: 'Tomorrow morning', when: at(1, 9) },
    { label: 'Tomorrow afternoon', when: at(1, 13) },
    { label: 'Next Monday', when: nextMonday(9) },
  ];
  const pick = (when: Date) => {
    onSchedule(when);
    setOpen(false);
  };
  const customDate = new Date(custom);
  const customValid = !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now() + 60_000;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Schedule send"
        aria-label="Schedule send"
        aria-expanded={open}
        className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <CalendarClock size={17} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 bottom-10 z-30 w-64 rounded-md border border-border bg-surface py-1 text-sm shadow-xl">
          <p className="px-3 py-1.5 text-xs font-semibold text-muted">Schedule send</p>
          {presets.map((p) => (
            <button key={p.label} role="menuitem" onClick={() => pick(p.when)} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-surface-hover">
              <span>{p.label}</span>
              <span className="text-xs text-muted">{formatWhen(p.when)}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-border px-3 pt-2 pb-2">
            <label className="block text-xs font-semibold text-muted" htmlFor="schedule-custom">
              Custom time
            </label>
            <input
              id="schedule-custom"
              type="datetime-local"
              value={custom}
              min={localInput(new Date())}
              onChange={(e) => setCustom(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
            />
            <button
              onClick={() => customValid && pick(customDate)}
              disabled={!customValid}
              className="mt-2 w-full rounded-md bg-brand px-3 py-1.5 font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50"
            >
              Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
