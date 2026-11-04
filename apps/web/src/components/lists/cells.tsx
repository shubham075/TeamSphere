'use client';

import clsx from 'clsx';
import type { CollabPerson, ListColumn } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { cellText, type Cell } from '@/lib/lists';

const base = 'w-full rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand';

/**
 * Editor for one cell, by column type. `onCommit` fires on change for pickers; text fields commit on blur/Enter
 * (one save per edit in the grid) or, with `live`, on every change (forms that save with a button).
 */
export function CellInput({ column, value, people, onCommit, autoFocus, id, live }: {
  column: ListColumn;
  value: Cell;
  people: CollabPerson[];
  onCommit: (v: Cell) => void;
  autoFocus?: boolean;
  id?: string;
  live?: boolean;
}) {
  const toValue = (raw: string): Cell => (raw === '' ? null : column.type === 'number' ? Number(raw) : raw);
  const label = column.name;
  switch (column.type) {
    case 'choice':
      return (
        <select id={id} autoFocus={autoFocus} aria-label={label} value={String(value ?? '')} onChange={(e) => onCommit(e.target.value || null)} className={base}>
          <option value="">—</option>
          {column.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'person':
      return (
        <select id={id} autoFocus={autoFocus} aria-label={label} value={String(value ?? '')} onChange={(e) => onCommit(e.target.value || null)} className={base}>
          <option value="">—</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      );
    case 'boolean':
      return <input id={id} autoFocus={autoFocus} type="checkbox" aria-label={label} checked={!!value} onChange={(e) => onCommit(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />;
    case 'date':
      return <input id={id} autoFocus={autoFocus} type="date" aria-label={label} value={String(value ?? '')} onChange={(e) => onCommit(e.target.value || null)} className={base} />;
    case 'longtext':
      return (
        <textarea
          id={id}
          autoFocus={autoFocus}
          aria-label={label}
          defaultValue={String(value ?? '')}
          rows={3}
          onChange={(e) => live && onCommit(e.target.value || null)}
          onBlur={(e) => !live && e.target.value !== String(value ?? '') && onCommit(e.target.value || null)}
          className={base}
        />
      );
    default:
      return (
        <input
          id={id}
          autoFocus={autoFocus}
          aria-label={label}
          type={column.type === 'number' ? 'number' : column.type === 'link' ? 'url' : 'text'}
          defaultValue={String(value ?? '')}
          placeholder={column.type === 'link' ? 'https://' : ''}
          onChange={(e) => live && onCommit(toValue(e.target.value))}
          onBlur={(e) => !live && e.target.value !== String(value ?? '') && onCommit(toValue(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={base}
        />
      );
  }
}

/** Read-only rendering of a cell in grids and cards. */
export function CellDisplay({ column, value, people }: { column: ListColumn; value: Cell; people: Map<string, CollabPerson> }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  if (column.type === 'person') {
    const p = people.get(String(value));
    return p ? <span className="flex items-center gap-1.5"><Avatar name={p.displayName} src={p.avatarUrl} size={20} /> <span className="truncate">{p.displayName}</span></span> : <span className="text-muted">Unknown</span>;
  }
  if (column.type === 'choice') return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">{String(value)}</span>;
  if (column.type === 'link') return <a href={String(value)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="truncate text-brand underline">{String(value)}</a>;
  if (column.type === 'boolean') return <span className={clsx(value ? 'text-success' : 'text-muted')}>{value ? 'Yes' : 'No'}</span>;
  return <span className={clsx('truncate', column.type === 'number' && 'tabular-nums')}>{cellText(column, value, people)}</span>;
}
