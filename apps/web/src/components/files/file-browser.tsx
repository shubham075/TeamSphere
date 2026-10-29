'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CheckCircle2, ChevronRight, Copy, Download, FileArchive, FileAudio, FileImage, FileText, FileVideo, Folder, FolderInput,
  FolderPlus, History, Link2, Loader2, MoreHorizontal, Pencil, Share2, Trash2, Upload, Users, X, XCircle,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { FileDetail, FileItemInfo } from '@teamsphere/shared';
import { ApiError } from '@/lib/api';
import { formatBytes, formatListTime } from '@/lib/chat';
import { absoluteUrl, fetchDetail, filesApi, LibraryRef, uploadFiles, useFilesMutation, useFolder, useUploads } from '@/lib/files';
import { useDismiss } from '@/lib/use-dismiss';
import { FolderPicker, NameDialog, PreviewDialog, ShareDialog, VersionsDialog } from './dialogs';

export function FileIcon({ item, size = 20 }: { item: Pick<FileItemInfo, 'kind' | 'mimeType'>; size?: number }) {
  if (item.kind === 'folder') return <Folder size={size} className="shrink-0 fill-brand-soft text-brand" />;
  const m = item.mimeType ?? '';
  const Icon = m.startsWith('image/') ? FileImage : m.startsWith('video/') ? FileVideo : m.startsWith('audio/') ? FileAudio : /zip|compressed|tar/.test(m) ? FileArchive : FileText;
  return <Icon size={size} className="shrink-0 text-muted" />;
}

type Dialog =
  | { type: 'rename' | 'share' | 'versions' | 'move' | 'copy'; item: FileItemInfo }
  | { type: 'preview'; detail: FileDetail }
  | null;

/** Opening files (preview dialog) and the per-item dialogs, shared by every Files view. */
export function useFileActions(library: LibraryRef, onOpenFolder: (item: FileItemInfo) => void) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const rename = useFilesMutation(({ id, name }: { id: string; name: string }) => filesApi.rename(id, name));
  const remove = useFilesMutation((id: string) => filesApi.remove(id));

  const open = useCallback(
    async (item: FileItemInfo) => {
      if (item.kind === 'folder') return onOpenFolder(item);
      try {
        setDialog({ type: 'preview', detail: await fetchDetail(item.id) });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not open the file');
      }
    },
    [onOpenFolder],
  );
  const download = async (item: FileItemInfo) => {
    const d = await fetchDetail(item.id);
    if (d.downloadUrl) location.assign(d.downloadUrl);
  };
  const close = () => setDialog(null);

  const element = (
    <>
      {error && (
        <div role="alert" className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-md bg-danger px-3 py-2 text-sm text-white shadow-lg">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      {dialog?.type === 'preview' && <PreviewDialog detail={dialog.detail} onClose={close} />}
      {dialog?.type === 'rename' && (
        <NameDialog title="Rename" action="Rename" initial={dialog.item.name} onClose={close} onSubmit={(name) => rename.mutateAsync({ id: dialog.item.id, name })} />
      )}
      {dialog?.type === 'share' && <ShareDialog item={dialog.item} onClose={close} />}
      {dialog?.type === 'versions' && <VersionsDialog item={dialog.item} onClose={close} />}
      {(dialog?.type === 'move' || dialog?.type === 'copy') && <FolderPicker item={dialog.item} mode={dialog.type} library={library} onClose={close} />}
    </>
  );

  const menu = (item: FileItemInfo) => {
    const write = item.role !== 'view';
    const share = item.role !== 'view';
    return [
      { label: 'Open', icon: item.kind === 'folder' ? Folder : FileText, run: () => open(item) },
      item.kind === 'file' && { label: 'Download', icon: Download, run: () => download(item) },
      share && { label: 'Share', icon: Share2, run: () => setDialog({ type: 'share', item }) },
      { label: 'Copy link', icon: Link2, run: () => navigator.clipboard.writeText(absoluteUrl(`/files/item/${item.id}`)) },
      write && { label: 'Rename', icon: Pencil, run: () => setDialog({ type: 'rename', item }) },
      write && { label: 'Move to', icon: FolderInput, run: () => setDialog({ type: 'move', item }) },
      { label: 'Copy to', icon: Copy, run: () => setDialog({ type: 'copy', item }) },
      item.kind === 'file' && { label: 'Version history', icon: History, run: () => setDialog({ type: 'versions', item }) },
      write && { label: 'Delete', icon: Trash2, danger: true, run: () => remove.mutate(item.id) },
    ].filter(Boolean) as MenuEntry[];
  };

  return { open, menu, element };
}

export interface MenuEntry {
  label: string;
  icon: typeof Folder;
  danger?: boolean;
  run: () => unknown;
}

function ItemMenu({ name, entries }: { name: string; entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${name}`} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-border bg-surface py-1 text-sm shadow-lg">
          {entries.map((e) => (
            <li key={e.label} role="none">
              <button
                role="menuitem"
                onClick={() => { setOpen(false); void e.run(); }}
                className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover', e.danger && 'text-danger')}
              >
                <e.icon size={15} /> {e.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface Column {
  label: string;
  render: (item: FileItemInfo) => React.ReactNode;
  className?: string;
}

export const modifiedColumn: Column = {
  label: 'Modified',
  className: 'w-40 max-md:hidden',
  render: (i) => (
    <span className="text-muted">
      {formatListTime(i.modifiedAt)}
      {i.modifiedBy && <span className="block truncate text-xs">{i.modifiedBy.displayName}</span>}
    </span>
  ),
};
export const sizeColumn: Column = { label: 'Size', className: 'w-24 max-sm:hidden', render: (i) => <span className="text-muted">{i.kind === 'file' ? formatBytes(i.size) : ''}</span> };

export function FileTable({ items, columns, onOpen, menu, empty, loading }: {
  items: FileItemInfo[] | undefined;
  columns: Column[];
  onOpen: (item: FileItemInfo) => void;
  menu: (item: FileItemInfo) => MenuEntry[];
  empty: React.ReactNode;
  loading?: boolean;
}) {
  if (loading) return <Loader2 className="m-6 animate-spin text-muted" />;
  if (!items?.length) return <div className="px-6 py-16 text-center text-sm text-muted">{empty}</div>;
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
        <tr className="border-b border-border">
          <th className="py-2 pl-6 font-medium">Name</th>
          {columns.map((c) => <th key={c.label} className={clsx('py-2 font-medium', c.className)}>{c.label}</th>)}
          <th className="w-12"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="group border-b border-border hover:bg-surface-hover" onDoubleClick={() => onOpen(item)}>
            <td className="py-2 pl-6">
              <button onClick={() => onOpen(item)} className="flex max-w-full items-center gap-3 text-left hover:underline">
                <FileIcon item={item} />
                <span className="truncate">{item.name}</span>
                {item.shared && <Users size={13} className="shrink-0 text-muted" aria-label="Shared" />}
                {item.kind === 'file' && item.version > 1 && <span className="shrink-0 text-[11px] text-muted">v{item.version}</span>}
              </button>
              {item.location && <span className="block truncate pl-8 text-xs text-muted">{item.location}</span>}
            </td>
            {columns.map((c) => <td key={c.label} className={clsx('py-2 pr-2 align-top', c.className)}>{c.render(item)}</td>)}
            <td className="py-2 pr-3"><ItemMenu name={item.name} entries={menu(item)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Folder browser with upload (button or drag-and-drop) for My files and channel libraries. */
export function FileBrowser({ library, folderId, onNavigate, onRootCrumb }: {
  library: LibraryRef;
  folderId: string | null;
  onNavigate: (folderId: string | null) => void;
  /** Breadcrumb root for folders reached through "Shared with me". */
  onRootCrumb?: (root: 'my' | 'shared') => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useFolder(library, folderId);
  const [newFolder, setNewFolder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { open, menu, element } = useFileActions(library, (item) => onNavigate(item.id));
  const createFolder = useFilesMutation((name: string) => filesApi.createFolder(library, folderId, name));
  const canWrite = !!data && data.role !== 'view';
  const target = { library: data?.folder ? undefined : library, parentId: folderId };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (canWrite && files.length) void uploadFiles(qc, files, target);
  };

  if (error) return <p role="alert" className="p-6 text-sm text-danger">{error instanceof ApiError ? error.message : 'Could not load this folder'}</p>;

  return (
    <div
      className={clsx('relative flex min-h-0 flex-1 flex-col', dragging && 'ring-2 ring-brand ring-inset')}
      onDragOver={(e) => { if (canWrite && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2">
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {data?.breadcrumbs.map((c, i) => (
            <span key={c.id ?? 'root'} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={14} className="shrink-0 text-muted" />}
              <button
                onClick={() => (c.id === null && data.root === 'shared' && onRootCrumb ? onRootCrumb('shared') : onNavigate(c.id))}
                aria-current={i === data.breadcrumbs.length - 1 ? 'page' : undefined}
                className={clsx('truncate rounded px-1 hover:bg-surface-hover', i === data.breadcrumbs.length - 1 && 'font-semibold')}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        {canWrite && (
          <>
            <button onClick={() => setNewFolder(true)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover">
              <FolderPlus size={16} /> New folder
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) void uploadFiles(qc, files, target);
                e.target.value = '';
              }}
            />
            <button onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-hover">
              <Upload size={16} /> Upload
            </button>
          </>
        )}
        {data?.role === 'view' && <span className="rounded bg-surface-2 px-2 py-1 text-xs text-muted">View only</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTable
          items={data?.items}
          loading={isLoading}
          columns={[modifiedColumn, sizeColumn]}
          onOpen={open}
          menu={menu}
          empty={canWrite ? 'This folder is empty. Drag files here or use Upload.' : 'This folder is empty.'}
        />
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand-soft/60 text-lg font-semibold text-brand">Drop files to upload</div>
      )}
      {newFolder && <NameDialog title="New folder" action="Create" onClose={() => setNewFolder(false)} onSubmit={(name) => createFolder.mutateAsync(name)} />}
      {element}
      <UploadPanel />
    </div>
  );
}

export function UploadPanel() {
  const { jobs, clearFinished } = useUploads();
  if (!jobs.length) return null;
  const active = jobs.filter((j) => j.status === 'uploading').length;
  return (
    <section aria-label="Uploads" aria-live="polite" className="fixed right-4 bottom-4 z-40 w-80 rounded-lg border border-border bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-semibold">
        {active ? `Uploading ${active} item${active > 1 ? 's' : ''}…` : 'Uploads complete'}
        {!active && <button onClick={clearFinished} aria-label="Close uploads" className="rounded p-1 hover:bg-surface-hover"><X size={14} /></button>}
      </div>
      <ul className="max-h-60 overflow-y-auto px-3 py-2 text-sm">
        {jobs.map((j) => (
          <li key={j.id} className="py-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{j.name}</span>
              {j.status === 'done' && <CheckCircle2 size={15} className="text-success" aria-label="Done" />}
              {j.status === 'error' && <XCircle size={15} className="text-danger" aria-label="Failed" />}
            </div>
            {j.status === 'uploading' && (
              <div className="mt-1 h-1.5 rounded bg-surface-2" role="progressbar" aria-label={`Uploading ${j.name}`} aria-valuenow={Math.round((j.loaded / Math.max(j.size, 1)) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded bg-brand" style={{ width: `${(j.loaded / Math.max(j.size, 1)) * 100}%` }} />
              </div>
            )}
            {j.status === 'done' && j.versioned && <p className="text-xs text-muted">Saved as a new version</p>}
            {j.status === 'error' && <p className="text-xs text-danger">{j.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

