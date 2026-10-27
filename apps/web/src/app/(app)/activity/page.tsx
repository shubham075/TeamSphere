'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AtSign, CheckCheck, CornerUpLeft, SmilePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ActivityItem } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { formatListTime, qk, useActivity } from '@/lib/chat';

const TYPE_INFO: Record<ActivityItem['type'], { icon: typeof AtSign; verb: string }> = {
  mention: { icon: AtSign, verb: 'mentioned you' },
  reply: { icon: CornerUpLeft, verb: 'replied to you' },
  reaction: { icon: SmilePlus, verb: 'reacted to your message' },
};

export default function ActivityPage() {
  const { data, isLoading } = useActivity();
  const qc = useQueryClient();
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api('/activity/read', { method: 'POST', json: { ids } }),
    onMutate: (ids) =>
      qc.setQueryData<ActivityItem[]>(qk.activity, (list) => list?.map((a) => (!ids || ids.includes(a.id) ? { ...a, read: true } : a))),
  });

  const items = (data ?? []).filter((a) => !unreadOnly || !a.read);

  return (
    <>
      <aside className="flex w-96 shrink-0 flex-col border-r border-border bg-surface max-md:w-full">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <h1 className="flex-1 text-xl font-semibold">Activity</h1>
          <button
            onClick={() => setUnreadOnly((u) => !u)}
            aria-pressed={unreadOnly}
            className={clsx('rounded px-2 py-1 text-xs', unreadOnly ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-hover')}
          >
            Unread
          </button>
          <button onClick={() => markRead.mutate(undefined)} title="Mark all as read" aria-label="Mark all as read" className="rounded p-2 text-muted hover:bg-surface-hover">
            <CheckCheck size={18} />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-3">
          {items.map((a) => {
            const { icon: Icon, verb } = TYPE_INFO[a.type] ?? TYPE_INFO.mention;
            return (
              <li key={a.id}>
                <button
                  onClick={() => {
                    if (!a.read) markRead.mutate([a.id]);
                    if (a.conversationId) router.push(`/chat/${a.conversationId}`);
                  }}
                  className={clsx('flex w-full gap-3 rounded-md px-2 py-2.5 text-left hover:bg-surface-hover', !a.read && 'bg-brand-soft/50')}
                >
                  <span className="relative">
                    <Avatar name={a.actor?.displayName ?? '?'} src={a.actor?.avatarUrl} size={36} />
                    <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-text ring-2 ring-surface">
                      <Icon size={11} />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={clsx('flex-1 truncate text-sm', !a.read && 'font-semibold')}>
                        {a.actor?.displayName ?? 'Someone'} {verb}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">{formatListTime(a.createdAt)}</span>
                    </span>
                    {a.conversationTitle && <span className="block truncate text-xs text-muted">in {a.conversationTitle}</span>}
                    {a.preview && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{a.preview}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {!isLoading && !items.length && <li className="px-4 py-10 text-center text-sm text-muted">You're all caught up.</li>}
        </ul>
      </aside>
      <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted max-md:hidden">
        Mentions, replies and reactions show up here. Select one to open the chat.
      </section>
    </>
  );
}
