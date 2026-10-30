'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Bell, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MeetingLobbyEvent, MeetingReminderEvent } from '@teamsphere/shared';
import { WS_EVENTS } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { fmtTime, mk } from '@/lib/meetings';
import { notifyDesktop } from '@/lib/notify';
import { getSocket } from '@/lib/socket';

interface Toast {
  id: string;
  title: string;
  body: string;
  path: string;
  action: string;
}

/**
 * Meeting events outside the meeting itself: refresh calendars on changes, and show reminders and
 * "waiting in the lobby" alerts as an in-app toast plus a desktop notification.
 */
export function MeetingsRealtime() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const meId = useAuth((s) => s.user?.id);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();
    const push = (t: Toast) => {
      setToasts((list) => [...list.filter((x) => x.id !== t.id), t].slice(-3));
      notifyDesktop(t.title, t.body, t.path);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 30_000);
    };
    const onChanged = () => void qc.invalidateQueries({ queryKey: mk.all });
    const onReminder = (e: MeetingReminderEvent) =>
      push({ id: `r:${e.meetingId}:${e.occurrence}`, title: e.title, body: `Starts at ${fmtTime(e.startAt)}`, path: `/meetings/${e.meetingId}?occurrence=${encodeURIComponent(e.occurrence)}`, action: 'Join' });
    const onLobby = (e: MeetingLobbyEvent) => {
      // Inside the meeting the stage shows its own lobby banner.
      if (e.kind !== 'waiting' || !e.user || location.pathname === `/meetings/${e.meetingId}`) return;
      push({ id: `l:${e.sessionId}:${e.user.id}`, title: 'Waiting in the lobby', body: `${e.user.displayName} wants to join your meeting`, path: `/meetings/${e.meetingId}`, action: 'Open meeting' });
    };
    socket.on(WS_EVENTS.meetingChanged, onChanged);
    socket.on(WS_EVENTS.meetingReminder, onReminder);
    socket.on(WS_EVENTS.meetingLobby, onLobby);
    return () => {
      socket.off(WS_EVENTS.meetingChanged, onChanged);
      socket.off(WS_EVENTS.meetingReminder, onReminder);
      socket.off(WS_EVENTS.meetingLobby, onLobby);
    };
  }, [meId, qc]);

  const shown = toasts.filter((t) => !pathname.startsWith(t.path.split('?')[0]));
  if (!shown.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-[70] flex w-80 flex-col gap-2" role="region" aria-label="Meeting notifications">
      {shown.map((t) => (
        <div key={t.id} role="alert" className="rounded-lg border border-border bg-surface p-3 text-sm shadow-xl">
          <div className="flex items-start gap-2">
            <Bell size={16} className="mt-0.5 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{t.title}</span>
              <span className="block text-muted">{t.body}</span>
            </span>
            <button onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="rounded p-0.5 hover:bg-surface-hover"><X size={14} /></button>
          </div>
          <button
            onClick={() => {
              setToasts((l) => l.filter((x) => x.id !== t.id));
              router.push(t.path);
            }}
            className="mt-2 w-full rounded-md bg-brand py-1.5 font-semibold text-brand-text hover:bg-brand-hover"
          >
            {t.action}
          </button>
        </div>
      ))}
    </div>
  );
}
