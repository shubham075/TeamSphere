'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditPage, PublicUser } from '@teamsphere/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { formatDateTime } from '@/lib/i18n';
import { Btn, ErrorText, Input, Panel, Select } from './ui';

const ACTION_PREFIXES = ['', 'auth.', 'admin.', 'team.', 'channel.', 'file.', 'meeting.', 'call.'];

/** Filterable audit log with CSV export of the current filters. */
export function AdminAudit() {
  const [actorTerm, setActorTerm] = useState('');
  const [actor, setActor] = useState<PublicUser | null>(null);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const params = new URLSearchParams();
  if (actor) params.set('actorId', actor.id);
  if (action) params.set('action', action);
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
    queryKey: ['admin', 'audit', params.toString()],
    queryFn: ({ pageParam }) => api<AuditPage>(`/admin/audit?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const { data: people } = useQuery({ queryKey: ['users', actorTerm], queryFn: () => api<PublicUser[]>(`/users?q=${encodeURIComponent(actorTerm)}&take=5&includeInactive=1`), enabled: actorTerm.length >= 2 });

  // The CSV needs the bearer token, so fetch it and save the blob rather than linking to it.
  const exportCsv = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit.csv?${params}`, {
        headers: { authorization: `Bearer ${useAuth.getState().accessToken}`, 'x-teamsphere': '1' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e);
    }
  };

  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <Panel title="Audit log" actions={<Btn onClick={exportCsv}>Export CSV</Btn>}>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <div className="relative">
          <span className="mb-1 block text-muted">Actor</span>
          {actor ? (
            <Btn onClick={() => setActor(null)} aria-label="Clear actor filter">{actor.displayName} ×</Btn>
          ) : (
            <Input value={actorTerm} onChange={(e) => setActorTerm(e.target.value)} placeholder="Anyone" aria-label="Actor" />
          )}
          {!actor && actorTerm.length >= 2 && !!people?.length && (
            <div className="absolute z-10 mt-1 w-56 rounded border border-border bg-surface shadow">
              {people.map((p) => (
                <button key={p.id} onClick={() => { setActor(p); setActorTerm(''); }} className="block w-full px-2 py-1 text-left hover:bg-surface-hover">
                  {p.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
        <label>
          <span className="mb-1 block text-muted">Action</span>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTION_PREFIXES.map((a) => (
              <option key={a} value={a}>{a ? `${a}*` : 'All actions'}</option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-muted">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="mb-1 block text-muted">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorText error={error} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-2 font-medium">Time</th>
            <th className="font-medium">Actor</th>
            <th className="font-medium">Action</th>
            <th className="font-medium">Target</th>
            <th className="font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</td>
              <td className="pr-2">{r.actor?.displayName ?? <span className="text-muted">system</span>}</td>
              <td className="pr-2 font-mono text-xs">{r.action}</td>
              <td className="pr-2 text-xs text-muted">{r.targetType ? `${r.targetType}:${r.targetId ?? ''}` : ''}</td>
              <td className="max-w-xs truncate font-mono text-xs text-muted" title={r.meta ? JSON.stringify(r.meta) : ''}>
                {r.meta ? JSON.stringify(r.meta) : ''}
                {r.ip ? ` ${r.ip}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !isFetching && <p className="py-4 text-sm text-muted">No entries match.</p>}
      {hasNextPage && (
        <Btn className="mt-3" onClick={() => fetchNextPage()} disabled={isFetching}>
          Load more
        </Btn>
      )}
    </Panel>
  );
}
