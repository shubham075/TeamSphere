'use client';

import clsx from 'clsx';
import { ClipboardList, Hash, Plus, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FormManager } from '@/components/forms/form-manager';
import { NewFormDialog } from '@/components/forms/new-form-dialog';
import { primaryButton } from '@/components/teams/ui';
import { formatListTime } from '@/lib/chat';
import { useForms } from '@/lib/lists';

export default function FormsRoute() {
  return (
    <Suspense>
      <FormsApp />
    </Suspense>
  );
}

const STATUS_LABEL = { draft: 'Draft', open: 'Open', closed: 'Closed' } as const;

/** Forms app: forms the user authors (personal, shared or channel); `?form=<id>` opens the editor. */
function FormsApp() {
  const params = useSearchParams();
  const router = useRouter();
  const formId = params.get('form');
  const { data: forms, isLoading } = useForms();
  const [creating, setCreating] = useState(false);

  if (formId) return <FormManager key={formId} formId={formId} onDeleted={() => router.push('/forms')} />;
  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="flex-1 text-xl font-semibold">Forms</h1>
          <button onClick={() => setCreating(true)} className={`${primaryButton} flex items-center gap-1.5`}><Plus size={16} /> New form</button>
        </div>
        {!isLoading && !forms?.length && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
            <ClipboardList size={30} className="text-brand" />
            <p className="max-w-sm text-sm text-muted">Create a survey, poll or sign-up form, share the link and watch results come in live.</p>
          </div>
        )}
        <ul className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {forms?.map((f) => (
            <li key={f.id}>
              <button onClick={() => router.push(`/forms?form=${f.id}`)} className="flex h-full w-full flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-left hover:border-brand">
                <span className="flex items-center gap-2 font-medium"><ClipboardList size={18} className="shrink-0 text-brand" /> <span className="truncate">{f.title}</span></span>
                <span className="flex items-center gap-2 text-xs">
                  <span className={clsx('rounded-full px-2 py-0.5', f.status === 'open' ? 'bg-success/15 text-success' : f.status === 'closed' ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-muted')}>{STATUS_LABEL[f.status]}</span>
                  <span className="text-muted">{f.responseCount} response{f.responseCount === 1 ? '' : 's'}</span>
                </span>
                <span className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted">
                  {f.channel ? <Hash size={12} aria-hidden /> : <User size={12} aria-hidden />}
                  <span className="truncate">{f.channel ? `${f.channel.teamName} › ${f.channel.name}` : 'Personal'}</span> · {formatListTime(f.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {creating && <NewFormDialog onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), router.push(`/forms?form=${id}`))} />}
    </section>
  );
}
