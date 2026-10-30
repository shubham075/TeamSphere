'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminChannelRow, AdminTeamRow, PublicUser } from '@teamsphere/shared';
import { api } from '@/lib/api';
import { Badge, Btn, ErrorText, Input, Panel } from './ui';

type Action = 'archive' | 'unarchive' | 'delete' | 'restore';

/** Teams and channels: archive/restore/delete and team owners. */
export function AdminTeams() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data: teams } = useQuery({ queryKey: ['admin', 'teams', q], queryFn: () => api<AdminTeamRow[]>(`/admin/teams?q=${encodeURIComponent(q)}`) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => api(`/admin/teams/${id}/action`, { method: 'POST', json: { action } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'teams'] }),
  });
  const confirmDelete = (t: AdminTeamRow) => confirm(`Delete “${t.name}”? It can be restored for 30 days.`) && act.mutate({ id: t.id, action: 'delete' });

  return (
    <Panel title="Teams & channels">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams" aria-label="Search teams" className="mb-3 w-full" />
      <ErrorText error={act.error} />
      <ul className="divide-y divide-border">
        {teams?.map((t) => (
          <li key={t.id} className="py-2">
            <div className="flex items-center gap-2 text-sm">
              <button onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} className="min-w-0 flex-1 text-left">
                <span className="font-medium">{t.name}</span>{' '}
                <span className="text-xs text-muted">
                  {t.visibility} · {t.memberCount} members · {t.channelCount} channels · owners: {t.owners.map((o) => o.displayName).join(', ') || 'none'}
                </span>
              </button>
              {t.deletedAt && <Badge tone="danger">Deleted</Badge>}
              {t.archivedAt && !t.deletedAt && <Badge>Archived</Badge>}
              {t.deletedAt ? (
                <Btn onClick={() => act.mutate({ id: t.id, action: 'restore' })}>Restore</Btn>
              ) : (
                <>
                  <Btn onClick={() => act.mutate({ id: t.id, action: t.archivedAt ? 'unarchive' : 'archive' })}>{t.archivedAt ? 'Unarchive' : 'Archive'}</Btn>
                  <Btn variant="danger" onClick={() => confirmDelete(t)}>Delete</Btn>
                </>
              )}
            </div>
            {open === t.id && <TeamDetails team={t} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TeamDetails({ team }: { team: AdminTeamRow }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const { data: channels } = useQuery({ queryKey: ['admin', 'channels', team.id], queryFn: () => api<AdminChannelRow[]>(`/admin/teams/${team.id}/channels`) });
  const { data: people } = useQuery({ queryKey: ['users', term], queryFn: () => api<PublicUser[]>(`/users?q=${encodeURIComponent(term)}&take=6`), enabled: term.length >= 2 });
  const owner = useMutation({
    mutationFn: (input: { userId: string; owner: boolean }) => api(`/admin/teams/${team.id}/owner`, { method: 'PUT', json: input }),
    onSuccess: () => {
      setTerm('');
      void qc.invalidateQueries({ queryKey: ['admin', 'teams'] });
    },
  });
  const channel = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => api(`/admin/channels/${id}/action`, { method: 'POST', json: { action } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'channels', team.id] }),
  });
  return (
    <div className="mt-2 grid gap-4 rounded-md bg-surface-2 p-3 text-sm md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted uppercase">Owners</h3>
        <ul className="mb-2 space-y-1">
          {team.owners.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <span className="flex-1">{o.displayName}</span>
              <Btn onClick={() => owner.mutate({ userId: o.id, owner: false })} disabled={team.owners.length < 2}>Make member</Btn>
            </li>
          ))}
        </ul>
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Add an owner…" aria-label="Add an owner" className="w-full" />
        {term.length >= 2 &&
          people?.map((p) => (
            <button key={p.id} onClick={() => owner.mutate({ userId: p.id, owner: true })} className="block w-full px-2 py-1 text-left hover:bg-surface-hover">
              {p.displayName} <span className="text-xs text-muted">{p.username}</span>
            </button>
          ))}
        <ErrorText error={owner.error} />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted uppercase">Channels</h3>
        <ul className="space-y-1">
          {channels?.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1">
                {c.name} {c.type !== 'standard' && <Badge>{c.type}</Badge>} {c.archivedAt && <Badge>Archived</Badge>} {c.deletedAt && <Badge tone="danger">Deleted</Badge>}
              </span>
              {!c.isGeneral &&
                (c.deletedAt ? (
                  <Btn onClick={() => channel.mutate({ id: c.id, action: 'restore' })}>Restore</Btn>
                ) : (
                  <>
                    <Btn onClick={() => channel.mutate({ id: c.id, action: c.archivedAt ? 'unarchive' : 'archive' })}>{c.archivedAt ? 'Unarchive' : 'Archive'}</Btn>
                    <Btn variant="danger" onClick={() => confirm(`Delete #${c.name}?`) && channel.mutate({ id: c.id, action: 'delete' })}>Delete</Btn>
                  </>
                ))}
            </li>
          ))}
        </ul>
        <ErrorText error={channel.error} />
      </div>
    </div>
  );
}
