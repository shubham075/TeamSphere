'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FileNoAccessInfo } from '@teamsphere/shared';
import { PreviewDialog } from '@/components/files/dialogs';
import { ApiError } from '@/lib/api';
import { fetchDetail, filesApi, fk } from '@/lib/files';

/** Deep link to a file or folder (`/files/item/<id>`): opens it, or offers "Request access". */
export default function FileItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, isLoading } = useQuery({ queryKey: fk.detail(id), queryFn: () => fetchDetail(id), retry: false });

  useEffect(() => {
    if (data?.kind === 'folder') router.replace(`/files?folder=${data.id}`);
  }, [data, router]);

  const noAccess = error instanceof ApiError && error.status === 403 ? (error.body as FileNoAccessInfo) : null;
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      {isLoading && <Loader2 className="animate-spin text-muted" />}
      {noAccess && <RequestAccess id={id} pending={noAccess.pendingRequest} />}
      {error && !noAccess && (
        <>
          <h1 className="text-xl font-semibold">This item isn’t available</h1>
          <p className="text-sm text-muted">{error instanceof ApiError ? error.message : 'It may have been deleted.'}</p>
          <Link href="/files" className="text-sm text-brand hover:underline">Go to My files</Link>
        </>
      )}
      {data?.kind === 'file' && <PreviewDialog detail={data} onClose={() => router.push(data.breadcrumbs.length > 1 ? `/files?folder=${data.breadcrumbs.at(-1)!.id}` : data.role === 'owner' ? '/files' : '/files?view=shared')} />}
    </section>
  );
}

function RequestAccess({ id, pending }: { id: string; pending: boolean }) {
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(pending);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    try {
      await filesApi.requestAccess(id, role, message.trim() || undefined);
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the request');
    }
  }
  return (
    <div className="w-full max-w-sm space-y-3">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Lock size={28} /></span>
      <h1 className="text-xl font-semibold">You need permission</h1>
      {sent ? (
        <p className="text-sm text-muted">Your request has been sent. You’ll get an Activity notification when the owner responds.</p>
      ) : (
        <>
          <p className="text-sm text-muted">Ask the owner for access to this item.</p>
          <select value={role} onChange={(e) => setRole(e.target.value as 'view' | 'edit')} aria-label="Access level" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
            <option value="view">Request to view</option>
            <option value="edit">Request to edit</option>
          </select>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Add a message (optional)" aria-label="Message" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" rows={3} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button onClick={send} className="w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover">Request access</button>
        </>
      )}
    </div>
  );
}
