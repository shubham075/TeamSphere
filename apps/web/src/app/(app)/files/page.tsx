'use client';

import clsx from 'clsx';
import { Clock, Folder, Inbox, MessageSquare, RotateCcw, Search, Trash2, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import type { FileItemInfo } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { FileBrowser, FileIcon, FileTable, MenuEntry, modifiedColumn, sizeColumn, UploadPanel, useFileActions } from '@/components/files/file-browser';
import { formatBytes, formatListTime } from '@/lib/chat';
import { filesApi, useAccessRequests, useChatFiles, useFileSearch, useFilesMutation, useFileView } from '@/lib/files';

const VIEWS = [
  { id: 'my', label: 'My files', icon: Folder },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'chat', label: 'Chat files', icon: MessageSquare },
  { id: 'requests', label: 'Access requests', icon: Inbox },
  { id: 'bin', label: 'Recycle bin', icon: Trash2 },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function FilesPage() {
  return (
    <Suspense>
      <FilesApp />
    </Suspense>
  );
}

function FilesApp() {
  const params = useSearchParams();
  const router = useRouter();
  const folder = params.get('folder');
  const view = (params.get('view') as View | null) ?? 'my';
  const [q, setQ] = useState('');
  const { data: requests } = useAccessRequests();

  const go = useCallback((next: { view?: View; folder?: string | null }) => {
    const sp = new URLSearchParams();
    if (next.view && next.view !== 'my') sp.set('view', next.view);
    if (next.folder) sp.set('folder', next.folder);
    setQ('');
    router.push(`/files${sp.size ? `?${sp}` : ''}`);
  }, [router]);

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface max-md:hidden">
        <h1 className="px-5 pt-4 pb-3 text-xl font-semibold">Files</h1>
        <nav aria-label="Files views" className="space-y-0.5 px-2">
          {VIEWS.map((v) => {
            const active = !q && (folder ? v.id === 'my' && view === 'my' : view === v.id);
            return (
              <button
                key={v.id}
                onClick={() => go({ view: v.id })}
                aria-current={active ? 'page' : undefined}
                className={clsx('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm', active ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover')}
              >
                <v.icon size={17} />
                <span className="flex-1">{v.label}</span>
                {v.id === 'requests' && !!requests?.length && (
                  <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{requests.length}</span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="border-b border-border px-6 py-3">
          <label className="flex max-w-md items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 focus-within:border-brand">
            <Search size={16} className="text-muted" />
            <span className="sr-only">Search files</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files by name" className="flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>
        {q.trim() ? (
          <SearchResults q={q.trim()} onFolder={(id) => go({ folder: id })} />
        ) : folder ? (
          <FileBrowser library={undefined} folderId={folder} onNavigate={(id) => go({ folder: id })} onRootCrumb={(root) => go({ view: root })} />
        ) : view === 'my' ? (
          <FileBrowser library={undefined} folderId={null} onNavigate={(id) => go({ folder: id })} />
        ) : view === 'recent' ? (
          <ListView view="recent" title="Recent" onFolder={(id) => go({ folder: id })} columns={[{ label: 'Opened', className: 'w-36', render: (i) => <span className="text-muted">{i.accessedAt && formatListTime(i.accessedAt)}</span> }, sizeColumn]} empty="Files you open or upload show up here." />
        ) : view === 'shared' ? (
          <ListView view="shared" title="Shared with me" onFolder={(id) => go({ folder: id })} columns={[sharedByColumn, modifiedColumn]} empty="Nothing has been shared with you yet." />
        ) : view === 'chat' ? (
          <ChatFiles />
        ) : view === 'requests' ? (
          <Requests />
        ) : (
          <RecycleBin />
        )}
      </section>
      {/* FileBrowser has its own panel; other views can still upload new versions. */}
      {(q.trim() || (!folder && view !== 'my')) && <UploadPanel />}
    </>
  );
}

const sharedByColumn = {
  label: 'Shared by',
  className: 'w-44 max-md:hidden',
  render: (i: FileItemInfo) =>
    i.sharedBy && (
      <span className="flex items-center gap-2 text-muted">
        <Avatar name={i.sharedBy.displayName} src={i.sharedBy.avatarUrl} size={20} />
        <span className="truncate">{i.sharedBy.displayName}</span>
      </span>
    ),
};

function ListView({ view, title, columns, empty, onFolder }: {
  view: 'recent' | 'shared';
  title: string;
  columns: Parameters<typeof FileTable>[0]['columns'];
  empty: string;
  onFolder: (id: string) => void;
}) {
  const { data, isLoading } = useFileView(view);
  const { open, menu, element } = useFileActions(undefined, (item) => onFolder(item.id));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h2 className="px-6 pt-4 pb-2 text-lg font-semibold">{title}</h2>
      <FileTable items={data} loading={isLoading} columns={columns} onOpen={open} menu={menu} empty={empty} />
      {element}
    </div>
  );
}

function SearchResults({ q, onFolder }: { q: string; onFolder: (id: string) => void }) {
  const { data, isLoading } = useFileSearch(q);
  const { open, menu, element } = useFileActions(undefined, (item) => onFolder(item.id));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h2 className="px-6 pt-4 pb-2 text-lg font-semibold">Results for “{q}”</h2>
      <FileTable items={data} loading={isLoading} columns={[modifiedColumn, sizeColumn]} onOpen={open} menu={menu} empty="No files match that name." />
      {element}
    </div>
  );
}

function RecycleBin() {
  const { data, isLoading } = useFileView('recycle-bin');
  const restore = useFilesMutation((id: string) => filesApi.restore(id));
  const purge = useFilesMutation((id: string) => filesApi.purge(id));
  const empty = useFilesMutation(() => filesApi.emptyBin());
  const menu = (item: FileItemInfo): MenuEntry[] => [
    { label: 'Restore', icon: RotateCcw, run: () => restore.mutate(item.id) },
    { label: 'Delete permanently', icon: Trash2, danger: true, run: () => confirm(`Permanently delete “${item.name}”? This can’t be undone.`) && purge.mutate(item.id) },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-3 px-6 pt-4 pb-2">
        <h2 className="flex-1 text-lg font-semibold">Recycle bin</h2>
        {!!data?.length && (
          <button onClick={() => confirm('Permanently delete everything in the recycle bin?') && empty.mutate(undefined)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
            Empty recycle bin
          </button>
        )}
      </div>
      <p className="px-6 pb-2 text-xs text-muted">Deleted items are kept for 93 days, then removed automatically.</p>
      <FileTable
        items={data}
        loading={isLoading}
        onOpen={(i) => restore.mutate(i.id)}
        menu={menu}
        empty="The recycle bin is empty."
        columns={[
          { label: 'Deleted', className: 'w-40', render: (i) => <span className="text-muted">{i.deletedAt && formatListTime(i.deletedAt)}<span className="block truncate text-xs">{i.deletedBy?.displayName}</span></span> },
          sizeColumn,
        ]}
      />
    </div>
  );
}

function ChatFiles() {
  const { data, isLoading } = useChatFiles();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h2 className="px-6 pt-4 pb-1 text-lg font-semibold">Chat files</h2>
      <p className="px-6 pb-2 text-xs text-muted">Files shared in your chats. Read-only here; manage them in the chat.</p>
      {!isLoading && !data?.length && <p className="px-6 py-16 text-center text-sm text-muted">No files have been shared in your chats yet.</p>}
      {!!data?.length && (
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pl-6 font-medium">Name</th>
              <th className="w-56 font-medium max-md:hidden">Shared in</th>
              <th className="w-32 font-medium">Date</th>
              <th className="w-24 font-medium max-sm:hidden">Size</th>
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.id} className="border-b border-border hover:bg-surface-hover">
                <td className="py-2 pl-6">
                  <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:underline">
                    <FileIcon item={{ kind: 'file', mimeType: f.mimeType }} />
                    <span className="truncate">{f.fileName}</span>
                  </a>
                </td>
                <td className="truncate text-muted max-md:hidden">
                  <a href={`/chat/${f.conversationId}`} className="hover:underline">{f.conversationTitle}</a>
                  <span className="block text-xs">{f.sharedBy?.displayName}</span>
                </td>
                <td className="text-muted">{formatListTime(f.createdAt)}</td>
                <td className="text-muted max-sm:hidden">{formatBytes(f.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Requests() {
  const { data, isLoading } = useAccessRequests();
  const decide = useFilesMutation(({ id, decision }: { id: string; decision: 'approve' | 'deny' }) => filesApi.decide(id, decision));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h2 className="px-6 pt-4 pb-2 text-lg font-semibold">Access requests</h2>
      {!isLoading && !data?.length && <p className="px-6 py-16 text-center text-sm text-muted">No pending requests.</p>}
      <ul className="px-4">
        {data?.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-b border-border px-2 py-3 text-sm">
            <Avatar name={r.requester.displayName} src={r.requester.avatarUrl} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block"><strong>{r.requester.displayName}</strong> asks to {r.role === 'edit' ? 'edit' : 'view'} <strong>{r.item.name}</strong></span>
              {r.message && <span className="block text-xs text-muted">“{r.message}”</span>}
              <span className="block text-xs text-muted">{formatListTime(r.createdAt)}</span>
            </span>
            <button onClick={() => decide.mutate({ id: r.id, decision: 'approve' })} className="rounded-md bg-brand px-3 py-1.5 font-semibold text-brand-text hover:bg-brand-hover">Approve</button>
            <button onClick={() => decide.mutate({ id: r.id, decision: 'deny' })} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover">Deny</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
