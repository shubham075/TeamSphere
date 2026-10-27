'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useCreateConversation } from '@/lib/chat';

/** "New chat": pick one person for a 1:1 chat or several for a group chat. */
export function NewChatDialog({ onClose, initial = [] }: { onClose: () => void; initial?: PublicUser[] }) {
  const router = useRouter();
  const meId = useAuth((s) => s.user?.id);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PublicUser[]>(initial);
  const [title, setTitle] = useState('');
  const create = useCreateConversation();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: people } = useQuery({
    queryKey: ['people', q],
    queryFn: () => api<PublicUser[]>(`/users?take=20&q=${encodeURIComponent(q)}`),
  });

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (u: PublicUser) =>
    setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));

  async function start() {
    const input =
      picked.length === 1
        ? ({ type: 'direct', userId: picked[0].id } as const)
        : ({ type: 'group', userIds: picked.map((u) => u.id), title: title.trim() || undefined } as const);
    const c = await create.mutateAsync(input);
    onClose();
    router.push(`/chat/${c.id}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New chat"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[75vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">New chat</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 pt-4">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border px-2 py-1.5 focus-within:border-brand">
            <span className="text-sm text-muted">To:</span>
            {picked.map((u) => (
              <span key={u.id} className="flex items-center gap-1 rounded bg-brand-soft px-2 py-0.5 text-sm text-brand">
                {u.displayName}
                <button onClick={() => toggle(u)} aria-label={`Remove ${u.displayName}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={picked.length ? '' : 'Enter name or email'}
              className="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"
            />
          </div>
          {picked.length > 1 && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Group name (optional)"
              maxLength={128}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
          )}
        </div>

        <ul className="mt-2 flex-1 overflow-y-auto px-3 py-1">
          {people
            ?.filter((u) => u.id !== meId)
            .map((u) => {
              const selected = picked.some((x) => x.id === u.id);
              return (
                <li key={u.id}>
                  <button
                    onClick={() => toggle(u)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover"
                  >
                    <Avatar name={u.displayName} src={u.avatarUrl} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{u.displayName}</span>
                      <span className="block truncate text-xs text-muted">{[u.jobTitle, u.department].filter(Boolean).join(' · ') || u.username}</span>
                    </span>
                    {selected && <Check size={16} className="text-brand" />}
                  </button>
                </li>
              );
            })}
          {people && people.filter((u) => u.id !== meId).length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted">No one found.</li>
          )}
        </ul>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {create.error && <p className="mr-auto text-sm text-danger">{create.error instanceof ApiError ? create.error.message : 'Could not start the chat'}</p>}
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover">
            Cancel
          </button>
          <button
            onClick={start}
            disabled={!picked.length || create.isPending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50"
          >
            {picked.length > 1 ? 'Start group chat' : 'Start chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
