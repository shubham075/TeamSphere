'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ChannelInfo, ChannelModeration, ChannelType, PublicUser, TeamInfo, TeamVisibility } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { tk, upsertChannel, useChannelMembers, useCreateChannel, useCreateTeam, useTeamMembers, useTeams } from '@/lib/teams';
import { errorText, Field, inputClass, Modal, PeoplePicker, primaryButton, secondaryButton } from './ui';

export function CreateTeamDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const { data: teams } = useTeams();
  const create = useCreateTeam();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<TeamVisibility>('private');
  const [copyFrom, setCopyFrom] = useState('');
  const [copy, setCopy] = useState({ channels: true, settings: true, tags: false, members: false });
  const [people, setPeople] = useState<PublicUser[]>([]);
  const sources = (teams ?? []).filter((t) => t.myRole);

  const submit = () =>
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
        memberIds: people.map((p) => p.id),
        ...(copyFrom ? { copyFrom: { teamId: copyFrom, ...copy } } : {}),
      },
      { onSuccess: (t) => (onClose(), router.push(`/teams/c/${t.channels[0]?.id ?? ''}`)) },
    );

  return (
    <Modal
      title="Create a team"
      onClose={onClose}
      footer={
        <>
          {create.error && <p className="mr-auto text-sm text-danger">{errorText(create.error)}</p>}
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button onClick={submit} disabled={!name.trim() || create.isPending} className={primaryButton}>Create</button>
        </>
      }
    >
      <Field label="Start from">
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={inputClass}>
          <option value="">From scratch</option>
          {sources.map((t) => (
            <option key={t.id} value={t.id}>Copy of {t.name}</option>
          ))}
        </select>
      </Field>
      {copyFrom && (
        <fieldset className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="mb-1 font-medium">Copy</legend>
          {(['channels', 'settings', 'tags', 'members'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 capitalize">
              <input type="checkbox" className="accent-brand" checked={copy[k]} onChange={(e) => setCopy({ ...copy, [k]: e.target.checked })} /> {k}
            </label>
          ))}
        </fieldset>
      )}
      <Field label="Team name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
      </Field>
      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1024} className={inputClass} />
      </Field>
      <Field label="Privacy" hint={visibility === 'orgwide' ? 'Everyone in the organization is added automatically.' : visibility === 'public' ? 'Anyone can find and join this team.' : 'Only owners can add members (or share a join code).'}>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as TeamVisibility)} className={inputClass}>
          <option value="private">Private</option>
          <option value="public">Public</option>
          {isAdmin && <option value="orgwide">Org-wide</option>}
        </select>
      </Field>
      {visibility !== 'orgwide' && (
        <div className="text-sm">
          <p className="mb-1 font-medium">Add members</p>
          <PeoplePicker picked={people} onChange={setPeople} exclude={[useAuth.getState().user?.id ?? '']} />
        </div>
      )}
    </Modal>
  );
}

export function CreateChannelDialog({ team, onClose }: { team: TeamInfo; onClose: () => void }) {
  const router = useRouter();
  const create = useCreateChannel(team.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ChannelType>('standard');
  const [people, setPeople] = useState<PublicUser[]>([]);
  const owner = team.myRole === 'owner';
  const canPrivate = owner || (team.myRole === 'member' && team.settings.membersCanCreatePrivateChannels);

  return (
    <Modal
      title={`Create a channel in ${team.name}`}
      onClose={onClose}
      footer={
        <>
          {create.error && <p className="mr-auto text-sm text-danger">{errorText(create.error)}</p>}
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button
            onClick={() =>
              create.mutate(
                { name: name.trim(), description: description.trim() || null, type, memberIds: people.map((p) => p.id) },
                { onSuccess: (c) => (onClose(), router.push(`/teams/c/${c.id}`)) },
              )
            }
            disabled={!name.trim() || create.isPending}
            className={primaryButton}
          >
            Create
          </button>
        </>
      }
    >
      <Field label="Channel name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={inputClass} />
      </Field>
      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
      </Field>
      <Field
        label="Type"
        hint={
          type === 'standard'
            ? 'Everyone in the team can see and post.'
            : type === 'private'
              ? 'Only the people you add (from this team) can see it.'
              : 'People you add, including people outside this team, and whole teams you share it with.'
        }
      >
        <select value={type} onChange={(e) => setType(e.target.value as ChannelType)} className={inputClass}>
          <option value="standard">Standard</option>
          {canPrivate && <option value="private">Private</option>}
          {canPrivate && <option value="shared">Shared</option>}
        </select>
      </Field>
      {type !== 'standard' && <MemberPickerForChannel team={team} type={type} picked={people} onChange={setPeople} />}
    </Modal>
  );
}

function MemberPickerForChannel({ team, type, picked, onChange }: { team: TeamInfo; type: ChannelType; picked: PublicUser[]; onChange: (p: PublicUser[]) => void }) {
  const me = useAuth((s) => s.user?.id);
  const { data: members } = useTeamMembers(team.id);
  if (type === 'shared') return <PeoplePicker picked={picked} onChange={onChange} exclude={[me ?? '']} />;
  // Private channels draw from the team.
  return (
    <ul className="max-h-56 overflow-y-auto text-sm">
      {members
        ?.filter((m) => m.user.id !== me)
        .map((m) => {
          const on = picked.some((p) => p.id === m.user.id);
          return (
            <li key={m.user.id}>
              <label className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-hover">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={on}
                  onChange={() => onChange(on ? picked.filter((p) => p.id !== m.user.id) : [...picked, m.user as unknown as PublicUser])}
                />
                <Avatar name={m.user.displayName} src={m.user.avatarUrl} size={24} />
                {m.user.displayName}
              </label>
            </li>
          );
        })}
    </ul>
  );
}

/** Channel settings: details, moderation, members (private/shared), sharing with teams, archive/delete. */
export function ChannelSettingsDialog({ team, channel, onClose }: { team: TeamInfo; channel: ChannelInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const meId = useAuth((s) => s.user?.id);
  const manage = channel.permissions.manage;
  const [tab, setTab] = useState<'general' | 'moderation' | 'members'>('general');
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? '');
  const [moderation, setModeration] = useState<ChannelModeration>(channel.moderation);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [shareTeam, setShareTeam] = useState('');
  const { data: members } = useChannelMembers(channel.id);
  const { data: teams } = useTeams();
  const { data: teamMembers } = useTeamMembers(channel.sharedFrom ? channel.sharedFrom.teamId : channel.teamId);
  const { data: shares, refetch: refetchShares } = useQuery({
    queryKey: ['channel-shares', channel.id],
    queryFn: () => api<{ id: string; name: string }[]>(`/channels/${channel.id}/shares`),
    enabled: channel.type === 'shared',
  });

  const call = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: string; json?: unknown }) => api<unknown>(`/channels/${channel.id}${path}`, { method, json }),
    onSuccess: (res, v) => {
      if (res && typeof res === 'object' && 'conversationId' in res) upsertChannel(qc, res as ChannelInfo);
      if (v.path.startsWith('/members')) void qc.invalidateQueries({ queryKey: tk.channelMembers(channel.id) });
      if (v.path.startsWith('/shares')) void refetchShares();
    },
  });

  const tabs: [typeof tab, string][] = [
    ['general', 'General'],
    ['moderation', 'Moderation'],
    ...(channel.type !== 'standard' ? ([['members', 'Members']] as [typeof tab, string][]) : []),
  ];
  const ownedTeams = (teams ?? []).filter((t) => t.myRole === 'owner' && !shares?.some((s) => s.id === t.id));

  return (
    <Modal title={`${channel.name} settings`} onClose={onClose} wide footer={call.error ? <p className="mr-auto text-sm text-danger">{errorText(call.error)}</p> : undefined}>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 px-3 py-1.5 text-sm ${tab === id ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!manage || channel.isGeneral} className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!manage} rows={2} className={inputClass} />
          </Field>
          {manage && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => call.mutate({ path: '', method: 'PATCH', json: { name: name.trim(), description: description.trim() || null } })} className={primaryButton}>Save</button>
              {!channel.isGeneral && (
                <>
                  <button onClick={() => call.mutate({ path: channel.archivedAt ? '/unarchive' : '/archive', method: 'POST' })} className={secondaryButton}>
                    {channel.archivedAt ? 'Restore from archive' : 'Archive channel'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${channel.name}? Team owners can restore it for 30 days.`)) {
                        call.mutate({ path: '', method: 'DELETE' }, { onSuccess: () => (onClose(), router.replace('/teams'), void qc.invalidateQueries({ queryKey: tk.teams })) });
                      }
                    }}
                    className={`${secondaryButton} text-danger`}
                  >
                    Delete channel
                  </button>
                </>
              )}
            </div>
          )}
          {!manage && <p className="text-xs text-muted">Only channel or team owners can change these settings.</p>}
        </div>
      )}

      {tab === 'moderation' && (
        <div className="space-y-3 text-sm">
          <Field label="Who can start a new post">
            <select disabled={!manage} value={moderation.newPosts} onChange={(e) => setModeration({ ...moderation, newPosts: e.target.value as ChannelModeration['newPosts'] })} className={inputClass}>
              <option value="everyone">Everyone</option>
              <option value="moderators">Only owners and moderators</option>
            </select>
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand" disabled={!manage} checked={moderation.allowReplies} onChange={(e) => setModeration({ ...moderation, allowReplies: e.target.checked })} />
            Allow members to reply
          </label>
          <Field label="Who can use @team, @channel and @tag mentions">
            <select disabled={!manage} value={moderation.mentions} onChange={(e) => setModeration({ ...moderation, mentions: e.target.value as ChannelModeration['mentions'] })} className={inputClass}>
              <option value="everyone">Everyone</option>
              <option value="moderators">Only owners and moderators</option>
            </select>
          </Field>
          <div>
            <p className="mb-1 font-medium">Moderators</p>
            <ul className="max-h-40 overflow-y-auto">
              {(members ?? []).map((m) => (
                <li key={m.user.id}>
                  <label className="flex items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      disabled={!manage}
                      checked={moderation.moderatorIds.includes(m.user.id)}
                      onChange={(e) =>
                        setModeration({ ...moderation, moderatorIds: e.target.checked ? [...moderation.moderatorIds, m.user.id] : moderation.moderatorIds.filter((x) => x !== m.user.id) })
                      }
                    />
                    {m.user.displayName}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {manage && <button onClick={() => call.mutate({ path: '', method: 'PATCH', json: { moderation } })} className={primaryButton}>Save moderation</button>}
        </div>
      )}

      {tab === 'members' && (
        <div className="text-sm">
          <ul className="mb-4 max-h-56 overflow-y-auto">
            {(members ?? []).map((m) => (
              <li key={m.user.id} className="flex items-center gap-2 py-1">
                <Avatar name={m.user.displayName} src={m.user.avatarUrl} size={26} />
                <span className="flex-1 truncate">
                  {m.user.displayName}
                  {m.external && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] text-muted">External</span>}
                </span>
                <span className="text-xs text-muted capitalize">{m.role === 'team' ? 'via team' : m.role}</span>
                {manage && m.role !== 'team' && (
                  <button
                    onClick={() => call.mutate({ path: '/members', method: 'POST', json: { userIds: [m.user.id], role: m.role === 'owner' ? 'member' : 'owner' } })}
                    className="rounded px-1.5 text-xs text-brand hover:bg-surface-hover"
                  >
                    {m.role === 'owner' ? 'Make member' : 'Make owner'}
                  </button>
                )}
                {(manage || m.user.id === meId) && m.role !== 'team' && (
                  <button onClick={() => call.mutate({ path: `/members/${m.user.id}`, method: 'DELETE' })} className="rounded px-1.5 text-xs text-danger hover:bg-surface-hover">
                    {m.user.id === meId ? 'Leave' : 'Remove'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {manage && (
            <>
              <p className="mb-1 font-medium">Add people{channel.type === 'private' ? ' from the team' : ''}</p>
              {channel.type === 'private' ? (
                <select
                  value=""
                  onChange={(e) => e.target.value && call.mutate({ path: '/members', method: 'POST', json: { userIds: [e.target.value] } })}
                  className={inputClass}
                  aria-label="Add a team member"
                >
                  <option value="">Choose a team member…</option>
                  {teamMembers?.filter((t) => !members?.some((m) => m.user.id === t.user.id)).map((t) => (
                    <option key={t.user.id} value={t.user.id}>{t.user.displayName}</option>
                  ))}
                </select>
              ) : (
                <>
                  <PeoplePicker picked={people} onChange={setPeople} exclude={members?.map((m) => m.user.id)} />
                  <button disabled={!people.length} onClick={() => call.mutate({ path: '/members', method: 'POST', json: { userIds: people.map((p) => p.id) } }, { onSuccess: () => setPeople([]) })} className={`${primaryButton} mt-2`}>
                    Add {people.length || ''}
                  </button>
                </>
              )}
              {channel.type === 'shared' && (
                <div className="mt-4">
                  <p className="mb-1 font-medium">Shared with teams</p>
                  <ul className="mb-2">
                    {(shares ?? []).map((s) => (
                      <li key={s.id} className="flex items-center justify-between py-0.5">
                        {s.name}
                        <button onClick={() => call.mutate({ path: `/shares/${s.id}`, method: 'DELETE' })} className="text-xs text-danger">Stop sharing</button>
                      </li>
                    ))}
                    {!shares?.length && <li className="text-xs text-muted">Not shared with any team yet.</li>}
                  </ul>
                  <div className="flex gap-2">
                    <select value={shareTeam} onChange={(e) => setShareTeam(e.target.value)} className={inputClass} aria-label="Team to share with">
                      <option value="">Choose a team you own…</option>
                      {ownedTeams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button disabled={!shareTeam} onClick={() => call.mutate({ path: '/shares', method: 'POST', json: { teamId: shareTeam } }, { onSuccess: () => setShareTeam('') })} className={primaryButton}>
                      Share
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
