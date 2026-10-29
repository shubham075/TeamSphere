'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plus, Settings2, Star, Trash2, Video, Voicemail, X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { CallHistoryItem, CallSettingsInfo, ForwardMode, SpeedDialEntry, VoicemailInfo } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { DeviceSettings } from '@/components/calls/device-settings';
import { PeoplePicker } from '@/components/calls/people-picker';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useCallStore } from '@/lib/call-store';
import {
  callQk, callTitle, formatCallDuration, otherCallUsers, useCallHistory, useCallSettings, useSpeedDial, useVoicemails,
} from '@/lib/calls';
import { formatListTime } from '@/lib/chat';

export default function CallsPage() {
  return (
    <Suspense>
      <Calls />
    </Suspense>
  );
}

function Calls() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'voicemail' ? 'voicemail' : 'history';
  const [dialog, setDialog] = useState<'none' | 'call' | 'devices'>('none');
  const { data: voicemails } = useVoicemails();
  const unheard = voicemails?.filter((v) => !v.listened).length ?? 0;

  return (
    <>
      <aside className="flex w-96 shrink-0 flex-col border-r border-border bg-surface max-md:w-full">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <h1 className="flex-1 text-xl font-semibold">Calls</h1>
          <button onClick={() => setDialog('devices')} title="Device settings and test call" aria-label="Device settings and test call" className="rounded p-2 text-muted hover:bg-surface-hover">
            <Settings2 size={18} />
          </button>
          <button onClick={() => setDialog('call')} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-hover">
            <PhoneCall size={15} /> Make a call
          </button>
        </div>
        <div role="tablist" aria-label="Calls" className="flex gap-1 border-b border-border px-3">
          {(['history', 'voicemail'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => router.replace(t === 'history' ? '/calls' : '/calls?tab=voicemail')}
              className={clsx('border-b-2 px-3 py-2 text-sm', tab === t ? 'border-brand font-semibold' : 'border-transparent text-muted hover:text-text')}
            >
              {t === 'history' ? 'History' : `Voicemail${unheard ? ` (${unheard})` : ''}`}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {tab === 'history' ? <History /> : <Voicemails list={voicemails} />}
        </div>
      </aside>
      <section className="flex-1 space-y-8 overflow-y-auto p-6 max-md:hidden">
        <SpeedDial />
        <Forwarding />
      </section>
      {dialog === 'devices' && <DeviceSettings onClose={() => setDialog('none')} />}
      {dialog === 'call' && (
        <PeoplePicker
          title="Make a call"
          action="Call"
          exclude={[useAuth.getState().user?.id ?? '']}
          onPick={([u]) => {
            setDialog('none');
            void useCallStore.getState().start({ userId: u.id, kind: 'audio' });
          }}
          onClose={() => setDialog('none')}
        />
      )}
    </>
  );
}

function History() {
  const meId = useAuth((s) => s.user?.id ?? '');
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useCallHistory();
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (!isLoading && !items.length) return <p className="px-4 py-10 text-center text-sm text-muted">No calls yet.</p>;
  return (
    <ul>
      {items.map((item) => (
        <HistoryRow key={item.call.id} item={item} meId={meId} />
      ))}
      {hasNextPage && (
        <li className="py-2 text-center">
          <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} className="text-sm text-brand hover:underline">
            {isFetchingNextPage ? 'Loading…' : 'Show older calls'}
          </button>
        </li>
      )}
    </ul>
  );
}

const DIRECTION = {
  outgoing: { icon: PhoneOutgoing, label: 'Outgoing' },
  incoming: { icon: PhoneIncoming, label: 'Incoming' },
  missed: { icon: PhoneMissed, label: 'Missed' },
} as const;

function HistoryRow({ item, meId }: { item: CallHistoryItem; meId: string }) {
  const { call, direction, durationSec } = item;
  const others = otherCallUsers(call, meId);
  const first = others[0];
  const { icon: Icon, label } = DIRECTION[direction];
  const missed = direction === 'missed';
  const callBack = (kind: 'audio' | 'video') =>
    void useCallStore.getState().start(call.conversationId ? { conversationId: call.conversationId, kind } : { userId: first.id, kind });

  return (
    <li className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
      <Avatar name={first?.displayName ?? 'Call'} src={others.length === 1 ? first?.avatarUrl : null} size={36} />
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-sm', missed && 'font-semibold text-danger')}>{callTitle(call, meId)}</span>
        <span className="flex items-center gap-1 text-xs text-muted">
          <Icon size={12} aria-hidden="true" />
          {label} {call.kind === 'video' ? 'video' : 'audio'} call
          {durationSec > 0 && ` · ${formatCallDuration(durationSec)}`}
        </span>
      </span>
      <span className="text-[11px] text-muted group-hover:hidden">{formatListTime(call.createdAt)}</span>
      <span className="hidden gap-1 group-focus-within:flex group-hover:flex">
        <button onClick={() => callBack('video')} aria-label={`Video call ${callTitle(call, meId)}`} title="Video call" className="rounded p-1.5 hover:bg-surface-2">
          <Video size={16} />
        </button>
        <button onClick={() => callBack('audio')} aria-label={`Call back ${callTitle(call, meId)}`} title="Call back" className="rounded p-1.5 hover:bg-surface-2">
          <PhoneCall size={16} />
        </button>
      </span>
    </li>
  );
}

function Voicemails({ list }: { list?: VoicemailInfo[] }) {
  const qc = useQueryClient();
  const listened = useMutation({
    mutationFn: (id: string) => api<VoicemailInfo>(`/voicemails/${id}/listened`, { method: 'POST' }),
    onSuccess: (v) => qc.setQueryData<VoicemailInfo[]>(callQk.voicemails, (l) => l?.map((x) => (x.id === v.id ? v : x))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/voicemails/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => qc.setQueryData<VoicemailInfo[]>(callQk.voicemails, (l) => l?.filter((x) => x.id !== id)),
  });
  if (list && !list.length) return <p className="px-4 py-10 text-center text-sm text-muted">No voicemails.</p>;
  return (
    <ul className="space-y-1">
      {list?.map((v) => (
        <li key={v.id} className={clsx('rounded-md px-2 py-2', !v.listened && 'bg-brand-soft/50')}>
          <div className="flex items-center gap-3">
            <Avatar name={v.from?.displayName ?? 'Unknown'} src={v.from?.avatarUrl} size={32} />
            <span className="min-w-0 flex-1">
              <span className={clsx('block truncate text-sm', !v.listened && 'font-semibold')}>{v.from?.displayName ?? 'Unknown caller'}</span>
              <span className="text-xs text-muted">
                <Voicemail size={12} className="mr-1 inline" aria-hidden="true" />
                {formatCallDuration(v.durationSec)} · {formatListTime(v.createdAt)}
              </span>
            </span>
            {v.from && (
              <button onClick={() => void useCallStore.getState().start({ userId: v.from!.id, kind: 'audio' })} aria-label={`Call ${v.from.displayName}`} title="Call back" className="rounded p-1.5 hover:bg-surface-hover">
                <PhoneCall size={16} />
              </button>
            )}
            <button
              onClick={() => confirm('Delete this voicemail?') && remove.mutate(v.id)}
              aria-label="Delete voicemail"
              title="Delete"
              className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <audio controls preload="none" src={v.url} onPlay={() => !v.listened && listened.mutate(v.id)} className="mt-2 h-9 w-full" aria-label={`Voicemail from ${v.from?.displayName ?? 'unknown caller'}`} />
        </li>
      ))}
    </ul>
  );
}

function SpeedDial() {
  const qc = useQueryClient();
  const { data } = useSpeedDial();
  const [picking, setPicking] = useState(false);
  const set = (list: SpeedDialEntry[]) => qc.setQueryData(callQk.speedDial, list);
  const add = useMutation({ mutationFn: (id: string) => api<SpeedDialEntry[]>(`/calls/speed-dial/${id}`, { method: 'PUT' }), onSuccess: set });
  const remove = useMutation({ mutationFn: (id: string) => api<SpeedDialEntry[]>(`/calls/speed-dial/${id}`, { method: 'DELETE' }), onSuccess: set });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Star size={18} className="text-brand" aria-hidden="true" />
        <h2 className="flex-1 text-lg font-semibold">Speed dial</h2>
        <button onClick={() => setPicking(true)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
          <Plus size={15} /> Add
        </button>
      </div>
      {data && !data.length && <p className="text-sm text-muted">Add the people you call most for one-click calling.</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        {data?.map((e) => (
          <li key={e.user.id} className="group relative flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-4 text-center">
            <button onClick={() => remove.mutate(e.user.id)} aria-label={`Remove ${e.user.displayName} from speed dial`} className="absolute top-1 right-1 hidden rounded p-1 text-muted group-focus-within:block group-hover:block hover:bg-surface-hover">
              <X size={14} />
            </button>
            <Avatar name={e.user.displayName} src={e.user.avatarUrl} size={48} />
            <span className="w-full truncate text-sm font-medium">{e.user.displayName}</span>
            {e.user.jobTitle && <span className="-mt-2 w-full truncate text-xs text-muted">{e.user.jobTitle}</span>}
            <span className="flex gap-1">
              <button onClick={() => void useCallStore.getState().start({ userId: e.user.id, kind: 'video' })} aria-label={`Video call ${e.user.displayName}`} title="Video call" className="rounded-full bg-surface-2 p-2 hover:bg-surface-hover">
                <Video size={15} />
              </button>
              <button onClick={() => void useCallStore.getState().start({ userId: e.user.id, kind: 'audio' })} aria-label={`Call ${e.user.displayName}`} title="Call" className="rounded-full bg-surface-2 p-2 hover:bg-surface-hover">
                <PhoneCall size={15} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {picking && (
        <PeoplePicker
          title="Add to speed dial"
          action="Add"
          exclude={[useAuth.getState().user?.id ?? '', ...(data?.map((e) => e.user.id) ?? [])]}
          onPick={([u]) => {
            setPicking(false);
            add.mutate(u.id);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Forwarding() {
  const qc = useQueryClient();
  const { data } = useCallSettings();
  const [picking, setPicking] = useState<'forwardTo' | 'alsoRing' | null>(null);
  const save = useMutation({
    mutationFn: (input: { forwardMode: ForwardMode; forwardToId: string | null; alsoRingId: string | null }) =>
      api<CallSettingsInfo>('/calls/settings', { method: 'PUT', json: input }),
    onSuccess: (s) => qc.setQueryData(callQk.settings, s),
  });
  if (!data) return null;
  const current = { forwardMode: data.forwardMode, forwardToId: data.forwardTo?.id ?? null, alsoRingId: data.alsoRing?.id ?? null };

  const option = (mode: ForwardMode, label: string, extra?: React.ReactNode) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name="forward"
        checked={data.forwardMode === mode}
        onChange={() => (mode === 'user' && !data.forwardTo ? setPicking('forwardTo') : save.mutate({ ...current, forwardMode: mode }))}
        className="mt-0.5 accent-brand"
      />
      <span>
        {label}
        {extra}
      </span>
    </label>
  );

  return (
    <div className="max-w-lg">
      <h2 className="mb-3 text-lg font-semibold">Call handling</h2>
      <fieldset className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-medium">When someone calls me</legend>
        {option(
          'off',
          'Ring me',
          <span className="mt-1 block text-xs text-muted">
            Also ring:{' '}
            {data.alsoRing ? (
              <>
                <strong>{data.alsoRing.displayName}</strong>{' '}
                <button onClick={() => save.mutate({ ...current, forwardMode: 'off', alsoRingId: null })} className="text-brand hover:underline">
                  remove
                </button>
              </>
            ) : (
              <button onClick={() => setPicking('alsoRing')} className="text-brand hover:underline">
                choose someone
              </button>
            )}
          </span>,
        )}
        {option(
          'user',
          'Forward to ',
          <>
            <strong>{data.forwardTo?.displayName ?? 'someone'}</strong>{' '}
            <button onClick={() => setPicking('forwardTo')} className="text-brand hover:underline">
              change
            </button>
          </>,
        )}
        {option('voicemail', 'Send calls straight to voicemail')}
        <p className="text-xs text-muted">Unanswered calls ring for 30 seconds, then callers can leave a voicemail. Do not disturb rejects calls.</p>
        {save.error && <p className="text-sm text-danger">{save.error instanceof ApiError ? save.error.message : 'Could not save'}</p>}
      </fieldset>
      {picking && (
        <PeoplePicker
          title={picking === 'forwardTo' ? 'Forward my calls to' : 'Also ring'}
          action="Choose"
          exclude={[useAuth.getState().user?.id ?? '']}
          onPick={([u]) => {
            setPicking(null);
            save.mutate(picking === 'forwardTo' ? { ...current, forwardMode: 'user', forwardToId: u.id } : { ...current, forwardMode: 'off', alsoRingId: u.id });
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
