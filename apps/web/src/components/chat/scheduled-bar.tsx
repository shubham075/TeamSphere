'use client';

import { CalendarClock, ChevronDown, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toPlainText } from '@teamsphere/shared';
import { useScheduled, useScheduledActions } from '@/lib/chat';
import { formatWhen } from './schedule-menu';

/** "2 scheduled messages" strip above the composer, expandable to send now or cancel. */
export function ScheduledBar({ conversationId }: { conversationId: string }) {
  const { data } = useScheduled(conversationId);
  const { cancel, sendNow } = useScheduledActions(conversationId);
  const [open, setOpen] = useState(false);
  if (!data?.length) return null;

  return (
    <div className="mx-4 mb-1 rounded-md border border-border bg-surface text-xs md:mx-6">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover">
        <CalendarClock size={14} className="text-brand" aria-hidden />
        <span className="flex-1 font-semibold">
          {data.length} scheduled {data.length === 1 ? 'message' : 'messages'} · next {formatWhen(new Date(data[0].sendAt))}
        </span>
        <ChevronDown size={14} className={open ? 'rotate-180' : ''} aria-hidden />
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-border">
          {data.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block text-muted">{formatWhen(new Date(s.sendAt))}</span>
                <span className="block truncate">
                  {toPlainText(s.body) || `${s.attachmentCount} attachment${s.attachmentCount === 1 ? '' : 's'}`}
                </span>
              </span>
              <button onClick={() => sendNow.mutate(s.id)} title="Send now" aria-label="Send now" className="rounded p-1 hover:bg-surface-hover">
                <Send size={14} />
              </button>
              <button
                onClick={() => confirm('Cancel this scheduled message?') && cancel.mutate(s.id)}
                title="Cancel"
                aria-label="Cancel scheduled message"
                className="rounded p-1 hover:bg-surface-hover hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
