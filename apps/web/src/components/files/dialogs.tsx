'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Copy, Download, Folder, Link2, Loader2, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FileDetail, FileItemInfo, PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api, ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/chat';
import {
  absoluteUrl, filesApi, fk, LibraryRef, previewKind, uploadFiles, useFilesMutation, useFolder, useSharing, useVersions,
} from '@/lib/files';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong' : null);

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
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
        className={`flex max-h-[84vh] w-full flex-col rounded-xl border border-border bg-surface shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const buttonCls = 'rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover';
const primaryCls = 'rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50';

/** New folder and rename. */
export function NameDialog({ title, initial = '', action, onSubmit, onClose }: {
  title: string;
  initial?: string;
  action: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 px-5 py-4">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Name</span>
          <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-brand" />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={buttonCls}>Cancel</button>
          <button disabled={!name.trim() || busy} className={primaryCls}>{action}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Folder picker for "Move to" / "Copy to". Moves stay in the item's library; copies can go to My files. */
export function FolderPicker({ item, mode, library, onClose }: { item: FileItemInfo; mode: 'move' | 'copy'; library: LibraryRef; onClose: () => void }) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [lib, setLib] = useState<LibraryRef>(library);
  const { data, isLoading } = useFolder(lib, folderId);
  const run = useFilesMutation(() => (mode === 'move' ? filesApi.move(item.id, lib, folderId) : filesApi.copy(item.id, lib, folderId)));
  const folders = data?.items.filter((i) => i.kind === 'folder' && i.id !== item.id) ?? [];
  const canWrite = data && data.role !== 'view';
  return (
    <Modal title={`${mode === 'move' ? 'Move' : 'Copy'} “${item.name}”`} onClose={onClose}>
      <div className="flex items-center gap-1 px-5 pt-3 text-sm">
        {data?.breadcrumbs.map((c, i) => (
          <span key={c.id ?? 'root'} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-muted" />}
            <button onClick={() => setFolderId(c.id)} className="rounded px-1 hover:bg-surface-hover">{c.name}</button>
          </span>
        ))}
        {mode === 'copy' && library && (
          <button onClick={() => { setLib(lib ? undefined : library); setFolderId(null); }} className="ml-auto text-xs text-brand hover:underline">
            {lib ? 'Copy to My files instead' : 'Back to this library'}
          </button>
        )}
      </div>
      <ul className="mx-3 my-2 min-h-40 flex-1 overflow-y-auto">
        {isLoading && <li className="p-4"><Loader2 className="animate-spin text-muted" /></li>}
        {folders.map((f) => (
          <li key={f.id}>
            <button onClick={() => setFolderId(f.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover">
              <Folder size={18} className="text-brand" /> {f.name}
            </button>
          </li>
        ))}
        {data && !folders.length && <li className="px-2 py-6 text-center text-sm text-muted">No folders here.</li>}
      </ul>
      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
        {run.error && <p role="alert" className="mr-auto text-sm text-danger">{errorText(run.error)}</p>}
        <button onClick={onClose} className={buttonCls}>Cancel</button>
        <button disabled={!canWrite || run.isPending} onClick={() => run.mutateAsync(undefined).then(onClose)} className={primaryCls}>
          {mode === 'move' ? 'Move here' : 'Copy here'}
        </button>
      </div>
    </Modal>
  );
}

/** Specific people (view/edit), org-wide links and pending access requests. */
export function ShareDialog({ item, onClose }: { item: FileItemInfo; onClose: () => void }) {
  const { data } = useSharing(item.id);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [copied, setCopied] = useState<string | null>(null);
  const { data: people } = useQuery({
    queryKey: ['people', q],
    queryFn: () => api<PublicUser[]>(`/users?take=8&q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: fk.sharing(item.id) });
  const share = useFilesMutation(() => filesApi.share(item.id, picked.map((u) => u.id), role));
  const act = useFilesMutation((fn: () => Promise<unknown>) => fn().then(refresh));
  const hasAccess = new Set([data?.owner?.id, ...(data?.shares.map((s) => s.user.id) ?? [])]);

  async function copyLink(path: string, key: string) {
    await navigator.clipboard.writeText(absoluteUrl(path)).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Modal title={`Share “${item.name}”`} onClose={onClose}>
      <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
        <section aria-label="Share with people" className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border px-2 py-1.5 focus-within:border-brand">
            {picked.map((u) => (
              <span key={u.id} className="flex items-center gap-1 rounded bg-brand-soft px-2 py-0.5 text-brand">
                {u.displayName}
                <button onClick={() => setPicked((p) => p.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.displayName}`}><X size={12} /></button>
              </span>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people by name" aria-label="Add people" className="min-w-[120px] flex-1 bg-transparent py-1 outline-none" />
          </div>
          {q && (
            <ul className="rounded-md border border-border">
              {people?.filter((u) => !hasAccess.has(u.id) && !picked.some((p) => p.id === u.id)).map((u) => (
                <li key={u.id}>
                  <button onClick={() => { setPicked((p) => [...p, u]); setQ(''); }} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-hover">
                    <Avatar name={u.displayName} src={u.avatarUrl} size={24} /> {u.displayName}
                    <span className="text-xs text-muted">{u.jobTitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2">
              <span className="text-muted">Permission</span>
              <select value={role} onChange={(e) => setRole(e.target.value as 'view' | 'edit')} className="rounded-md border border-border bg-surface px-2 py-1">
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
            </label>
            <button disabled={!picked.length || share.isPending} onClick={() => share.mutateAsync(undefined).then(() => { setPicked([]); void refresh(); })} className={`ml-auto ${primaryCls}`}>
              Share
            </button>
          </div>
          {share.error && <p role="alert" className="text-danger">{errorText(share.error)}</p>}
        </section>

        <section aria-label="Links" className="space-y-2">
          <h3 className="font-semibold">Links</h3>
          <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
            <Link2 size={16} className="text-muted" />
            <span className="flex-1">People with existing access</span>
            <button onClick={() => copyLink(`/files/item/${item.id}`, 'direct')} className="flex items-center gap-1 text-brand hover:underline">
              <Copy size={14} /> {copied === 'direct' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          {data?.links.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              <Link2 size={16} className="text-brand" />
              <span className="flex-1">
                People in your organization can {l.role === 'edit' ? 'edit' : 'view'}
                {l.inheritedFrom && <span className="block text-xs text-muted">From folder “{l.inheritedFrom.name}”</span>}
              </span>
              <button onClick={() => copyLink(`/files/link/${l.token}`, l.id)} className="flex items-center gap-1 text-brand hover:underline">
                <Copy size={14} /> {copied === l.id ? 'Copied' : 'Copy'}
              </button>
              {!l.inheritedFrom && (
                <button onClick={() => act.mutate(() => filesApi.revokeLink(l.id))} aria-label="Remove link" title="Remove link" className="rounded p-1 text-muted hover:bg-surface-hover hover:text-danger">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            {(['view', 'edit'] as const).filter((r) => !data?.links.some((l) => l.role === r && !l.inheritedFrom)).map((r) => (
              <button key={r} onClick={() => act.mutate(() => filesApi.createLink(item.id, r))} className={buttonCls}>
                + Org link ({r === 'view' ? 'can view' : 'can edit'})
              </button>
            ))}
          </div>
        </section>

        {!!data?.requests.length && (
          <section aria-label="Access requests" className="space-y-2">
            <h3 className="font-semibold">Requests</h3>
            {data.requests.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <Avatar name={r.requester.displayName} src={r.requester.avatarUrl} size={28} />
                <span className="flex-1">
                  {r.requester.displayName} wants to {r.role}
                  {r.message && <span className="block text-xs text-muted">“{r.message}”</span>}
                </span>
                <button onClick={() => act.mutate(() => filesApi.decide(r.id, 'approve'))} className={primaryCls}>Approve</button>
                <button onClick={() => act.mutate(() => filesApi.decide(r.id, 'deny'))} className={buttonCls}>Deny</button>
              </div>
            ))}
          </section>
        )}

        <section aria-label="People with access" className="space-y-1">
          <h3 className="font-semibold">Who has access</h3>
          {data?.owner && (
            <div className="flex items-center gap-2 py-1">
              <Avatar name={data.owner.displayName} src={data.owner.avatarUrl} size={28} />
              <span className="flex-1">{data.owner.displayName}</span>
              <span className="text-xs text-muted">Owner</span>
            </div>
          )}
          {data?.shares.map((s) => (
            <div key={s.user.id} className="flex items-center gap-2 py-1">
              <Avatar name={s.user.displayName} src={s.user.avatarUrl} size={28} />
              <span className="flex-1">
                {s.user.displayName}
                {s.inheritedFrom && <span className="block text-xs text-muted">From folder “{s.inheritedFrom.name}”</span>}
              </span>
              <span className="text-xs text-muted">{s.role === 'edit' ? 'Can edit' : 'Can view'}</span>
              {!s.inheritedFrom && (
                <button onClick={() => act.mutate(() => filesApi.unshare(item.id, s.user.id))} aria-label={`Stop sharing with ${s.user.displayName}`} title="Stop sharing" className="rounded p-1 text-muted hover:bg-surface-hover hover:text-danger">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </section>
        {act.error && <p role="alert" className="text-danger">{errorText(act.error)}</p>}
      </div>
    </Modal>
  );
}

export function VersionsDialog({ item, onClose }: { item: FileItemInfo; onClose: () => void }) {
  const { data, isLoading } = useVersions(item.id);
  const qc = useQueryClient();
  const restore = useFilesMutation((versionId: string) => filesApi.restoreVersion(item.id, versionId));
  const input = useRef<HTMLInputElement>(null);
  const canWrite = item.role !== 'view';
  return (
    <Modal title={`Version history: ${item.name}`} onClose={onClose}>
      <ul className="flex-1 overflow-y-auto px-3 py-2 text-sm">
        {isLoading && <li className="p-4"><Loader2 className="animate-spin text-muted" /></li>}
        {data?.map((v) => (
          <li key={v.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
            <span className="w-10 font-semibold">v{v.version}</span>
            <span className="min-w-0 flex-1">
              <span className="block">{new Date(v.createdAt).toLocaleString()}{v.current && <span className="ml-2 rounded bg-brand-soft px-1.5 text-xs text-brand">Current</span>}</span>
              <span className="block text-xs text-muted">{v.createdBy?.displayName ?? 'Unknown'} · {formatBytes(v.size)}</span>
            </span>
            <a href={v.downloadUrl} aria-label={`Download version ${v.version}`} title="Download" className="rounded p-1.5 text-muted hover:bg-surface-2"><Download size={16} /></a>
            {canWrite && !v.current && (
              <button onClick={() => restore.mutate(v.id)} disabled={restore.isPending} aria-label={`Restore version ${v.version}`} title="Restore" className="rounded p-1.5 text-muted hover:bg-surface-2">
                <RotateCcw size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
        {restore.error && <p role="alert" className="mr-auto text-sm text-danger">{errorText(restore.error)}</p>}
        {canWrite && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFiles(qc, [f], { library: undefined, parentId: null, versionOf: item.id });
                e.target.value = '';
              }}
            />
            <button onClick={() => input.current?.click()} className={`flex items-center gap-2 ${buttonCls}`}>
              <Upload size={16} /> Upload new version
            </button>
          </>
        )}
        <button onClick={onClose} className={primaryCls}>Done</button>
      </div>
    </Modal>
  );
}

/** Inline viewer for images, video, audio, PDF and plain text; everything else offers a download. */
export function PreviewDialog({ detail, onClose }: { detail: FileDetail; onClose: () => void }) {
  const kind = previewKind(detail.mimeType);
  const url = detail.contentUrl!;
  return (
    <Modal title={detail.name} onClose={onClose} wide>
      <div className="flex min-h-[50vh] flex-1 items-center justify-center overflow-auto bg-surface-2 p-3">
        {kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={detail.name} className="max-h-[68vh] max-w-full object-contain" />
        )}
        {kind === 'video' && <video src={url} controls className="max-h-[68vh] max-w-full" />}
        {kind === 'audio' && <audio src={url} controls className="w-full max-w-xl" />}
        {(kind === 'pdf' || kind === 'text') && <iframe src={url} title={detail.name} className="h-[68vh] w-full rounded bg-white" />}
        {!kind && <p className="text-sm text-muted">No preview available for this file type.</p>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
        <span className="text-muted">
          {formatBytes(detail.size)} · v{detail.version} · modified {new Date(detail.modifiedAt).toLocaleString()}
          {detail.modifiedBy && ` by ${detail.modifiedBy.displayName}`}
        </span>
        <a href={detail.downloadUrl!} className={`flex items-center gap-2 ${primaryCls}`}><Download size={16} /> Download</a>
      </div>
    </Modal>
  );
}
