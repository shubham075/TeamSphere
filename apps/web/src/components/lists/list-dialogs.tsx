'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { LIST_COLUMN_TYPES, type ListColumn, type ListColumnType, type ListDetail, type ListItemInfo, type PublicUser } from '@teamsphere/shared';
import { errorText, Field, inputClass, Modal, PeoplePicker, primaryButton, secondaryButton } from '@/components/teams/ui';
import { useAuth } from '@/lib/auth-store';
import { LIST_TEMPLATES, listsApi, newId, useListsMutation, type Cell } from '@/lib/lists';
import { useTeams } from '@/lib/teams';
import { CellInput } from './cells';

export const COLUMN_LABEL: Record<ListColumnType, string> = {
  text: 'Single line of text', longtext: 'Multiple lines of text', number: 'Number', choice: 'Choice', date: 'Date', person: 'Person', boolean: 'Yes/No', link: 'Link',
};

/** Channels the user can add things to (not archived). */
export function useWritableChannels() {
  const { data: teams } = useTeams();
  return (teams ?? []).filter((t) => !t.archivedAt).flatMap((t) => t.channels.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: `${t.name} › ${c.name}` })));
}

export function NewListDialog({ onClose, onCreated, channelId }: { onClose: () => void; onCreated: (id: string) => void; channelId?: string }) {
  const channels = useWritableChannels();
  const meId = useAuth((s) => s.user?.id);
  const [template, setTemplate] = useState(LIST_TEMPLATES[0].id);
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState(channelId ?? '');
  const [members, setMembers] = useState<PublicUser[]>([]);
  const create = useListsMutation(() => {
    const t = LIST_TEMPLATES.find((x) => x.id === template)!;
    return listsApi.create({ title: title.trim(), channelId: where || null, memberIds: where ? [] : members.map((m) => m.id), columns: t.columns, addTab: !!where && !channelId });
  });
  return (
    <Modal
      title="New list"
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button disabled={!title.trim() || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (l) => onCreated(l.id) })} className={primaryButton}>Create</button>
        </>
      }
    >
      {create.error && <p className="mb-3 text-sm text-danger">{errorText(create.error)}</p>}
      <div role="radiogroup" aria-label="Template" className="mb-4 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        {LIST_TEMPLATES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={template === t.id}
            onClick={() => setTemplate(t.id)}
            className={clsx('rounded-md border p-3 text-left', template === t.id ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-hover')}
          >
            <span className="block text-sm font-semibold">{t.name}</span>
            <span className="block text-xs text-muted">{t.description}</span>
          </button>
        ))}
      </div>
      <Field label="Name">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
      </Field>
      {!channelId && (
        <Field label="Where" hint={where ? 'Everyone in the channel can edit the list.' : 'Only you and the people you add can open it.'}>
          <select value={where} onChange={(e) => setWhere(e.target.value)} className={inputClass}>
            <option value="">Personal list</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      )}
      {!where && (
        <Field label="Share with (optional)">
          <PeoplePicker picked={members} onChange={setMembers} exclude={meId ? [meId] : []} />
        </Field>
      )}
    </Modal>
  );
}

/** Add, rename, retype, reorder and remove columns. Saving replaces the column set. */
export function ColumnsDialog({ list, onClose }: { list: ListDetail; onClose: () => void }) {
  const [columns, setColumns] = useState<ListColumn[]>(list.columns);
  const save = useListsMutation(() => listsApi.update(list.id, { columns }));
  const set = (i: number, patch: Partial<ListColumn>) => setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) => setColumns((cs) => {
    const next = [...cs];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const removed = list.columns.filter((c) => !columns.some((x) => x.id === c.id));
  return (
    <Modal
      title="Edit columns"
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button
            disabled={save.isPending || columns.some((c) => !c.name.trim())}
            onClick={() => (!removed.length || confirm(`Remove ${removed.map((c) => `“${c.name}”`).join(', ')} and their values?`)) && save.mutate(undefined, { onSuccess: onClose })}
            className={primaryButton}
          >
            Save
          </button>
        </>
      }
    >
      {save.error && <p className="mb-3 text-sm text-danger">{errorText(save.error)}</p>}
      <ul className="space-y-3">
        {columns.map((c, i) => (
          <li key={c.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={c.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Column name" maxLength={100} className={clsx(inputClass, 'min-w-40 flex-1')} />
              <select value={c.type} onChange={(e) => set(i, { type: e.target.value as ListColumnType, options: e.target.value === 'choice' ? (c.options ?? ['Option 1']) : undefined })} aria-label="Column type" className={clsx(inputClass, 'w-52')}>
                {LIST_COLUMN_TYPES.map((t) => <option key={t} value={t}>{COLUMN_LABEL[t]}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!c.required} onChange={(e) => set(i, { required: e.target.checked })} className="accent-[var(--brand)]" /> Required
              </label>
              <button disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.name} up`} className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30"><ArrowUp size={15} /></button>
              <button disabled={i === columns.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.name} down`} className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30"><ArrowDown size={15} /></button>
              <button onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))} aria-label={`Remove ${c.name}`} className="rounded p-1 text-muted hover:text-danger"><Trash2 size={15} /></button>
            </div>
            {c.type === 'choice' && (
              <label className="mt-2 block text-xs">
                <span className="mb-1 block text-muted">Choices (one per line)</span>
                <textarea
                  value={(c.options ?? []).join('\n')}
                  onChange={(e) => set(i, { options: e.target.value.split('\n').map((s) => s.trimStart()).filter((s, k, a) => s || k === a.length - 1) })}
                  rows={Math.min(6, (c.options?.length ?? 1) + 1)}
                  className={inputClass}
                />
              </label>
            )}
          </li>
        ))}
      </ul>
      <button onClick={() => setColumns((cs) => [...cs, { id: newId(), name: 'New column', type: 'text' }])} className={clsx(secondaryButton, 'mt-3 flex items-center gap-1.5')}>
        <Plus size={15} /> Add column
      </button>
    </Modal>
  );
}

/** Form view of one item (new or existing): every column with its editor. */
export function ItemDialog({ list, item, onClose }: { list: ListDetail; item: ListItemInfo | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, Cell>>(item?.values ?? {});
  const save = useListsMutation(() => (item ? listsApi.updateItem(item.id, values) : listsApi.addItem(list.id, values)));
  const del = useListsMutation(() => listsApi.removeItem(item!.id));
  const editable = list.role !== 'view';
  return (
    <Modal
      title={item ? 'Edit item' : 'New item'}
      onClose={onClose}
      footer={
        editable && (
          <>
            {item && (
              <button onClick={() => confirm('Delete this item?') && del.mutate(undefined, { onSuccess: onClose })} className="mr-auto flex items-center gap-1.5 text-sm text-danger hover:underline">
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button onClick={onClose} className={secondaryButton}>Cancel</button>
            <button disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })} className={primaryButton}>Save</button>
          </>
        )
      }
    >
      {(save.error || del.error) && <p className="mb-3 text-sm text-danger">{errorText(save.error ?? del.error)}</p>}
      <fieldset disabled={!editable} className="space-y-3">
        {list.columns.map((c, i) => (
          <div key={c.id} className="text-sm">
            <label htmlFor={`item-${c.id}`} className="mb-1 block font-medium">{c.name}{c.required && <span className="text-danger"> *</span>}</label>
            <CellInput id={`item-${c.id}`} live column={c} value={values[c.id]} people={list.people} autoFocus={i === 0} onCommit={(v) => setValues((s) => ({ ...s, [c.id]: v }))} />
          </div>
        ))}
      </fieldset>
    </Modal>
  );
}
