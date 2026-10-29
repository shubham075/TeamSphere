'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Hash, Lock, Share2, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import type { ChannelType, PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api, ApiError } from '@/lib/api';
import { teamColor, teamInitials } from '@/lib/teams';

export function TeamAvatar({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, background: teamColor(id), fontSize: size * 0.4 }}
    >
      {teamInitials(name)}
    </span>
  );
}

export function ChannelIcon({ type, size = 14, className }: { type: ChannelType; size?: number; className?: string }) {
  const Icon = type === 'private' ? Lock : type === 'shared' ? Share2 : Hash;
  return <Icon size={size} className={clsx('shrink-0', className)} aria-label={type === 'standard' ? undefined : `${type} channel`} />;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('flex max-h-[84vh] w-full flex-col rounded-xl border border-border bg-surface shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand';
export const primaryButton = 'rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50';
export const secondaryButton = 'rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover disabled:opacity-50';

export function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Search the directory and pick people. `exclude` hides people who are already in. */
export function PeoplePicker({ picked, onChange, exclude = [] }: { picked: PublicUser[]; onChange: (p: PublicUser[]) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const { data: people } = useQuery({
    queryKey: ['people', q],
    queryFn: () => api<PublicUser[]>(`/users?take=20&q=${encodeURIComponent(q)}`),
  });
  const hidden = new Set(exclude);
  return (
    <div>
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((u) => (
            <span key={u.id} className="flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pr-1 pl-2 text-xs font-medium text-brand">
              {u.displayName}
              <button onClick={() => onChange(picked.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.displayName}`} className="rounded-full p-0.5 hover:bg-surface">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className={inputClass} />
      <ul className="mt-2 max-h-56 overflow-y-auto">
        {people
          ?.filter((u) => !hidden.has(u.id))
          .map((u) => {
            const selected = picked.some((x) => x.id === u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(selected ? picked.filter((x) => x.id !== u.id) : [...picked, u])}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                >
                  <Avatar name={u.displayName} src={u.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm">{u.displayName}</span>
                  {selected && <Check size={16} className="text-brand" />}
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
