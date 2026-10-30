'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LOBBY_BYPASS, POLICY_TYPES } from '@teamsphere/shared';
import type { AdminTeamRow, PolicyInfo, PolicyType, PublicUser } from '@teamsphere/shared';
import { api } from '@/lib/api';
import { Badge, Btn, ErrorText, Input, Panel, Select, Toggle } from './ui';

/** Labels for each policy setting (keys match the shared policy schemas). */
const FIELDS: Record<PolicyType, { key: string; label: string; hint?: string }[]> = {
  messaging: [
    { key: 'allowEdit', label: 'Edit sent messages' },
    { key: 'allowDelete', label: 'Delete sent messages' },
    { key: 'allowUrgent', label: 'Send urgent messages', hint: 'Urgent messages re-notify every 2 minutes for 20 minutes.' },
    { key: 'linkPreviews', label: 'Link previews' },
  ],
  meeting: [
    { key: 'allowRecording', label: 'Record meetings' },
    { key: 'lobbyDefault', label: 'Who bypasses the lobby by default' },
  ],
  calling: [
    { key: 'allowCalls', label: 'Make calls' },
    { key: 'allowVideo', label: 'Video in calls', hint: 'Off: audio calls only.' },
  ],
  apps: [
    { key: 'files', label: 'Files app (uploads)' },
    { key: 'meetings', label: 'Calendar (schedule meetings)' },
    { key: 'calls', label: 'Calls app' },
  ],
};

const TYPE_LABELS: Record<PolicyType, string> = { messaging: 'Messaging', meeting: 'Meetings', calling: 'Calling', apps: 'Apps & features' };

/**
 * Policies per type. Precedence: assigned directly to a person › assigned to one of their teams (combined: the
 * strictest setting wins) › the org default › built-in defaults (everything allowed).
 */
export function AdminPolicies() {
  const qc = useQueryClient();
  const [type, setType] = useState<PolicyType>('messaging');
  const [name, setName] = useState('');
  const { data: policies } = useQuery({ queryKey: ['admin', 'policies'], queryFn: () => api<PolicyInfo[]>('/admin/policies') });
  const create = useMutation({
    mutationFn: () => api<PolicyInfo>('/admin/policies', { method: 'POST', json: { type, name } }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['admin', 'policies'] });
    },
  });
  return (
    <div className="space-y-6">
      <Panel title="Policies">
        <p className="mb-3 text-sm text-muted">
          A policy assigned to a person wins over their teams’ policies; several team policies combine (the strictest setting wins); otherwise the org default applies.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="flex gap-2"
        >
          <Select value={type} onChange={(e) => setType(e.target.value as PolicyType)} aria-label="Policy type">
            {POLICY_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </Select>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="New policy name" aria-label="New policy name" className="flex-1" />
          <Btn type="submit" variant="primary" disabled={create.isPending}>Create</Btn>
        </form>
        <ErrorText error={create.error} />
      </Panel>
      {POLICY_TYPES.map((t) => {
        const list = policies?.filter((p) => p.type === t) ?? [];
        return (
          <Panel key={t} title={TYPE_LABELS[t]}>
            {!list.length && <p className="text-sm text-muted">No policies; built-in defaults apply (everything allowed).</p>}
            <div className="space-y-4">
              {list.map((p) => (
                <PolicyEditor key={p.id} policy={p} />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function PolicyEditor({ policy }: { policy: PolicyInfo }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'policies'] });
  const update = useMutation({
    mutationFn: (settings: Record<string, unknown>) => api(`/admin/policies/${policy.id}`, { method: 'PATCH', json: { settings } }),
    onSuccess: invalidate,
  });
  const assign = useMutation({
    mutationFn: (input: { userIds: string[]; teamIds: string[]; isDefault?: boolean }) => api(`/admin/policies/${policy.id}/assignments`, { method: 'PUT', json: input }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: () => api(`/admin/policies/${policy.id}`, { method: 'DELETE' }), onSuccess: invalidate });
  const userIds = policy.users.map((u) => u.id);
  const teamIds = policy.teams.map((t) => t.id);

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 font-semibold">
          {policy.name} {policy.isDefault && <Badge tone="brand">Org default</Badge>}
        </h3>
        <Btn onClick={() => assign.mutate({ userIds, teamIds, isDefault: !policy.isDefault })}>{policy.isDefault ? 'Unset default' : 'Make org default'}</Btn>
        <Btn variant="danger" onClick={() => confirm(`Delete policy “${policy.name}”?`) && remove.mutate()}>Delete</Btn>
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {FIELDS[policy.type].map((f) =>
          f.key === 'lobbyDefault' ? (
            <label key={f.key} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="flex-1">{f.label}</span>
              <Select value={String(policy.settings[f.key])} onChange={(e) => update.mutate({ [f.key]: e.target.value })} aria-label={f.label}>
                {LOBBY_BYPASS.map((v) => (
                  <option key={v} value={v}>{v === 'invited' ? 'People who were invited' : v === 'everyone' ? 'Everyone in the org' : 'Only organizers'}</option>
                ))}
              </Select>
            </label>
          ) : (
            <Toggle key={f.key} label={f.label} hint={f.hint} checked={policy.settings[f.key] === true} onChange={(v) => update.mutate({ [f.key]: v })} />
          ),
        )}
      </div>
      <Assignments
        users={policy.users}
        teams={policy.teams}
        onChange={(u, t) => assign.mutate({ userIds: u, teamIds: t })}
      />
      <ErrorText error={update.error ?? assign.error ?? remove.error} />
    </div>
  );
}

function Assignments({ users, teams, onChange }: { users: { id: string; displayName: string }[]; teams: { id: string; name: string }[]; onChange: (userIds: string[], teamIds: string[]) => void }) {
  const [term, setTerm] = useState('');
  const { data: people } = useQuery({ queryKey: ['users', term], queryFn: () => api<PublicUser[]>(`/users?q=${encodeURIComponent(term)}&take=5`), enabled: term.length >= 2 });
  const { data: allTeams } = useQuery({ queryKey: ['admin', 'teams', term], queryFn: () => api<AdminTeamRow[]>(`/admin/teams?q=${encodeURIComponent(term)}`), enabled: term.length >= 2 });
  const userIds = users.map((u) => u.id);
  const teamIds = teams.map((t) => t.id);
  return (
    <div className="mt-3 border-t border-border pt-3 text-sm">
      <div className="mb-2 flex flex-wrap gap-1.5">
        <span className="text-muted">Assigned to:</span>
        {!users.length && !teams.length && <span className="text-muted">nobody</span>}
        {users.map((u) => (
          <Chip key={u.id} label={u.displayName} onRemove={() => onChange(userIds.filter((id) => id !== u.id), teamIds)} />
        ))}
        {teams.map((t) => (
          <Chip key={t.id} label={`Team: ${t.name}`} onRemove={() => onChange(userIds, teamIds.filter((id) => id !== t.id))} />
        ))}
      </div>
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Assign to a person or team…" aria-label="Assign to a person or team" className="w-full" />
      {term.length >= 2 && (
        <div className="mt-1 rounded border border-border">
          {people?.filter((p) => !userIds.includes(p.id)).map((p) => (
            <button key={p.id} onClick={() => { onChange([...userIds, p.id], teamIds); setTerm(''); }} className="block w-full px-2 py-1 text-left hover:bg-surface-hover">
              {p.displayName} <span className="text-xs text-muted">person</span>
            </button>
          ))}
          {allTeams?.filter((t) => !t.deletedAt && !teamIds.includes(t.id)).slice(0, 5).map((t) => (
            <button key={t.id} onClick={() => { onChange(userIds, [...teamIds, t.id]); setTerm(''); }} className="block w-full px-2 py-1 text-left hover:bg-surface-hover">
              {t.name} <span className="text-xs text-muted">team ({t.memberCount} members)</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5">
      {label}
      <button onClick={onRemove} aria-label={`Remove ${label}`} className="text-muted hover:text-text">×</button>
    </span>
  );
}
