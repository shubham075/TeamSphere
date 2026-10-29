'use client';

import {
  isTrackReference, RoomAudioRenderer, RoomContext, TrackReference, TrackReferenceOrPlaceholder, useAudioPlayback,
  useConnectionQualityIndicator, useIsMuted, useIsSpeaking, useTracks, VideoTrack,
} from '@livekit/components-react';
import clsx from 'clsx';
import { ConnectionQuality, Participant, Track } from 'livekit-client';
import {
  ArrowRightLeft, Maximize2, Mic, MicOff, Minimize2, MonitorUp, MonitorX, Pause, PhoneOff, Play, Settings, Signal,
  UserPlus, Users, Video, VideoOff, Volume2, WifiOff, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CallInfo, CallParticipantInfo } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { useCallStore } from '@/lib/call-store';
import { callTitle, formatCallDuration, myParticipant } from '@/lib/calls';
import { DeviceSettings } from './device-settings';
import { PeoplePicker } from './people-picker';

/** The active call: full view over the app, or a small floating window when minimized. */
export function CallView({ meId }: { meId: string }) {
  const call = useCallStore((s) => s.call);
  const room = useCallStore((s) => s.room);
  const minimized = useCallStore((s) => s.minimized);
  if (!call || !room) return null;
  const me = myParticipant(call, meId);

  return (
    <RoomContext.Provider value={room}>
      <RoomAudioRenderer muted={!!me?.onHold} />
      {minimized ? <MiniCall call={call} meId={meId} /> : <FullCall call={call} meId={meId} />}
    </RoomContext.Provider>
  );
}

function useDuration(call: CallInfo) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return call.answeredAt ? formatCallDuration(Math.max(0, Math.floor((now - new Date(call.answeredAt).getTime()) / 1000))) : null;
}

function StatusLine({ call, meId }: { call: CallInfo; meId: string }) {
  const phase = useCallStore((s) => s.phase);
  const duration = useDuration(call);
  if (phase === 'reconnecting') return <span className="text-yellow-300">Reconnecting…</span>;
  if (phase === 'disconnected') return <span className="text-red-300">Disconnected</span>;
  if (phase === 'connecting') return <span>Connecting…</span>;
  if (call.status === 'ringing') {
    const ringing = call.participants.filter((p) => p.status === 'ringing' && p.user.id !== meId);
    return <span>Calling {ringing.map((p) => p.user.displayName).join(', ') || '…'}</span>;
  }
  return <span className="tabular-nums">{duration}</span>;
}

function QualityIcon() {
  const quality = useCallStore((s) => s.quality);
  const label = { [ConnectionQuality.Excellent]: 'Excellent', [ConnectionQuality.Good]: 'Good', [ConnectionQuality.Poor]: 'Poor', [ConnectionQuality.Lost]: 'Lost', [ConnectionQuality.Unknown]: 'Unknown' }[quality];
  const color = quality === ConnectionQuality.Poor ? 'text-yellow-300' : quality === ConnectionQuality.Lost ? 'text-red-400' : 'text-green-300';
  const Icon = quality === ConnectionQuality.Lost ? WifiOff : Signal;
  return (
    <span title={`Network quality: ${label}`} aria-label={`Network quality: ${label}`} role="img" className={clsx('flex items-center', color)}>
      <Icon size={16} />
    </span>
  );
}

function FullCall({ call, meId }: { call: CallInfo; meId: string }) {
  const s = useCallStore();
  const [panel, setPanel] = useState<'none' | 'people'>('none');
  const [dialog, setDialog] = useState<'none' | 'devices' | 'add' | 'transfer'>('none');
  const { canPlayAudio, startAudio } = useAudioPlayback();
  const me = myParticipant(call, meId);
  const onHold = !!me?.onHold;
  const heldBy = call.participants.filter((p) => p.onHold && p.user.id !== meId);
  const connected = call.participants.filter((p) => p.status === 'joined');
  const canTransfer = call.status === 'active' && connected.length === 2;
  const canEndForAll = call.conversationType === 'group' && !!me?.isCaller;
  const weak = s.quality === ConnectionQuality.Poor || s.quality === ConnectionQuality.Lost;

  // Escape minimizes (keeps the call going) so people can get back to chat quickly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog === 'none') s.setMinimized(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, s]);

  return (
    <div role="dialog" aria-modal="false" aria-label={`Call with ${callTitle(call, meId)}`} className="fixed inset-0 z-50 flex flex-col bg-[#14141c] text-white">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <h2 className="min-w-0 truncate font-semibold">{callTitle(call, meId)}</h2>
        <span className="text-sm text-white/70">
          <StatusLine call={call} meId={meId} />
        </span>
        <QualityIcon />
        <span className="flex-1" />
        <button onClick={() => setPanel(panel === 'people' ? 'none' : 'people')} aria-pressed={panel === 'people'} className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10">
          <Users size={16} /> {connected.length}
        </button>
        <button onClick={() => s.setMinimized(true)} aria-label="Minimize call" title="Minimize (Esc)" className="rounded p-1.5 hover:bg-white/10">
          <Minimize2 size={16} />
        </button>
      </header>

      {(s.phase === 'reconnecting' || s.phase === 'disconnected' || weak || !canPlayAudio || heldBy.length > 0 || onHold) && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-white/5 px-4 py-2 text-sm" role="status">
          {s.phase === 'reconnecting' && <span>Your connection dropped. Reconnecting…</span>}
          {s.phase === 'disconnected' && (
            <>
              <span>You were disconnected from the call.</span>
              <button onClick={() => void s.accept(call.id, { video: s.camOn })} className="rounded bg-brand px-3 py-1 font-semibold">
                Rejoin
              </button>
            </>
          )}
          {weak && s.phase === 'connected' && !s.audioOnly && (
            <>
              <span>Your network is weak.</span>
              <button onClick={() => s.setAudioOnly(true)} className="rounded bg-white/15 px-3 py-1 hover:bg-white/25">
                Switch to audio only
              </button>
            </>
          )}
          {s.audioOnly && (
            <>
              <span>Incoming video is paused to save bandwidth.</span>
              <button onClick={() => s.setAudioOnly(false)} className="rounded bg-white/15 px-3 py-1 hover:bg-white/25">
                Turn video back on
              </button>
            </>
          )}
          {!canPlayAudio && (
            <button onClick={() => void startAudio()} className="flex items-center gap-1 rounded bg-brand px-3 py-1 font-semibold">
              <Volume2 size={14} /> Click to hear the call
            </button>
          )}
          {onHold && <span>You put the call on hold.</span>}
          {heldBy.map((p) => (
            <span key={p.user.id}>{p.user.displayName} put the call on hold.</span>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Stage call={call} meId={meId} />
        {panel === 'people' && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/10 p-3" aria-label="People in the call">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">People</h3>
              <button onClick={() => setPanel('none')} aria-label="Close people" className="rounded p-1 hover:bg-white/10">
                <X size={16} />
              </button>
            </div>
            <ul className="space-y-1">
              {call.participants
                .filter((p) => p.status !== 'forwarded')
                .map((p) => (
                  <li key={p.user.id} className="flex items-center gap-2 py-1 text-sm">
                    <Avatar name={p.user.displayName} src={p.user.avatarUrl} size={28} />
                    <span className="min-w-0 flex-1 truncate">
                      {p.user.displayName}
                      {p.user.id === meId && <span className="text-white/60"> (You)</span>}
                    </span>
                    <span className="text-xs text-white/60">{participantLabel(p)}</span>
                  </li>
                ))}
            </ul>
            <button onClick={() => setDialog('add')} className="mt-3 flex items-center gap-2 text-sm text-brand hover:underline">
              <UserPlus size={15} /> Add people
            </button>
          </aside>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 py-3" aria-label="Call controls">
        <Control label={s.micOn ? 'Mute' : 'Unmute'} active={!s.micOn} onClick={() => void s.toggleMic()} disabled={onHold}>
          {s.micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </Control>
        <Control label={s.camOn ? 'Turn camera off' : 'Turn camera on'} active={!s.camOn} onClick={() => void s.toggleCamera()} disabled={onHold}>
          {s.camOn ? <Video size={20} /> : <VideoOff size={20} />}
        </Control>
        <Control label={s.screenOn ? 'Stop sharing' : 'Share screen'} active={s.screenOn} onClick={() => void s.toggleScreenShare()} disabled={onHold}>
          {s.screenOn ? <MonitorX size={20} /> : <MonitorUp size={20} />}
        </Control>
        <Control label="Add people" onClick={() => setDialog('add')}>
          <UserPlus size={20} />
        </Control>
        <Control label={onHold ? 'Resume' : 'Hold'} active={onHold} onClick={() => void s.setHold(!onHold)} disabled={call.status !== 'active'}>
          {onHold ? <Play size={20} /> : <Pause size={20} />}
        </Control>
        {canTransfer && (
          <Control label="Transfer" onClick={() => setDialog('transfer')}>
            <ArrowRightLeft size={20} />
          </Control>
        )}
        <Control label="Device settings" onClick={() => setDialog('devices')}>
          <Settings size={20} />
        </Control>
        <button onClick={() => void s.hangUp()} className="ml-2 flex h-12 items-center gap-2 rounded-full bg-danger px-5 font-semibold text-white hover:opacity-90">
          <PhoneOff size={20} /> Leave
        </button>
        {canEndForAll && (
          <button onClick={() => void s.endForEveryone()} className="h-12 rounded-full border border-danger px-4 text-sm text-red-300 hover:bg-danger/20">
            End for everyone
          </button>
        )}
      </footer>

      {s.error && <ErrorToast message={s.error} onClose={s.clearError} />}
      {dialog === 'devices' && <DeviceSettings onClose={() => setDialog('none')} />}
      {dialog === 'add' && (
        <PeoplePicker
          title="Add people to the call"
          action="Call"
          multiple
          exclude={call.participants.filter((p) => p.status === 'joined' || p.status === 'ringing').map((p) => p.user.id)}
          onPick={(users) => {
            setDialog('none');
            void s.invite(users.map((u) => u.id));
          }}
          onClose={() => setDialog('none')}
        />
      )}
      {dialog === 'transfer' && (
        <PeoplePicker
          title="Transfer call to"
          action="Transfer"
          exclude={connected.map((p) => p.user.id)}
          onPick={([u]) => {
            setDialog('none');
            void s.transfer(u.id);
          }}
          onClose={() => setDialog('none')}
        />
      )}
    </div>
  );
}

function participantLabel(p: CallParticipantInfo) {
  if (p.onHold) return 'On hold';
  switch (p.status) {
    case 'joined':
      return p.isCaller ? 'Organizer' : 'In call';
    case 'ringing':
      return 'Ringing…';
    case 'declined':
      return 'Declined';
    case 'busy':
      return 'Busy';
    case 'missed':
      return 'No answer';
    default:
      return 'Left';
  }
}

function Control({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        'flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:opacity-40',
        active ? 'bg-white text-[#14141c]' : 'bg-white/10 hover:bg-white/20',
      )}
    >
      {children}
    </button>
  );
}

/** Video grid; a screen share takes the main area with people in a strip beside it. */
function Stage({ call, meId }: { call: CallInfo; meId: string }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const screens = tracks.filter((t): t is TrackReference => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);
  const users = useMemo(() => new Map(call.participants.map((p) => [p.user.id, p])), [call.participants]);
  const inRoom = new Set(cameras.map((t) => t.participant.identity));
  // People being rung show as placeholder tiles until they connect.
  const ringing = call.participants.filter((p) => p.status === 'ringing' && !inRoom.has(p.user.id));
  const count = cameras.length + ringing.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;

  const grid = (
    <div className="grid h-full w-full gap-2 p-2" style={{ gridTemplateColumns: `repeat(${screens.length ? 1 : cols}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
      {cameras.map((t) => (
        <Tile key={t.participant.identity} trackRef={t} info={users.get(t.participant.identity)} isMe={t.participant.identity === meId} />
      ))}
      {ringing.map((p) => (
        <div key={p.user.id} className="flex flex-col items-center justify-center gap-2 rounded-lg bg-white/5">
          <span className="animate-pulse">
            <Avatar name={p.user.displayName} src={p.user.avatarUrl} size={64} />
          </span>
          <span className="text-sm text-white/70">Ringing {p.user.displayName}…</span>
        </div>
      ))}
    </div>
  );

  if (!screens.length) return <div className="min-w-0 flex-1">{grid}</div>;
  return (
    <div className="flex min-w-0 flex-1 max-md:flex-col">
      <div className="relative min-h-0 min-w-0 flex-1 p-2">
        {screens.slice(0, 1).map((t) => (
          <div key={t.participant.identity} className="relative h-full overflow-hidden rounded-lg bg-black">
            <VideoTrack trackRef={t} className="h-full w-full object-contain" />
            <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">
              {(t.participant.identity === meId ? 'You are' : `${t.participant.name} is`) + ' presenting'}
            </span>
          </div>
        ))}
      </div>
      <div className="w-60 shrink-0 overflow-y-auto max-md:h-40 max-md:w-full">{grid}</div>
    </div>
  );
}

function Tile({ trackRef, info, isMe }: { trackRef: TrackReferenceOrPlaceholder; info?: CallParticipantInfo; isMe: boolean }) {
  const participant: Participant = trackRef.participant;
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const camMuted = useIsMuted(trackRef);
  const { quality } = useConnectionQualityIndicator({ participant });
  const name = info?.user.displayName ?? participant.name ?? participant.identity;
  const showVideo = isTrackReference(trackRef) && !camMuted && !info?.onHold;

  return (
    <div className={clsx('relative min-h-24 overflow-hidden rounded-lg bg-white/5 ring-2 transition-shadow', speaking && !micMuted ? 'ring-brand' : 'ring-transparent')}>
      {showVideo ? (
        <VideoTrack trackRef={trackRef} className={clsx('h-full w-full object-cover', isMe && '-scale-x-100')} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Avatar name={name} src={info?.user.avatarUrl} size={72} />
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[90%] items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs">
        {micMuted && <MicOff size={12} aria-label="Muted" />}
        <span className="truncate">
          {name}
          {isMe && ' (You)'}
        </span>
        {info?.onHold && <span className="text-yellow-300">· On hold</span>}
        {quality === ConnectionQuality.Poor && <Signal size={12} className="text-yellow-300" aria-label="Weak connection" />}
      </span>
    </div>
  );
}

function MiniCall({ call, meId }: { call: CallInfo; meId: string }) {
  const s = useCallStore();
  return (
    <div role="region" aria-label="Ongoing call" className="fixed right-4 bottom-4 z-50 w-72 rounded-xl bg-[#14141c] p-3 text-white shadow-2xl">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{callTitle(call, meId)}</span>
          <span className="block text-xs text-white/70">
            <StatusLine call={call} meId={meId} />
          </span>
        </span>
        <QualityIcon />
        <button onClick={() => s.setMinimized(false)} aria-label="Open call" title="Open call" className="rounded p-1.5 hover:bg-white/10">
          <Maximize2 size={16} />
        </button>
      </div>
      <div className="mt-3 flex justify-center gap-2">
        <Control label={s.micOn ? 'Mute' : 'Unmute'} active={!s.micOn} onClick={() => void s.toggleMic()}>
          {s.micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </Control>
        <Control label={s.camOn ? 'Turn camera off' : 'Turn camera on'} active={!s.camOn} onClick={() => void s.toggleCamera()}>
          {s.camOn ? <Video size={18} /> : <VideoOff size={18} />}
        </Control>
        <button onClick={() => void s.hangUp()} aria-label="Leave call" title="Leave call" className="flex h-12 w-12 items-center justify-center rounded-full bg-danger hover:opacity-90">
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}

export function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div role="alert" className="fixed bottom-24 left-1/2 z-[80] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-xl">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 hover:bg-white/20">
        <X size={14} />
      </button>
    </div>
  );
}
