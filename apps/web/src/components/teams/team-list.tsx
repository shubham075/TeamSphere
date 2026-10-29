'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, MoreHorizontal, Pin, PinOff, Plus, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import type { ChannelInfo, TeamInfo } from '@teamsphere/shared';
import { api } from '@/lib/api';
import { tk, upsertChannel, upsertTeam, useTeams } from '@/lib/teams';
import { useDismiss } from '@/lib/use-dismiss';
import { CreateChannelDialog, CreateTeamDialog } from './dialogs';
import { ChannelIcon, TeamAvatar } from './ui';

function ChannelRow({ channel, active, indent = true }: { channel: ChannelInfo; active: boolean; indent?: boolean }) {
  const qc = useQueryClient();
  const bold = channel.unread > 0 && !channel.muted;
  return (
    <li className="group relative">
      <Link
        href={`/teams/c/${channel.id}`}
        aria-current={active ? 'page' : undefined}
        className={clsx('flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm', indent ? 'pl-10' : 'pl-3', active ? 'bg-brand-soft' : 'hover:bg-surface-hover', bold && 'font-semibold')}
      >
        <ChannelIcon type={channel.type} className="text-muted" />
        <span className={clsx('min-w-0 flex-1 truncate', channel.archivedAt && 'text-muted italic')}>{channel.name}</span>
        {channel.archivedAt && <Archive size={12} className="text-muted" aria-label="Archived" />}
        {channel.unreadMentions > 0 ? (
          <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white" aria-label={`${channel.unreadMentions} mentions`}>@{channel.unreadMentions}</span>
        ) : (
          bold && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white" aria-label={`${channel.unread} unread`}>{channel.unread > 99 ? '99+' : channel.unread}</span>
        )}
      </Link>
      <button
        onClick={() => api<ChannelInfo>(`/channels/${channel.id}/me`, { method: 'PATCH', json: { pinned: !channel.pinned } }).then((c) => upsertChannel(qc, c))}
        aria-label={channel.pinned ? `Unpin ${channel.name}` : `Pin ${channel.name}`}
        title={channel.pinned ? 'Unpin' : 'Pin'}
        className="absolute top-1.5 right-8 hidden rounded p-0.5 text-muted group-hover:block group-focus-within:block hover:bg-surface"
      >
        {channel.pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
    </li>
  );
}

function TeamMenu({ team, index, order, onAddChannel }: { team: TeamInfo; index: number; order: string[]; onAddChannel: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const move = useMutation({
    mutationFn: (dir: -1 | 1) => {
      const next = [...order];
      const [id] = next.splice(index, 1);
      next.splice(index + dir, 0, id);
      return api('/teams/order', { method: 'PUT', json: { teamIds: next } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: tk.teams }),
  });
  const hide = useMutation({
    mutationFn: () => api<TeamInfo>(`/teams/${team.id}/me`, { method: 'PATCH', json: { hidden: !team.hidden } }),
    onSuccess: (t) => upsertTeam(qc, t),
  });
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover disabled:opacity-40';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`${team.name} options`} aria-expanded={open} className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface">
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div role="menu" className="absolute top-7 right-0 z-30 w-48 rounded-md border border-border bg-surface py-1 text-sm shadow-lg" onClick={() => setOpen(false)}>
          {team.myRole && (
            <Link role="menuitem" href={`/teams/t/${team.id}`} className={item}>
              <Settings size={14} /> Manage team
            </Link>
          )}
          {team.myRole && !team.archivedAt && (
            <button role="menuitem" onClick={onAddChannel} className={item}>
              <Plus size={14} /> Add channel
            </button>
          )}
          {team.myRole && (
            <>
              <button role="menuitem" disabled={index === 0} onClick={() => move.mutate(-1)} className={item}>
                <ArrowUp size={14} /> Move up
              </button>
              <button role="menuitem" disabled={index === order.length - 1} onClick={() => move.mutate(1)} className={item}>
                <ArrowDown size={14} /> Move down
              </button>
              <button role="menuitem" onClick={() => hide.mutate()} className={item}>
                {team.hidden ? <Eye size={14} /> : <EyeOff size={14} />} {team.hidden ? 'Show' : 'Hide'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamList() {
  const { data, isLoading } = useTeams();
  const { channelId } = useParams<{ channelId?: string }>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addChannelTo, setAddChannelTo] = useState<TeamInfo | null>(null);

  const teams = data ?? [];
  const visible = teams.filter((t) => !t.hidden);
  const hidden = teams.filter((t) => t.hidden);
  const order = teams.filter((t) => t.myRole).map((t) => t.id);
  const pinned = useMemo(() => teams.flatMap((t) => t.channels.filter((c) => c.pinned)), [teams]);

  const teamBlock = (t: TeamInfo) => {
    const isCollapsed = collapsed[t.id] ?? false;
    const unread = t.channels.some((c) => c.unread > 0 && !c.muted);
    return (
      <li key={t.id} className="mb-1">
        <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-surface-hover">
          <button onClick={() => setCollapsed({ ...collapsed, [t.id]: !isCollapsed })} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left">
            {isCollapsed ? <ChevronRight size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
            <TeamAvatar id={t.id} name={t.name} size={26} />
            <span className={clsx('min-w-0 flex-1 truncate text-sm', (unread && isCollapsed) || !t.myRole ? 'font-semibold' : 'font-medium', t.archivedAt && 'text-muted italic')}>
              {t.name}
            </span>
            {t.archivedAt && <Archive size={12} className="text-muted" aria-label="Archived team" />}
          </button>
          <TeamMenu team={t} index={order.indexOf(t.id)} order={order} onAddChannel={() => setAddChannelTo(t)} />
        </div>
        {!isCollapsed && (
          <ul>
            {t.channels.map((c) => (
              <ChannelRow key={c.id} channel={c} active={c.id === channelId} />
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface max-md:w-full">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h1 className="flex-1 text-xl font-semibold">Teams</h1>
        <Link href="/teams/discover" title="Join or discover teams" aria-label="Join or discover teams" className="rounded p-2 text-muted hover:bg-surface-hover">
          <Users size={18} />
        </Link>
        <button onClick={() => setCreating(true)} title="Create a team" aria-label="Create a team" className="rounded p-2 text-muted hover:bg-surface-hover">
          <Plus size={18} />
        </button>
      </div>
      <nav aria-label="Teams and channels" className="flex-1 overflow-y-auto px-2 pb-3">
        {pinned.length > 0 && (
          <>
            <h2 className="px-2 pt-1 pb-1 text-xs font-semibold text-muted">Pinned</h2>
            <ul className="mb-2">
              {pinned.map((c) => (
                <ChannelRow key={c.id} channel={c} active={c.id === channelId} indent={false} />
              ))}
            </ul>
          </>
        )}
        <h2 className="px-2 pt-1 pb-1 text-xs font-semibold text-muted">Your teams</h2>
        <ul>{visible.map(teamBlock)}</ul>
        {!isLoading && !teams.length && (
          <div className="px-3 py-8 text-center text-sm text-muted">
            You’re not in any teams yet.
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => setCreating(true)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-text">Create a team</button>
              <Link href="/teams/discover" className="rounded-md border border-border px-3 py-1.5 text-xs">Join a team</Link>
            </div>
          </div>
        )}
        {hidden.length > 0 && (
          <>
            <button onClick={() => setShowHidden((s) => !s)} aria-expanded={showHidden} className="mt-2 flex items-center gap-1 px-2 text-xs font-semibold text-muted">
              {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Hidden teams ({hidden.length})
            </button>
            {showHidden && <ul className="mt-1">{hidden.map(teamBlock)}</ul>}
          </>
        )}
      </nav>
      {creating && <CreateTeamDialog onClose={() => setCreating(false)} />}
      {addChannelTo && <CreateChannelDialog team={addChannelTo} onClose={() => setAddChannelTo(null)} />}
    </aside>
  );
}
