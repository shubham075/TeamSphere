'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DiscoverTeam, TeamInfo } from '@teamsphere/shared';
import { CreateTeamDialog } from '@/components/teams/dialogs';
import { errorText, inputClass, primaryButton, secondaryButton, TeamAvatar } from '@/components/teams/ui';
import { api } from '@/lib/api';
import { upsertTeam } from '@/lib/teams';

export default function DiscoverTeamsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: teams, isLoading } = useQuery({ queryKey: ['teams-discover', q], queryFn: () => api<DiscoverTeam[]>(`/teams/discover?q=${encodeURIComponent(q)}`) });

  const opened = (t: TeamInfo) => {
    upsertTeam(qc, t);
    void qc.invalidateQueries({ queryKey: ['teams-discover'] });
    if (t.channels[0]) router.push(`/teams/c/${t.channels[0].id}`);
  };
  const join = useMutation({ mutationFn: (id: string) => api<TeamInfo>(`/teams/${id}/join`, { method: 'POST' }), onSuccess: opened });
  const joinCode = useMutation({ mutationFn: () => api<TeamInfo>('/teams/join-code', { method: 'POST', json: { code: code.trim() } }), onSuccess: opened });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-xl font-semibold">Join or create a team</h1>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><Plus size={16} /> Create a team</h2>
            <p className="mb-3 text-sm text-muted">Start from scratch or copy an existing team’s channels and settings.</p>
            <button onClick={() => setCreating(true)} className={primaryButton}>Create team</button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) joinCode.mutate();
            }}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><KeyRound size={16} /> Join with a code</h2>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter code" aria-label="Team code" className={inputClass} />
              <button disabled={!code.trim() || joinCode.isPending} className={secondaryButton}>Join</button>
            </div>
            {joinCode.error && <p className="mt-2 text-sm text-danger">{errorText(joinCode.error)}</p>}
          </form>
        </div>

        <div className="relative mb-3">
          <Search size={16} className="absolute top-2.5 left-3 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search public teams" aria-label="Search public teams" className={`${inputClass} pl-9`} />
        </div>
        {join.error && <p className="mb-2 text-sm text-danger">{errorText(join.error)}</p>}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams?.map((t) => (
            <li key={t.id} className="flex flex-col rounded-lg border border-border bg-surface p-4">
              <div className="mb-2 flex items-center gap-3">
                <TeamAvatar id={t.id} name={t.name} size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{t.name}</span>
                  <span className="block text-xs text-muted">{t.memberCount} {t.memberCount === 1 ? 'member' : 'members'}</span>
                </span>
              </div>
              <p className="mb-3 line-clamp-2 flex-1 text-sm text-muted">{t.description || 'No description'}</p>
              <button onClick={() => join.mutate(t.id)} disabled={join.isPending} className={secondaryButton}>Join team</button>
            </li>
          ))}
        </ul>
        {!isLoading && !teams?.length && <p className="py-6 text-center text-sm text-muted">No public teams to join{q ? ' match your search' : ''}.</p>}
      </div>
      {creating && <CreateTeamDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
