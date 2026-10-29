'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ChannelType, PublicUser, RecycledChannel, TagInfo, TeamInfo, TeamRole, TeamSettings } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { ChannelIcon, errorText, Field, inputClass, PeoplePicker, primaryButton, secondaryButton, TeamAvatar } from '@/components/teams/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { tk, upsertTeam, useTags, useTeamMembers, useTeams } from '@/lib/teams';

type Tab = 'members' | 'channels' | 'tags' | 'settings';

const PERMISSIONS: [keyof TeamSettings, string][] = [
  ['membersCanCreateChannels', 'Members can create standard channels'],
  ['membersCanCreatePrivateChannels', 'Members can create private and shared channels'],
  ['membersCanDeleteChannels', 'Members can manage and delete standard channels'],
  ['membersCanManageTags', 'Members can create and edit tags'],
  ['guestsCanCreateChannels', 'Guests can create standard channels'],
  ['allowTeamMentions', 'Allow @team mentions'],
  ['allowChannelMentions', 'Allow @channel mentions'],
  ['ownersCanDeleteMessages', 'Owners can delete any message'],
];

export default function ManageTeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { data: teams, isLoading } = useTeams();
  const team = teams?.find((t) => t.id === teamId);
  const [tab, setTab] = useState<Tab>('members');
  if (!team) return <div className="flex flex-1 items-center justify-center text-sm text-muted">{isLoading ? <Loader2 className="animate-spin" /> : 'Team not found.'}</div>;
  const owner = team.myRole === 'owner';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center gap-3">
          <TeamAvatar id={team.id} name={team.name} size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{team.name}</h1>
            <p className="text-sm text-muted capitalize">
              {team.visibility === 'orgwide' ? 'Org-wide' : team.visibility} team · {team.memberCount} members{team.archivedAt ? ' · Archived' : ''}
            </p>
          </div>
        </div>
        <div role="tablist" className="mb-4 flex gap-4 border-b border-border">
          {(['members', 'channels', 'tags', 'settings'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('border-b-2 pb-2 text-sm capitalize', tab === t ? 'border-brand font-semibold' : 'border-transparent text-muted')}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'members' && <MembersTab team={team} owner={owner} />}
        {tab === 'channels' && <ChannelsTab team={team} owner={owner} />}
        {tab === 'tags' && <TagsTab team={team} />}
        {tab === 'settings' && <SettingsTab team={team} owner={owner} />}
      </div>
    </div>
  );
}

function MembersTab({ team, owner }: { team: TeamInfo; owner: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const meId = useAuth((s) => s.user?.id);
  const { data: members } = useTeamMembers(team.id);
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const [role, setRole] = useState<TeamRole>('member');
  const call = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: string; json?: unknown }) => api(`/teams/${team.id}${path}`, { method, json }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tk.members(team.id) });
      void qc.invalidateQueries({ queryKey: tk.teams });
    },
  });

  return (
    <div className="text-sm">
      {owner && team.visibility !== 'orgwide' && (
        <div className="mb-5 rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 font-medium">Add members</p>
          <PeoplePicker picked={picked} onChange={setPicked} exclude={members?.map((m) => m.user.id)} />
          <div className="mt-2 flex gap-2">
            <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)} aria-label="Role" className="rounded-md border border-border bg-surface px-2 text-sm">
              <option value="member">Member</option>
              <option value="owner">Owner</option>
              <option value="guest">Guest</option>
            </select>
            <button disabled={!picked.length} onClick={() => call.mutate({ path: '/members', method: 'POST', json: { userIds: picked.map((p) => p.id), role } }, { onSuccess: () => setPicked([]) })} className={primaryButton}>
              Add {picked.length || ''}
            </button>
          </div>
        </div>
      )}
      {call.error && <p className="mb-2 text-danger">{errorText(call.error)}</p>}
      <table className="w-full">
        <thead className="text-left text-xs text-muted">
          <tr><th className="py-1 font-medium">Name</th><th className="py-1 font-medium">Role</th><th /></tr>
        </thead>
        <tbody>
          {members?.map((m) => (
            <tr key={m.user.id} className="border-t border-border">
              <td className="py-2">
                <span className="flex items-center gap-2"><Avatar name={m.user.displayName} src={m.user.avatarUrl} size={28} /> {m.user.displayName}</span>
              </td>
              <td>
                {owner ? (
                  <select value={m.role} onChange={(e) => call.mutate({ path: `/members/${m.user.id}`, method: 'PATCH', json: { role: e.target.value } })} aria-label={`Role for ${m.user.displayName}`} className="rounded border border-border bg-surface px-1 py-0.5">
                    <option value="owner">Owner</option>
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                ) : (
                  <span className="capitalize">{m.role}</span>
                )}
              </td>
              <td className="text-right">
                {(owner || m.user.id === meId) && team.visibility !== 'orgwide' && (
                  <button
                    onClick={() => {
                      const leaving = m.user.id === meId;
                      if (confirm(leaving ? `Leave ${team.name}?` : `Remove ${m.user.displayName} from ${team.name}?`)) {
                        call.mutate({ path: `/members/${m.user.id}`, method: 'DELETE' }, { onSuccess: () => leaving && router.replace('/teams') });
                      }
                    }}
                    className="rounded px-2 py-1 text-xs text-danger hover:bg-surface-hover"
                  >
                    {m.user.id === meId ? 'Leave' : 'Remove'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChannelsTab({ team, owner }: { team: TeamInfo; owner: boolean }) {
  const qc = useQueryClient();
  const { data: channels } = useQuery({
    queryKey: ['team-channels', team.id],
    queryFn: () => api<{ id: string; name: string; type: ChannelType; description: string | null; isGeneral: boolean; archivedAt: string | null; memberCount: number; canOpen: boolean }[]>(`/teams/${team.id}/channels`),
  });
  const { data: deleted, refetch } = useQuery({ queryKey: ['team-deleted-channels', team.id], queryFn: () => api<RecycledChannel[]>(`/teams/${team.id}/channels/deleted`), enabled: owner });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      void refetch();
      void qc.invalidateQueries({ queryKey: ['team-channels', team.id] });
      void qc.invalidateQueries({ queryKey: tk.teams });
    },
  });
  return (
    <div className="text-sm">
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {channels?.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-2">
            <ChannelIcon type={c.type} className="text-muted" />
            {c.canOpen ? <Link href={`/teams/c/${c.id}`} className="font-medium hover:underline">{c.name}</Link> : <span className="font-medium">{c.name}</span>}
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.description}</span>
            {c.archivedAt && <span className="rounded bg-surface-2 px-1.5 text-xs text-muted">Archived</span>}
            <span className="text-xs text-muted capitalize">{c.type}</span>
          </li>
        ))}
      </ul>
      {owner && (
        <>
          <h2 className="mt-6 mb-2 font-semibold">Deleted channels</h2>
          {!deleted?.length && <p className="text-muted">Nothing here. Deleted channels can be restored for 30 days.</p>}
          <ul>
            {deleted?.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1">
                <ChannelIcon type={c.type} className="text-muted" />
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-muted">Purged {new Date(c.purgeAt).toLocaleDateString()}</span>
                <button onClick={() => restore.mutate(c.id)} className="rounded px-2 py-1 text-xs text-brand hover:bg-surface-hover">Restore</button>
              </li>
            ))}
          </ul>
          {restore.error && <p className="text-danger">{errorText(restore.error)}</p>}
        </>
      )}
    </div>
  );
}

function TagsTab({ team }: { team: TeamInfo }) {
  const qc = useQueryClient();
  const { data: tags } = useTags(team.id);
  const { data: members } = useTeamMembers(team.id);
  const [name, setName] = useState('');
  const canManage = team.myRole === 'owner' || (team.myRole === 'member' && team.settings.membersCanManageTags);
  const call = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: string; json?: unknown }) => api<TagInfo[]>(path, { method, json }),
    onSuccess: (list) => qc.setQueryData(tk.tags(team.id), list),
  });
  return (
    <div className="text-sm">
      <p className="mb-3 text-muted">Tags let you @mention a group of people at once, e.g. @Designers.</p>
      {canManage && (
        <form onSubmit={(e) => (e.preventDefault(), name.trim() && call.mutate({ path: `/teams/${team.id}/tags`, method: 'POST', json: { name: name.trim() } }, { onSuccess: () => setName('') }))} className="mb-4 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name" aria-label="New tag name" maxLength={40} className={inputClass} />
          <button className={primaryButton} disabled={!name.trim()}>Create tag</button>
        </form>
      )}
      {call.error && <p className="mb-2 text-danger">{errorText(call.error)}</p>}
      <ul className="space-y-3">
        {tags?.map((t) => (
          <li key={t.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 flex items-center">
              <span className="flex-1 font-semibold">@{t.name}</span>
              {canManage && <button onClick={() => call.mutate({ path: `/tags/${t.id}`, method: 'DELETE' })} className="text-xs text-danger">Delete</button>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {members?.map((m) => (
                <label key={m.user.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    disabled={!canManage}
                    checked={t.memberIds.includes(m.user.id)}
                    onChange={(e) => call.mutate({ path: `/tags/${t.id}`, method: 'PATCH', json: { userIds: e.target.checked ? [...t.memberIds, m.user.id] : t.memberIds.filter((x) => x !== m.user.id) } })}
                  />
                  {m.user.displayName}
                </label>
              ))}
            </div>
          </li>
        ))}
        {!tags?.length && <li className="text-muted">No tags yet.</li>}
      </ul>
    </div>
  );
}

function SettingsTab({ team, owner }: { team: TeamInfo; owner: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? '');
  const [visibility, setVisibility] = useState(team.visibility);
  const [settings, setSettings] = useState(team.settings);
  const call = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: string; json?: unknown }) => api<TeamInfo | undefined>(`/teams/${team.id}${path}`, { method, json }),
    onSuccess: (t) => (t ? upsertTeam(qc, t) : void qc.invalidateQueries({ queryKey: tk.teams })),
  });
  if (!owner) return <p className="text-sm text-muted">Only team owners can change settings.</p>;
  return (
    <div className="max-w-xl text-sm">
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} /></Field>
      <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} /></Field>
      {team.visibility !== 'orgwide' && (
        <Field label="Privacy">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as TeamInfo['visibility'])} className={inputClass}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </Field>
      )}
      <fieldset className="mb-4 space-y-1.5">
        <legend className="mb-1 font-medium">Permissions</legend>
        {PERMISSIONS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand" checked={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} /> {label}
          </label>
        ))}
      </fieldset>
      <button
        onClick={() => call.mutate({ path: '', method: 'PATCH', json: { name: name.trim(), description: description.trim() || null, settings, ...(team.visibility !== 'orgwide' ? { visibility } : {}) } })}
        className={primaryButton}
      >
        Save changes
      </button>
      {call.error && <p className="mt-2 text-danger">{errorText(call.error)}</p>}

      <h2 className="mt-8 mb-2 font-semibold">Team code</h2>
      <p className="mb-2 text-muted">People with the code can join this team directly, even when it’s private.</p>
      <div className="flex items-center gap-2">
        {team.joinCode && <code className="rounded bg-surface-2 px-3 py-1.5 font-mono text-base tracking-widest">{team.joinCode}</code>}
        <button onClick={() => call.mutate({ path: '/join-code', method: 'PUT' })} className={secondaryButton}>{team.joinCode ? 'Reset' : 'Generate'}</button>
        {team.joinCode && <button onClick={() => call.mutate({ path: '/join-code', method: 'DELETE' })} className={secondaryButton}>Remove</button>}
      </div>

      <h2 className="mt-8 mb-2 font-semibold">Archive or delete</h2>
      <div className="flex gap-2">
        <button onClick={() => call.mutate({ path: team.archivedAt ? '/unarchive' : '/archive', method: 'POST' })} className={secondaryButton}>
          {team.archivedAt ? 'Restore from archive' : 'Archive team'}
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete ${team.name}? Owners can restore it for 30 days.`)) call.mutate({ path: '', method: 'DELETE' }, { onSuccess: () => router.replace('/teams') });
          }}
          className={`${secondaryButton} text-danger`}
        >
          Delete team
        </button>
      </div>
    </div>
  );
}
