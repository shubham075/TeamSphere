'use client';

import { Hash, ListChecks, Plus, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { NewListDialog } from '@/components/lists/list-dialogs';
import { ListView } from '@/components/lists/list-view';
import { primaryButton } from '@/components/teams/ui';
import { formatListTime } from '@/lib/chat';
import { useLists } from '@/lib/lists';

export default function ListsRoute() {
  return (
    <Suspense>
      <ListsApp />
    </Suspense>
  );
}

/** Lists app: all lists the user can open; `?list=<id>` opens one. */
function ListsApp() {
  const params = useSearchParams();
  const router = useRouter();
  const listId = params.get('list');
  const { data: lists, isLoading } = useLists();
  const [creating, setCreating] = useState(false);

  if (listId) return <ListView key={listId} listId={listId} onDeleted={() => router.push('/lists')} />;
  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="flex-1 text-xl font-semibold">Lists</h1>
          <button onClick={() => setCreating(true)} className={`${primaryButton} flex items-center gap-1.5`}><Plus size={16} /> New list</button>
        </div>
        {!isLoading && !lists?.length && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
            <ListChecks size={30} className="text-brand" />
            <p className="max-w-sm text-sm text-muted">Track issues, assets, events or anything else in a table with your own columns. Start from a template.</p>
          </div>
        )}
        <ul className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {lists?.map((l) => (
            <li key={l.id}>
              <button onClick={() => router.push(`/lists?list=${l.id}`)} className="flex h-full w-full flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-left hover:border-brand">
                <span className="flex items-center gap-2 font-medium"><ListChecks size={18} className="shrink-0 text-brand" /> <span className="truncate">{l.title}</span></span>
                {l.description && <span className="line-clamp-2 text-sm text-muted">{l.description}</span>}
                <span className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted">
                  {l.channel ? <Hash size={12} aria-hidden /> : <User size={12} aria-hidden />}
                  <span className="truncate">{l.channel ? `${l.channel.teamName} › ${l.channel.name}` : 'Personal'}</span> · {l.itemCount} items · {formatListTime(l.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {creating && <NewListDialog onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), router.push(`/lists?list=${id}`))} />}
    </section>
  );
}
