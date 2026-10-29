'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import type { PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';

/** Search-and-pick dialog for calls: add people, transfer, speed dial, forwarding targets. */
export function PeoplePicker({
  title,
  action,
  multiple = false,
  exclude = [],
  onPick,
  onClose,
}: {
  title: string;
  action: string;
  multiple?: boolean;
  exclude?: string[];
  onPick: (users: PublicUser[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const { data: people } = useQuery({
    queryKey: ['people', q],
    queryFn: () => api<PublicUser[]>(`/users?take=20&q=${encodeURIComponent(q)}`),
  });
  const skip = new Set(exclude);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="flex max-h-[75vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface text-text shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pt-4">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <ul className="mt-2 flex-1 overflow-y-auto px-3 pb-2">
          {people
            ?.filter((u) => !skip.has(u.id))
            .map((u) => {
              const selected = picked.some((x) => x.id === u.id);
              return (
                <li key={u.id}>
                  <button
                    onClick={() => {
                      if (!multiple) return onPick([u]);
                      setPicked((p) => (selected ? p.filter((x) => x.id !== u.id) : [...p, u]));
                    }}
                    aria-pressed={multiple ? selected : undefined}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover"
                  >
                    <Avatar name={u.displayName} src={u.avatarUrl} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{u.displayName}</span>
                      {u.jobTitle && <span className="block truncate text-xs text-muted">{u.jobTitle}</span>}
                    </span>
                    {selected && <Check size={16} className="text-brand" />}
                  </button>
                </li>
              );
            })}
        </ul>
        {multiple && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover">
              Cancel
            </button>
            <button
              onClick={() => onPick(picked)}
              disabled={!picked.length}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50"
            >
              {action} {picked.length || ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
