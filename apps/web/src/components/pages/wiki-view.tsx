'use client';

import { BookOpen, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { errorText, primaryButton } from '@/components/teams/ui';
import { buildTree, pagesApi, useChannelPages, useCollabMutation } from '@/lib/pages';
import { PageTree, PageView } from './page-view';

/** A channel's Wiki tab: the channel's page tree beside the open page. */
export function WikiView({ channelId, readOnly }: { channelId: string; readOnly: boolean }) {
  const { data: pages, isLoading } = useChannelPages(channelId);
  const [openId, setOpenId] = useState<string | null>(null);
  const create = useCollabMutation(() => pagesApi.create({ channelId, title: 'Untitled' }));
  const tree = buildTree(pages ?? []);
  const current = openId && pages?.some((p) => p.id === openId) ? openId : (tree[0]?.id ?? null);

  if (isLoading) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (!tree.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <BookOpen size={32} className="text-brand" />
        <p className="max-w-sm text-sm text-muted">The wiki holds this channel’s shared pages: how-tos, decisions, onboarding. Everyone in the channel can edit them together.</p>
        {!readOnly && <button onClick={() => create.mutate(undefined, { onSuccess: (p) => setOpenId(p.id) })} className={primaryButton}>Create the first page</button>}
        {create.error && <p className="text-sm text-danger">{errorText(create.error)}</p>}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Wiki pages" className="flex w-60 shrink-0 flex-col border-r border-border bg-surface max-md:hidden">
        <div className="flex items-center px-4 pt-3 pb-2">
          <h2 className="flex-1 text-sm font-semibold">Pages</h2>
          {!readOnly && (
            <button onClick={() => create.mutate(undefined, { onSuccess: (p) => setOpenId(p.id) })} aria-label="New wiki page" title="New page" className="rounded p-1 text-muted hover:bg-surface-hover">
              <Plus size={16} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <PageTree nodes={tree} activeId={current} onOpen={setOpenId} />
        </div>
      </aside>
      {current && <PageView key={current} pageId={current} onNavigate={(id) => setOpenId(id)} hideBreadcrumbs />}
    </div>
  );
}
