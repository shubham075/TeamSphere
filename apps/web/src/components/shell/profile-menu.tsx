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
                    onClick={() => setPresence.mutate({ status: s })}
                    className="flex items-center gap-3 rounded px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                  >
                    <PresenceDot status={s} />
                    <span className="flex-1">{PRESENCE_LABELS[s]}</span>
                    {me.presence.status === s && <Check size={14} />}
                  </button>
                ))}
                <p className="px-3 pt-1 text-xs text-muted">"Available" means automatic.</p>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setMessage.mutate({ message: draft.trim() || null });
              }}
              className="flex items-center gap-2 rounded px-3 py-2"
            >
              <MessageSquareText size={16} className="shrink-0 text-muted" />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={280}
                placeholder="Set status message"
                aria-label="Status message"
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-border"
              />
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
