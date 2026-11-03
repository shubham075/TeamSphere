'use client';

import { FileText, Hash, Plus, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { PageTree, PageView } from '@/components/pages/page-view';
import { errorText } from '@/components/teams/ui';
import { formatListTime } from '@/lib/chat';
import { buildTree, pagesApi, useCollabMutation, usePagesHome } from '@/lib/pages';

export default function PagesRoute() {
  return (
    <Suspense>
      <PagesApp />
    </Suspense>
  );
}

/** Pages app: my pages and pages shared with me in the side pane; `?page=<id>` opens one. */
function PagesApp() {
  const params = useSearchParams();
  const router = useRouter();
  const pageId = params.get('page');
  const { data: home } = usePagesHome();
  const create = useCollabMutation(() => pagesApi.create({ title: 'Untitled' }));
  const open = useCallback((id: string | null) => router.push(id ? `/pages?page=${id}` : '/pages'), [router]);

  // Shared trees grouped by their root page.
  const sharedTree = buildTree(home?.shared ?? []);
  return (
    <>
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface max-md:hidden">
        <div className="flex items-center px-5 pt-4 pb-3">
          <h1 className="flex-1 text-xl font-semibold">Pages</h1>
          <button onClick={() => create.mutate(undefined, { onSuccess: (p) => open(p.id) })} aria-label="New page" title="New page" className="rounded p-1.5 text-muted hover:bg-surface-hover">
            <Plus size={18} />
          </button>
        </div>
        {create.error && <p className="px-5 text-xs text-danger">{errorText(create.error)}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <h2 className="px-3 pt-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">My pages</h2>
          {home && !home.mine.length && <p className="px-3 py-1 text-xs text-muted">No pages yet.</p>}
          <PageTree nodes={buildTree(home?.mine ?? [])} activeId={pageId} onOpen={open} />
          {sharedTree.length > 0 && (
            <>
              <h2 className="mt-4 flex items-center gap-1.5 px-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"><Users size={12} /> Shared with me</h2>
              <PageTree nodes={sharedTree} activeId={pageId} onOpen={open} />
            </>
          )}
        </div>
      </aside>
      {pageId ? (
        <PageView key={pageId} pageId={pageId} onNavigate={open} />
      ) : (
        <section className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-1 text-xl font-semibold">Recent pages</h2>
            <p className="mb-4 text-sm text-muted">Co-edited pages: your notes, pages shared with you and your channels’ wikis.</p>
            <button
              onClick={() => create.mutate(undefined, { onSuccess: (p) => open(p.id) })}
              className="mb-4 flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover md:hidden"
            >
              <Plus size={16} /> New page
            </button>
            {home && !home.recent.length && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">Nothing here yet. Create a page to start writing together.</p>}
            <ul className="space-y-2">
              {home?.recent.map((p) => (
                <li key={p.id}>
                  <button onClick={() => open(p.id)} className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:border-brand">
                    {p.channel ? <Hash size={18} className="mt-0.5 text-brand" /> : <FileText size={18} className="mt-0.5 text-brand" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.channel ? `${p.channel.teamName} › ${p.channel.name}` : 'Personal'} · {p.updatedBy ? `${p.updatedBy.displayName}, ` : ''}{formatListTime(p.updatedAt)}
                      </span>
                      {p.excerpt && <span className="mt-1 line-clamp-2 block text-sm text-muted">{p.excerpt}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
