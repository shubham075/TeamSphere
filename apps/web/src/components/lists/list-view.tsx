'use client';

import clsx from 'clsx';
import { Columns3, Download, Kanban, Loader2, Plus, Save, Search, Settings2, Share2, Table, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ListDetail, ListItemInfo, ListView as SavedView } from '@teamsphere/shared';
import { ShareDialog } from '@/components/pages/share-dialog';
import { errorText } from '@/components/teams/ui';
import { applyView, downloadCsv, lanes, listsApi, newId, useList, useListsMutation, type Cell } from '@/lib/lists';
import { CellDisplay, CellInput } from './cells';
import { ColumnsDialog, ItemDialog } from './list-dialogs';

type ViewState = Omit<SavedView, 'id' | 'name'>;
const DEFAULT_VIEW: ViewState = { layout: 'grid', sort: null, filters: [], groupBy: null };
const select = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand';

/** A list with its toolbar, saved views and grid/board layouts. `compact` drops the title row (channel tabs). */
export function ListView({ listId, compact, onDeleted }: { listId: string; compact?: boolean; onDeleted?: () => void }) {
  const { data, isLoading, error } = useList(listId);
  if (isLoading) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (!data) return <p className="p-6 text-sm text-muted">{errorText(error) ?? 'This list is not available.'}</p>;
  return <Loaded key={listId} list={data.list} items={data.items} compact={compact} onDeleted={onDeleted} />;
}

function Loaded({ list, items, compact, onDeleted }: { list: ListDetail; items: ListItemInfo[]; compact?: boolean; onDeleted?: () => void }) {
  const [viewId, setViewId] = useState<string>('all');
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState(list.title);
  const [editing, setEditing] = useState<ListItemInfo | 'new' | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [share, setShare] = useState(false);
  const mutate = useListsMutation((fn: () => Promise<unknown>) => fn());
  useEffect(() => setTitle(list.title), [list.title]);

  const people = useMemo(() => new Map(list.people.map((p) => [p.id, p])), [list.people]);
  const shown = useMemo(() => applyView(items, list.columns, view, search, people), [items, list.columns, view, search, people]);
  const choiceColumns = list.columns.filter((c) => c.type === 'choice');
  const groupColumn = list.columns.find((c) => c.id === view.groupBy) ?? choiceColumns[0];
  const editable = list.role !== 'view';
  const dirty = viewId === 'all' ? JSON.stringify(view) !== JSON.stringify(DEFAULT_VIEW) : JSON.stringify(view) !== JSON.stringify(strip(list.views.find((v) => v.id === viewId)));

  const pickView = (id: string) => {
    setViewId(id);
    setView(id === 'all' ? DEFAULT_VIEW : strip(list.views.find((v) => v.id === id)) ?? DEFAULT_VIEW);
  };
  const saveView = () => {
    if (viewId !== 'all') return mutate.mutate(() => listsApi.update(list.id, { views: list.views.map((v) => (v.id === viewId ? { ...v, ...view } : v)) }));
    const name = prompt('Name this view', view.layout === 'board' ? 'Board' : 'My view');
    if (!name?.trim()) return;
    const id = newId();
    mutate.mutate(() => listsApi.update(list.id, { views: [...list.views, { id, name: name.trim().slice(0, 100), ...view }] }), { onSuccess: () => setViewId(id) });
  };
  const deleteView = (id: string) => {
    if (!confirm('Delete this view?')) return;
    mutate.mutate(() => listsApi.update(list.id, { views: list.views.filter((v) => v.id !== id) }), { onSuccess: () => pickView('all') });
  };
  const setCell = (item: ListItemInfo, columnId: string, value: Cell) => mutate.mutate(() => listsApi.updateItem(item.id, { [columnId]: value }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {!compact && (
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <input
              value={title}
              readOnly={!editable}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title.trim() !== list.title && mutate.mutate(() => listsApi.update(list.id, { title: title.trim() }))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="List name"
              maxLength={200}
              className="w-full bg-transparent text-xl font-semibold outline-none"
            />
            <p className="truncate text-xs text-muted">{list.channel ? `${list.channel.teamName} › ${list.channel.name}` : list.members.length ? `Shared with ${list.members.length}` : 'Only you'} · {items.length} item{items.length === 1 ? '' : 's'}</p>
          </div>
          {list.ownerType === 'user' && (
            <button onClick={() => setShare(true)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface-hover"><Share2 size={15} /> Share</button>
          )}
          {editable && (list.ownerType !== 'user' || list.role === 'owner') && (
            <button
              onClick={() => confirm(`Delete “${list.title}” and all its items?`) && mutate.mutate(() => listsApi.remove(list.id), { onSuccess: () => onDeleted?.() })}
              aria-label="Delete list"
              title="Delete list"
              className="rounded p-2 text-muted hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 size={17} />
            </button>
          )}
        </header>
      )}

      {/* Saved views */}
      <div role="tablist" aria-label="Views" className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 pt-2">
        {[{ id: 'all', name: 'All items' }, ...list.views].map((v) => (
          <span key={v.id} className="group flex items-center">
            <button role="tab" aria-selected={viewId === v.id} onClick={() => pickView(v.id)} className={clsx('border-b-2 px-2 pb-2 text-sm whitespace-nowrap', viewId === v.id ? 'border-brand font-semibold' : 'border-transparent text-muted hover:text-text')}>
              {v.name}
            </button>
            {v.id !== 'all' && editable && (
              <button onClick={() => deleteView(v.id)} aria-label={`Delete view ${v.name}`} className="mb-2 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
            )}
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        {editable && (
          <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-hover"><Plus size={15} /> New item</button>
        )}
        <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 focus-within:border-brand">
          <Search size={14} className="text-muted" />
          <span className="sr-only">Search items</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="w-32 bg-transparent text-sm outline-none" />
        </label>
        <select aria-label="Sort by" value={view.sort ? `${view.sort.columnId}:${view.sort.dir}` : ''} onChange={(e) => { const [columnId, dir] = e.target.value.split(':'); setView({ ...view, sort: columnId ? { columnId, dir: dir as 'asc' | 'desc' } : null }); }} className={select}>
          <option value="">Sort: manual</option>
          {list.columns.flatMap((c) => [<option key={`${c.id}a`} value={`${c.id}:asc`}>{c.name} ↑</option>, <option key={`${c.id}d`} value={`${c.id}:desc`}>{c.name} ↓</option>])}
        </select>
        <FilterControl list={list} view={view} setView={setView} />
        <div role="group" aria-label="Layout" className="flex rounded-md border border-border">
          <button aria-pressed={view.layout === 'grid'} onClick={() => setView({ ...view, layout: 'grid' })} title="Grid" aria-label="Grid layout" className={clsx('p-1.5', view.layout === 'grid' ? 'bg-brand-soft text-brand' : 'text-muted')}><Table size={16} /></button>
          <button aria-pressed={view.layout === 'board'} disabled={!choiceColumns.length} onClick={() => setView({ ...view, layout: 'board', groupBy: view.groupBy ?? choiceColumns[0]?.id ?? null })} title={choiceColumns.length ? 'Board' : 'Add a choice column to use the board'} aria-label="Board layout" className={clsx('p-1.5 disabled:opacity-40', view.layout === 'board' ? 'bg-brand-soft text-brand' : 'text-muted')}><Kanban size={16} /></button>
        </div>
        {view.layout === 'board' && choiceColumns.length > 1 && (
          <select aria-label="Group by" value={groupColumn?.id} onChange={(e) => setView({ ...view, groupBy: e.target.value })} className={select}>
            {choiceColumns.map((c) => <option key={c.id} value={c.id}>Group by {c.name}</option>)}
          </select>
        )}
        <span className="flex-1" />
        {editable && dirty && <button onClick={saveView} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface-hover"><Save size={14} /> {viewId === 'all' ? 'Save as view' : 'Save view'}</button>}
        {editable && <button onClick={() => setColumnsOpen(true)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface-hover"><Columns3 size={14} /> Columns</button>}
        <button onClick={() => void downloadCsv(`/lists/${list.id}/export`, `${list.title}.csv`)} title="Export to CSV" aria-label="Export to CSV" className="rounded-md border border-border p-1.5 text-muted hover:bg-surface-hover"><Download size={15} /></button>
      </div>
      {mutate.error && <p className="px-4 pb-1 text-sm text-danger">{errorText(mutate.error)}</p>}

      {view.layout === 'board' && groupColumn ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {lanes(shown, groupColumn).map((lane) => (
            <section
              key={lane.label}
              aria-label={lane.label}
              onDragOver={(e) => editable && e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/item');
                const item = items.find((i) => i.id === id);
                if (item && item.values[groupColumn.id] !== lane.value) setCell(item, groupColumn.id, lane.value);
              }}
              className="flex w-72 shrink-0 flex-col rounded-lg bg-surface-2"
            >
              <h2 className="flex items-center justify-between px-3 pt-2.5 pb-1.5 text-sm font-semibold">{lane.label}<span className="text-xs font-normal text-muted">{lane.items.length}</span></h2>
              <ul className="min-h-12 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {lane.items.map((item) => (
                  <li key={item.id} draggable={editable} onDragStart={(e) => e.dataTransfer.setData('text/item', item.id)}>
                    <button onClick={() => setEditing(item)} className="w-full space-y-1 rounded-md border border-border bg-surface p-2.5 text-left text-sm shadow-sm hover:border-brand">
                      {list.columns.filter((c) => c.id !== groupColumn.id).slice(0, 4).map((c, i) => (
                        <div key={c.id} className={clsx('flex min-w-0 gap-1.5', i === 0 ? 'font-medium' : 'text-xs')}>
                          {i > 0 && <span className="shrink-0 text-muted">{c.name}:</span>}
                          <CellDisplay column={c} value={item.values[c.id]} people={people} />
                        </div>
                      ))}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="sticky top-0 z-[1] bg-surface text-left text-xs text-muted">
              <tr className="border-b border-border">
                {list.columns.map((c) => (
                  <th key={c.id} scope="col" className="min-w-36 px-2 py-2 font-medium">
                    <button
                      onClick={() => setView({ ...view, sort: view.sort?.columnId === c.id && view.sort.dir === 'asc' ? { columnId: c.id, dir: 'desc' } : { columnId: c.id, dir: 'asc' } })}
                      aria-sort={view.sort?.columnId === c.id ? (view.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="hover:text-text"
                    >
                      {c.name}{view.sort?.columnId === c.id && (view.sort.dir === 'asc' ? ' ↑' : ' ↓')}
                    </button>
                  </th>
                ))}
                <th className="w-10"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-surface-hover">
                  {list.columns.map((c) => (
                    <td key={c.id} className="max-w-72 px-2 py-1">
                      <GridCell editable={editable} column={c} value={item.values[c.id]} list={list} people={people} onCommit={(v) => setCell(item, c.id, v)} />
                    </td>
                  ))}
                  <td className="px-1">
                    <button onClick={() => setEditing(item)} aria-label="Open item" title="Open item" className="rounded p-1 text-muted hover:bg-surface hover:text-text"><Settings2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="p-8 text-center text-sm text-muted">{items.length ? 'No items match.' : editable ? 'No items yet. Select New item to add one.' : 'No items yet.'}</p>}
        </div>
      )}

      {editing && <ItemDialog list={list} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {columnsOpen && <ColumnsDialog list={list} onClose={() => setColumnsOpen(false)} />}
      {share && (
        <ShareDialog
          what="list"
          owner={list.owner}
          members={list.members}
          isOwner={list.role === 'owner'}
          onAdd={(ids) => listsApi.addMembers(list.id, ids)}
          onRemove={(id) => listsApi.removeMember(list.id, id)}
          onClose={() => setShare(false)}
          onLeft={onDeleted}
        />
      )}
    </div>
  );
}

const strip = (v: SavedView | undefined): ViewState => (v ? { layout: v.layout, sort: v.sort, filters: v.filters, groupBy: v.groupBy } : DEFAULT_VIEW);

/** Click a cell to edit it in place; Escape or leaving the cell ends editing. */
function GridCell({ editable, column, value, list, people, onCommit }: {
  editable: boolean;
  column: ListDetail['columns'][number];
  value: Cell;
  list: ListDetail;
  people: Map<string, ListDetail['people'][number]>;
  onCommit: (v: Cell) => void;
}) {
  const [active, setActive] = useState(false);
  if (column.type === 'boolean') {
    return <CellInput column={column} value={value} people={list.people} onCommit={(v) => editable && onCommit(v)} />;
  }
  if (!editable || !active) {
    return (
      <button
        disabled={!editable}
        onClick={() => setActive(true)}
        aria-label={`${column.name}: ${value ?? 'empty'}. Edit`}
        className="flex min-h-7 w-full min-w-0 items-center rounded px-1 text-left hover:ring-1 hover:ring-border disabled:cursor-default disabled:hover:ring-0"
      >
        <CellDisplay column={column} value={value} people={people} />
      </button>
    );
  }
  return (
    <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setActive(false)} onKeyDown={(e) => e.key === 'Escape' && setActive(false)}>
      <CellInput column={column} value={value} people={list.people} autoFocus onCommit={(v) => { if (v !== value) onCommit(v); if (column.type !== 'longtext') setActive(false); }} />
    </div>
  );
}

/** One filter per column for now: pick a column and a value (choices, people and yes/no get pickers). */
function FilterControl({ list, view, setView }: { list: ListDetail; view: ViewState; setView: (v: ViewState) => void }) {
  const active = view.filters[0];
  const column = list.columns.find((c) => c.id === active?.columnId);
  const set = (columnId: string, value: string) => setView({ ...view, filters: columnId ? [{ columnId, value }] : [] });
  return (
    <span className="flex items-center gap-1">
      <select aria-label="Filter column" value={active?.columnId ?? ''} onChange={(e) => set(e.target.value, '')} className={select}>
        <option value="">Filter: none</option>
        {list.columns.filter((c) => c.type !== 'date' && c.type !== 'number').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {column && (column.type === 'choice' || column.type === 'person' || column.type === 'boolean' ? (
        <select aria-label="Filter value" value={active.value} onChange={(e) => set(column.id, e.target.value)} className={select}>
          <option value="">Any</option>
          {column.type === 'choice' && column.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          {column.type === 'person' && list.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          {column.type === 'boolean' && <><option value="true">Yes</option><option value="false">No</option></>}
        </select>
      ) : (
        <input aria-label="Filter text" value={active.value} onChange={(e) => set(column.id, e.target.value)} placeholder="contains…" className={clsx(select, 'w-32')} />
      ))}
    </span>
  );
}
