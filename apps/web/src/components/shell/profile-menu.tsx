'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, LogOut, MessageSquareText, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MANUAL_PRESENCE, ManualPresence, PRESENCE_LABELS } from '@teamsphere/shared';
import { Avatar, PresenceDot } from '@/components/avatar';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useMe, useSetPresence, useSetStatusMessage } from '@/lib/presence';

const DURATIONS = {
  never: 'Never',
  '30m': '30 minutes',
  '1h': '1 hour',
  '2h': '2 hours',
  today: 'Today',
  week: 'This week',
} as const;
type Duration = keyof typeof DURATIONS;

/** ISO time a timed status ends, or null for "never". */
function untilFor(d: Duration): string | null {
  const now = new Date();
  if (d === 'never') return null;
  if (d === '30m') return new Date(now.getTime() + 30 * 60_000).toISOString();
  if (d === '1h') return new Date(now.getTime() + 60 * 60_000).toISOString();
  if (d === '2h') return new Date(now.getTime() + 2 * 60 * 60_000).toISOString();
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  // "This week" ends on Sunday night.
  if (d === 'week') end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  return end.toISOString();
}

const formatUntil = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function DurationSelect({ value, onChange, label }: { value: Duration; onChange: (d: Duration) => void; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Duration)}
      aria-label={label}
      className="rounded border border-border bg-surface px-1 py-0.5 text-xs text-text"
    >
      {Object.entries(DURATIONS).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function ProfileMenu() {
  const { data: me } = useMe();
  const setPresence = useSetPresence();
  const setMessage = useSetStatusMessage();
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [statusFor, setStatusFor] = useState<Duration>('never');
  const [messageFor, setMessageFor] = useState<Duration>('today');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setDraft(me?.presence.statusMessage ?? '');
  }, [open, me?.presence.statusMessage]);

  if (!me) return <span className="h-8 w-8 rounded-full bg-white/20" />;

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clear();
    qc.clear();
    router.replace('/login');
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Your profile, ${PRESENCE_LABELS[me.presence.status]}`}
        className="flex rounded-full"
      >
        <Avatar name={me.displayName} src={me.avatarUrl} size={32} presence={me.presence.status} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-11 right-0 z-50 w-80 rounded-lg border border-border bg-surface text-text shadow-2xl"
        >
          <div className="flex items-center gap-3 border-b border-border p-4">
            <Avatar name={me.displayName} src={me.avatarUrl} size={52} presence={me.presence.status} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{me.displayName}</p>
              <p className="truncate text-sm text-muted">{me.jobTitle ?? me.username}</p>
              <p className="truncate text-xs text-muted">{me.email}</p>
            </div>
          </div>

          <div className="p-1.5">
            <button
              role="menuitem"
              onClick={() => setStatusOpen((s) => !s)}
              className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-surface-hover"
            >
              <PresenceDot status={me.presence.status} />
              <span className="flex-1">{PRESENCE_LABELS[me.presence.status]}</span>
              <ChevronRight size={16} className={statusOpen ? 'rotate-90' : ''} />
            </button>
            {statusOpen && (
              <div className="mb-1 ml-6 flex flex-col">
                {MANUAL_PRESENCE.map((s: ManualPresence) => (
                  <button
                    key={s}
                    role="menuitemradio"
                    aria-checked={me.presence.status === s}
                    onClick={() => setPresence.mutate({ status: s, until: s === 'available' ? null : untilFor(statusFor) })}
                    className="flex items-center gap-3 rounded px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                  >
                    <PresenceDot status={s} />
                    <span className="flex-1">{PRESENCE_LABELS[s]}</span>
                    {me.presence.status === s && <Check size={14} />}
                  </button>
                ))}
                <label className="flex items-center gap-2 px-3 pt-1 text-xs text-muted">
                  Reset after
                  <DurationSelect value={statusFor} onChange={setStatusFor} label="Reset status after" />
                </label>
                <p className="px-3 pt-1 text-xs text-muted">"Available" means automatic.</p>
              </div>
            )}
            {me.presence.presenceExpiresAt && (
              <p className="px-3 pb-1 pl-10 text-xs text-muted">Until {formatUntil(me.presence.presenceExpiresAt)}</p>
            )}
            {me.presence.outOfOffice && (
              <Link href="/settings" onClick={() => setOpen(false)} className="block px-3 pb-1 pl-10 text-xs text-fuchsia-600 hover:underline">
                Out of office{me.presence.outOfOffice.until ? ` until ${formatUntil(me.presence.outOfOffice.until)}` : ''} · change
              </Link>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const message = draft.trim() || null;
                setMessage.mutate({ message, expiresAt: message ? untilFor(messageFor) : null });
              }}
              className="rounded px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <MessageSquareText size={16} className="shrink-0 text-muted" />
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={280}
                  placeholder="Set status message"
                  aria-label="Status message"
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-border"
                />
              </div>
              <div className="mt-1 flex items-center gap-2 pl-6 text-xs text-muted">
                <span>Clear after</span>
                <DurationSelect value={messageFor} onChange={setMessageFor} label="Clear status message after" />
                <button className="ml-auto font-semibold text-brand hover:underline">Done</button>
              </div>
              {me.presence.statusMessage && me.presence.statusExpiresAt && (
                <p className="pl-6 text-xs text-muted">Clears {formatUntil(me.presence.statusExpiresAt)}</p>
              )}
            </form>

            <div className="my-1 h-px bg-border" />
            <Link
              role="menuitem"
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-surface-hover"
            >
              <Settings size={16} /> Settings
            </Link>
            <button
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-surface-hover"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
