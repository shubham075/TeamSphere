'use client';

import clsx from 'clsx';
import { ChevronRight, FilePlus2, FileText, Loader2, Share2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorText } from '@/components/teams/ui';
import { formatListTime } from '@/lib/chat';
import { MEETING_NOTES_TEMPLATE, pagesApi, useCollabMutation, usePage } from '@/lib/pages';
import { PageEditor } from './page-editor';
import { ShareDialog } from './share-dialog';

/** One page: breadcrumbs, title, editor and subpages. Used by the Pages app, channel wikis and meeting notes. */
export function PageView({ pageId, onNavigate, template, hideBreadcrumbs }: {
  pageId: string;
  onNavigate: (id: string | null) => void;
  template?: string;
  hideBreadcrumbs?: boolean;
}) {
  const { data: page, isLoading, error } = usePage(pageId);
  const [title, setTitle] = useState('');
  const [share, setShare] = useState(false);
  const save = useCollabMutation((t: string) => pagesApi.update(pageId, { title: t }));
  const addSub = useCollabMutation(() => pagesApi.create({ parentId: pageId, title: 'Untitled' }));
  const del = useCollabMutation(() => pagesApi.remove(pageId));
  useEffect(() => setTitle(page?.title ?? ''), [page?.title]);

  if (isLoading) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (!page) return <p className="p-6 text-sm text-muted">{errorText(error) ?? 'This page is not available.'}</p>;
  const editable = page.role !== 'view';
  const isMeetingRoot = page.ownerType === 'meeting' && page.id === page.rootId;
  const canDelete = editable && !isMeetingRoot && !(page.ownerType === 'user' && page.id === page.rootId && page.role !== 'owner');
  const err = errorText(save.error ?? addSub.error ?? del.error);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header className="border-b border-border px-6 pt-3 pb-2">
        {!hideBreadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            {page.channel && <span>{page.channel.teamName} › {page.channel.name} ›</span>}
            {page.meeting && <span>Meeting ›</span>}
            {page.breadcrumbs.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} aria-hidden />}
                {i === page.breadcrumbs.length - 1 ? <span aria-current="page">{b.title}</span> : <button onClick={() => onNavigate(b.id)} className="hover:underline">{b.title}</button>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <input
            value={title}
            readOnly={!editable}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== page.title && save.mutate(title.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Page title"
            maxLength={200}
            className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none"
          />
          {editable && (
            <button onClick={() => addSub.mutate(undefined, { onSuccess: (p) => onNavigate(p.id) })} title="Add a subpage" aria-label="Add a subpage" className="rounded p-2 text-muted hover:bg-surface-hover">
              <FilePlus2 size={18} />
            </button>
          )}
          {page.ownerType === 'user' && (
            <button onClick={() => setShare(true)} title="Share" aria-label="Share page" className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface-hover">
              <Share2 size={15} /> {page.members.length ? page.members.length + 1 : 'Share'}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => confirm(`Delete “${page.title}”${page.children.length ? ' and its subpages' : ''}? This can’t be undone.`) && del.mutate(undefined, { onSuccess: () => onNavigate(page.parentId) })}
              title="Delete page"
              aria-label="Delete page"
              className="rounded p-2 text-muted hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          {page.updatedBy ? `Edited by ${page.updatedBy.displayName} ${formatListTime(page.updatedAt)}` : `Created ${formatListTime(page.createdAt)}`}
          {!editable && ' · Read-only'}
        </p>
        {err && <p className="mt-1 text-sm text-danger">{err}</p>}
      </header>
      <PageEditor pageId={page.id} template={template ?? (isMeetingRoot ? MEETING_NOTES_TEMPLATE : undefined)} />
      {page.children.length > 0 && (
        <section aria-label="Subpages" className="border-t border-border px-6 py-3">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Subpages</h2>
          <ul className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {page.children.map((c) => (
              <li key={c.id}>
                <button onClick={() => onNavigate(c.id)} className="flex w-full items-start gap-2 rounded-md border border-border p-2.5 text-left hover:border-brand">
                  <FileText size={16} className="mt-0.5 shrink-0 text-brand" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    {c.excerpt && <span className="line-clamp-1 text-xs text-muted">{c.excerpt}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {share && (
        <ShareDialog
          what="page"
          owner={page.owner}
          members={page.members}
          isOwner={page.role === 'owner'}
          onAdd={(ids) => pagesApi.addMembers(page.id, ids)}
          onRemove={(id) => pagesApi.removeMember(page.id, id)}
          onClose={() => setShare(false)}
          onLeft={() => onNavigate(null)}
        />
      )}
    </div>
  );
}

/** Collapsible page tree for side panes (Pages app, channel wiki). */
export function PageTree({ nodes, activeId, onOpen, depth = 0 }: {
  nodes: import('@/lib/pages').PageNode[];
  activeId: string | null;
  onOpen: (id: string) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} className="space-y-0.5">
      {nodes.map((n) => {
        const open = !collapsed.has(n.id);
        return (
          <li key={n.id} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-selected={activeId === n.id}>
            <div className={clsx('flex items-center rounded-md text-sm', activeId === n.id ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover')} style={{ paddingLeft: depth * 14 }}>
              {n.children.length ? (
                <button
                  onClick={() => setCollapsed((s) => { const next = new Set(s); if (open) next.add(n.id); else next.delete(n.id); return next; })}
                  aria-label={open ? `Collapse ${n.title}` : `Expand ${n.title}`}
                  className="rounded p-1 text-muted"
                >
                  <ChevronRight size={13} className={clsx('transition-transform', open && 'rotate-90')} />
                </button>
              ) : (
                <span className="w-[21px]" />
              )}
              <button onClick={() => onOpen(n.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left">
                <FileText size={14} className="shrink-0" aria-hidden />
                <span className="truncate">{n.title}</span>
              </button>
            </div>
            {open && n.children.length > 0 && <PageTree nodes={n.children} activeId={activeId} onOpen={onOpen} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}
