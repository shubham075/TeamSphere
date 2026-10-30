'use client';

import {
  isTrackReference, RoomAudioRenderer, RoomContext, TrackReferenceOrPlaceholder, useDataChannel, useIsMuted, useIsSpeaking,
  useSpeakingParticipants, useTracks, VideoTrack,
} from '@livekit/components-react';
import clsx from 'clsx';
import { DisconnectReason, Room, RoomEvent, Track, VideoPresets } from 'livekit-client';
import {
  BarChart3, Circle, DoorOpen, Hand, LayoutGrid, Lock, LockOpen, MessageCircleQuestion, MessageSquare, Mic, MicOff, MonitorUp,
  MonitorX, PenLine, PhoneOff, Presentation, Send, Smile, UserMinus, Users, Video, VideoOff, X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeetingBroadcastEvent, MeetingInfo, MeetingLiveState, MeetingRole, MeetingRoomToken, MessageInfo } from '@teamsphere/shared';
import { WS_EVENTS } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { RichText } from '@/components/chat/rich-text';
import { api } from '@/lib/api';
import { formatCallDuration } from '@/lib/calls';
import { useMessages } from '@/lib/chat';
import { getDevicePrefs } from '@/lib/devices';
import { ROLE_LABEL, useMeetingActivity } from '@/lib/meetings';
import { getSocket } from '@/lib/socket';
import { BreakoutsPanel, PollsPanel, QnaPanel } from './meeting-extras';
import type { JoinChoices } from './pre-join';

// tldraw is large and browser-only: load it when someone opens the whiteboard.
const Whiteboard = dynamic(() => import('./whiteboard'), { ssr: false, loading: () => <p className="p-4 text-sm text-white/60">Loading whiteboard…</p> });

export type StageEnd = 'left' | 'ended' | 'removed' | 'disconnected';

const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Conn = Pick<MeetingRoomToken, 'url' | 'token' | 'breakoutRoomId' | 'breakoutName'>;

/**
 * The in-meeting view: LiveKit room, gallery/speaker layouts, hands, reactions, chat, people and host controls, plus
 * breakout rooms (a separate LiveKit room per breakout), polls, Q&A, whiteboard and recording.
 */
export function MeetingStage({ meeting, join, choices, meId, guest = false, onEnd }: {
  meeting: MeetingInfo;
  join: { url: string; token: string; role: MeetingRole; state: MeetingLiveState };
  choices: JoinChoices;
  meId: string;
  guest?: boolean;
  onEnd: (why: StageEnd) => void;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<MeetingLiveState>(join.state);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<Conn>({ url: join.url, token: join.token, breakoutRoomId: null, breakoutName: null });
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const organizer = join.role === 'organizer' || join.role === 'coorganizer';

  /** Connects to the room the server says I belong in (or, for organizers, the one they picked). */
  const switchRoom = useCallback(async (roomId?: string) => {
    try {
      const t = await api<MeetingRoomToken>(`/meetings/sessions/${join.state.sessionId}/token${roomId ? `?room=${encodeURIComponent(roomId)}` : ''}`);
      setConn((c) => (c.token === t.token ? c : t));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch rooms');
    }
  }, [join.state.sessionId]);
  const switchRef = useRef(switchRoom);
  switchRef.current = switchRoom;
  const connRef = useRef(conn);
  connRef.current = conn;

  // Follow breakout assignments: attendees move when rooms open/close or they're reassigned; organizers come back
  // to the main room when rooms close.
  const myRoom = state.breakouts?.open ? (state.breakouts.rooms.find((r) => r.userIds.includes(meId))?.id ?? null) : null;
  const roomsOpen = !!state.breakouts?.open;
  useEffect(() => {
    if (organizer) {
      if (!roomsOpen && conn.breakoutRoomId) void switchRef.current('main');
    } else if (myRoom !== conn.breakoutRoomId) void switchRef.current();
  }, [organizer, myRoom, roomsOpen, conn.breakoutRoomId]);

  // One Room per effect run, so a dev-mode double mount can't abort and report the real connection.
  useEffect(() => {
    let left = false;
    const prefs = getDevicePrefs();
    const r = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { deviceId: prefs.audioinput, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { deviceId: prefs.videoinput, resolution: VideoPresets.h720.resolution },
      audioOutput: { deviceId: prefs.audiooutput },
      publishDefaults: { simulcast: true },
    });
    setRoom(r);
    r.on(RoomEvent.Disconnected, (reason) => {
      if (left || reason === DisconnectReason.CLIENT_INITIATED) return;
      // A breakout room closing sends people back to the main meeting.
      if (connRef.current.breakoutRoomId) return void switchRef.current(organizer ? 'main' : undefined);
      endRef.current(reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed' : reason === DisconnectReason.ROOM_DELETED ? 'ended' : 'disconnected');
    });
    (async () => {
      try {
        await r.connect(conn.url, conn.token);
      } catch {
        if (!left) setError("Couldn't reach the meeting server.");
        return;
      }
      if (left) return;
      setConnected(true);
      if (choices.mic && !choices.audioOff) await r.localParticipant.setMicrophoneEnabled(true).catch(() => !left && setError('Your microphone is unavailable or not allowed.'));
      if (choices.camera) await r.localParticipant.setCameraEnabled(true).catch(() => !left && setError('Your camera is unavailable or not allowed.'));
    })();
    return () => {
      left = true;
      void r.disconnect();
    };
  }, [conn.url, conn.token, choices, organizer]);

  // Live state (lobby, hands, lock, roster) pushed by the API.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (s: MeetingLiveState) => {
      if (s.sessionId !== join.state.sessionId) return;
      setState(s);
      if (s.endedAt) endRef.current('ended');
    };
    // A reconnecting socket may have missed updates (e.g. breakout rooms opening).
    const onConnect = () => void api<MeetingLiveState>(`/meetings/sessions/${join.state.sessionId}`).then(setState).catch(() => undefined);
    socket.on(WS_EVENTS.meetingUpdated, onUpdate);
    socket.on('connect', onConnect);
    return () => {
      socket.off(WS_EVENTS.meetingUpdated, onUpdate);
      socket.off('connect', onConnect);
    };
  }, [join.state.sessionId]);

  if (!room) return null;
  return (
    <RoomContext.Provider value={room}>
      <RoomAudioRenderer muted={choices.audioOff} />
      <StageBody meeting={meeting} role={join.role} state={state} setState={setState} meId={meId} guest={guest} conn={conn} onVisit={(id) => void switchRoom(id)} connected={connected} error={error} setError={setError} onEnd={onEnd} room={room} />
    </RoomContext.Provider>
  );
}

type Panel = 'none' | 'chat' | 'people' | 'polls' | 'qna' | 'breakouts';

function StageBody({ meeting, role, state, setState, meId, guest, conn, onVisit, connected, error, setError, onEnd, room }: {
  meeting: MeetingInfo;
  role: MeetingRole;
  state: MeetingLiveState;
  setState: (s: MeetingLiveState) => void;
  meId: string;
  guest: boolean;
  conn: Conn;
  onVisit: (roomId: string) => void;
  connected: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  onEnd: (why: StageEnd) => void;
  room: Room;
}) {
  const [panel, setPanel] = useState<Panel>('none');
  const [layout, setLayout] = useState<'gallery' | 'speaker'>('gallery');
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [floating, setFloating] = useState<{ id: number; emoji: string; name: string; x: number }[]>([]);
  const [, force] = useState(0);
  const organizer = role === 'organizer' || role === 'coorganizer';
  const elevated = organizer || role === 'presenter';
  const canMic = elevated || state.allowAttendeeMic;
  const canCam = elevated || state.allowAttendeeCamera;
  const canShare = elevated || meeting.options.whoCanPresent === 'everyone';
  const handUp = state.hands.some((h) => h.userId === meId);
  const lp = room.localParticipant;
  const duration = useDuration();
  const runsMeeting = elevated;
  const [board, setBoard] = useState(false);
  const [broadcast, setBroadcast] = useState<MeetingBroadcastEvent | null>(null);
  const [pollAlert, setPollAlert] = useState(false);
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? 'none' : p));
  const organizerIds = useMemo(() => new Set(state.participants.filter((p) => p.role === 'organizer' || p.role === 'coorganizer').map((p) => p.id)), [state.participants]);

  // A newly launched poll pops the polls panel open (or flags it if another panel is in use).
  useMeetingActivity(meeting.id, () => setPanel((cur) => {
    if (cur === 'none') return 'polls';
    if (cur !== 'polls') setPollAlert(true);
    return cur;
  }));
  useEffect(() => {
    if (panel === 'polls') setPollAlert(false);
  }, [panel]);

  // Organizer messages to the breakout rooms.
  useEffect(() => {
    const socket = getSocket();
    const on = (e: MeetingBroadcastEvent) => e.sessionId === state.sessionId && setBroadcast(e);
    socket.on(WS_EVENTS.meetingBroadcast, on);
    return () => void socket.off(WS_EVENTS.meetingBroadcast, on);
  }, [state.sessionId]);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    room.on(RoomEvent.LocalTrackPublished, rerender).on(RoomEvent.LocalTrackUnpublished, rerender).on(RoomEvent.TrackMuted, rerender).on(RoomEvent.TrackUnmuted, rerender);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, rerender).off(RoomEvent.LocalTrackUnpublished, rerender).off(RoomEvent.TrackMuted, rerender).off(RoomEvent.TrackUnmuted, rerender);
    };
  }, [room]);

  // Live reactions go peer to peer over the LiveKit data channel (nothing to store).
  const { send } = useDataChannel('reactions', (msg) => {
    try {
      const { emoji } = JSON.parse(decoder.decode(msg.payload)) as { emoji: string };
      if (REACTIONS.includes(emoji)) float(emoji, msg.from?.name ?? 'Someone');
    } catch { /* ignore malformed */ }
  });
  function float(emoji: string, name: string) {
    const id = Date.now() + Math.random();
    setFloating((f) => [...f, { id, emoji, name, x: 10 + Math.random() * 30 }]);
    setTimeout(() => setFloating((f) => f.filter((r) => r.id !== id)), 3000);
  }
  function react(emoji: string) {
    setReactionsOpen(false);
    float(emoji, 'You');
    void send(encoder.encode(JSON.stringify({ emoji })), { reliable: true, topic: 'reactions' });
  }

  const call = async (path: string, json: unknown) => {
    try {
      setState(await api<MeetingLiveState>(`/meetings/sessions/${state.sessionId}/${path}`, { method: 'POST', json }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  async function leave(endForAll = false) {
    if (endForAll) {
      if (!confirm('End the meeting for everyone?')) return;
      await call('host', { action: 'end' });
    }
    await api(`/meetings/sessions/${state.sessionId}/leave`, { method: 'POST' }).catch(() => undefined);
    await room.disconnect();
    onEnd(endForAll ? 'ended' : 'left');
  }

  const toggleMic = () => void lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch(() => setError('Your microphone is unavailable.'));
  const toggleCam = () => void lp.setCameraEnabled(!lp.isCameraEnabled).catch(() => setError('Your camera is unavailable.'));
  const toggleShare = () => void lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true }).catch(() => undefined);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-[#0f0f16] text-white">
      <header className="flex items-center gap-3 px-4 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{meeting.title}</span>
          <span className="text-xs text-white/60">{connected ? duration : 'Connecting…'}{state.locked && ' · Locked'}</span>
        </span>
        {!guest && <ToolbarButton label="Chat" active={panel === 'chat'} onClick={() => togglePanel('chat')}><MessageSquare size={18} /></ToolbarButton>}
        <ToolbarButton label="Polls" active={panel === 'polls'} badge={pollAlert ? 1 : 0} onClick={() => togglePanel('polls')}><BarChart3 size={18} /></ToolbarButton>
        {meeting.options.allowQna && <ToolbarButton label="Q&A" active={panel === 'qna'} onClick={() => togglePanel('qna')}><MessageCircleQuestion size={18} /></ToolbarButton>}
        {meeting.options.allowWhiteboard && <ToolbarButton label={board ? 'Close whiteboard' : 'Whiteboard'} active={board} onClick={() => setBoard((v) => !v)}><PenLine size={18} /></ToolbarButton>}
        {organizer && <ToolbarButton label="Breakout rooms" active={panel === 'breakouts'} onClick={() => togglePanel('breakouts')}><DoorOpen size={18} /></ToolbarButton>}
        {runsMeeting && (
          <ToolbarButton label={state.recording ? 'Stop recording' : 'Start recording'} active={!!state.recording} onClick={() => void call('recording', { recording: !state.recording })}>
            <Circle size={18} className={state.recording ? 'fill-red-500 text-red-500' : ''} />
          </ToolbarButton>
        )}
        <ToolbarButton label={`People (${state.participants.length})`} active={panel === 'people'} onClick={() => setPanel((p) => (p === 'people' ? 'none' : 'people'))} badge={organizer ? state.lobby.length : 0}>
          <Users size={18} />
        </ToolbarButton>
        <ToolbarButton label={handUp ? 'Lower hand' : 'Raise hand'} active={handUp} onClick={() => void call('hand', { raised: !handUp })}><Hand size={18} /></ToolbarButton>
        {meeting.options.allowReactions && (
          <span className="relative">
            <ToolbarButton label="React" active={reactionsOpen} onClick={() => setReactionsOpen((v) => !v)}><Smile size={18} /></ToolbarButton>
            {reactionsOpen && (
              <span role="menu" className="absolute top-11 right-0 z-20 flex gap-1 rounded-full bg-[#24243a] p-1.5 shadow-xl">
                {REACTIONS.map((e) => (
                  <button key={e} role="menuitem" onClick={() => react(e)} aria-label={`React ${e}`} className="rounded-full px-1.5 text-xl hover:bg-white/10">{e}</button>
                ))}
              </span>
            )}
          </span>
        )}
        <ToolbarButton label={layout === 'gallery' ? 'Speaker view' : 'Gallery view'} onClick={() => setLayout((l) => (l === 'gallery' ? 'speaker' : 'gallery'))}>
          {layout === 'gallery' ? <Presentation size={18} /> : <LayoutGrid size={18} />}
        </ToolbarButton>
        <span className="mx-1 h-6 w-px bg-white/20" />
        <ToolbarButton label={!canCam ? 'Camera disabled by the organizer' : lp.isCameraEnabled ? 'Turn camera off' : 'Turn camera on'} disabled={!canCam} danger={!lp.isCameraEnabled} onClick={toggleCam}>
          {lp.isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
        </ToolbarButton>
        <ToolbarButton label={!canMic ? 'Microphone disabled by the organizer' : lp.isMicrophoneEnabled ? 'Mute' : 'Unmute'} disabled={!canMic} danger={!lp.isMicrophoneEnabled} onClick={toggleMic}>
          {lp.isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </ToolbarButton>
        {canShare && (
          <ToolbarButton label={lp.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'} active={lp.isScreenShareEnabled} onClick={toggleShare}>
            {lp.isScreenShareEnabled ? <MonitorX size={18} /> : <MonitorUp size={18} />}
          </ToolbarButton>
        )}
        <button onClick={() => void leave()} className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-semibold hover:opacity-90">
          <PhoneOff size={16} /> Leave
        </button>
        {organizer && (
          <button onClick={() => void leave(true)} className="rounded-md border border-danger px-3 py-2 text-sm font-semibold text-red-300 hover:bg-danger/20">End</button>
        )}
      </header>
      {state.recording && (
        <div role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-[#24243a] px-3 py-1.5 text-sm">
          <Circle size={10} className="fill-red-500 text-red-500" aria-hidden />
          <span>Recording started by {state.recording.startedBy}. By staying in the meeting you agree to being recorded.</span>
        </div>
      )}
      {conn.breakoutRoomId && (
        <div role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-brand/30 px-3 py-1.5 text-sm">
          <DoorOpen size={14} aria-hidden />
          <span className="flex-1">You are in breakout room <strong>{conn.breakoutName}</strong>{state.breakouts?.endsAt && ` · closes at ${new Date(state.breakouts.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span>
          {organizer && <button onClick={() => onVisit('main')} className="rounded px-2 py-0.5 hover:bg-white/10">Back to main meeting</button>}
        </div>
      )}
      {broadcast && (
        <div role="alert" className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-yellow-400 px-3 py-1.5 text-sm text-black">
          <span className="flex-1"><strong>{broadcast.from}:</strong> {broadcast.text}</span>
          <button onClick={() => setBroadcast(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {error && (
        <div role="alert" className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-danger px-3 py-1.5 text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      {organizer && state.lobby.length > 0 && panel !== 'people' && (
        <div role="status" className="mx-4 mb-2 flex items-center gap-3 rounded-md bg-[#24243a] px-3 py-2 text-sm">
          <span className="flex-1">{state.lobby.length === 1 ? `${state.lobby[0].displayName} is waiting in the lobby` : `${state.lobby.length} people are waiting in the lobby`}</span>
          <button onClick={() => void call('lobby', { userIds: state.lobby.map((l) => l.id), admit: true })} className="rounded bg-brand px-3 py-1 font-semibold">Admit{state.lobby.length > 1 ? ' all' : ''}</button>
          <button onClick={() => setPanel('people')} className="rounded px-2 py-1 hover:bg-white/10">View</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {board ? <div className="h-full p-2"><Whiteboard meetingId={meeting.id} /></div> : <Stage layout={layout} state={state} meId={meId} />}
          <div aria-live="polite" className="pointer-events-none absolute bottom-4 left-0 h-48 w-full overflow-hidden">
            {floating.map((r) => (
              <span key={r.id} className="absolute bottom-0 flex animate-[float_3s_ease-out_forwards] flex-col items-center" style={{ left: `${r.x}%` }}>
                <span className="text-4xl">{r.emoji}</span>
                <span className="rounded bg-black/60 px-1.5 text-[10px]">{r.name}</span>
              </span>
            ))}
          </div>
        </div>
        {panel === 'chat' && <ChatPanel meeting={meeting} meId={meId} onClose={() => setPanel('none')} />}
        {panel === 'people' && <PeoplePanel state={state} meId={meId} organizer={organizer} call={call} onClose={() => setPanel('none')} />}
        {panel === 'polls' && <SidePanel title="Polls" onClose={() => setPanel('none')}><div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><PollsPanel meetingId={meeting.id} manage={runsMeeting} /></div></SidePanel>}
        {panel === 'qna' && <SidePanel title="Q&A" onClose={() => setPanel('none')}><div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><QnaPanel meetingId={meeting.id} moderator={runsMeeting} moderated={meeting.options.moderateQna} /></div></SidePanel>}
        {panel === 'breakouts' && organizer && (
          <SidePanel title="Breakout rooms" onClose={() => setPanel('none')}>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <BreakoutsPanel state={state} meId={meId} organizerIds={organizerIds} onState={setState} onVisit={onVisit} currentRoomId={conn.breakoutRoomId} />
            </div>
          </SidePanel>
        )}
      </div>
    </div>
  );
}

function useDuration() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return formatCallDuration(Math.floor((now - start) / 1000));
}

function ToolbarButton({ label, onClick, active, danger, disabled, badge, children }: {
  label: string; onClick: () => void; active?: boolean; danger?: boolean; disabled?: boolean; badge?: number; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx('relative flex h-10 w-10 items-center justify-center rounded-md disabled:opacity-40', active ? 'bg-brand' : danger ? 'bg-white/10 text-red-300' : 'hover:bg-white/10')}
    >
      {children}
      {!!badge && <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold">{badge}</span>}
    </button>
  );
}

function Stage({ layout, state, meId }: { layout: 'gallery' | 'speaker'; state: MeetingLiveState; meId: string }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const speakers = useSpeakingParticipants();
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  useEffect(() => {
    const s = speakers.find((p) => !p.isLocal);
    if (s) setLastSpeaker(s.identity);
  }, [speakers]);
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);
  const roles = new Map(state.participants.map((p) => [p.id, p.role]));
  const handOrder = new Map(state.hands.map((h, i) => [h.userId, i + 1]));
  const tile = (t: TrackReferenceOrPlaceholder, big = false) => (
    <Tile key={`${t.participant.identity}:${t.source}`} trackRef={t} isMe={t.participant.identity === meId} hand={handOrder.get(t.participant.identity)} role={roles.get(t.participant.identity)} big={big} />
  );

  const featured = screens[0] ?? (layout === 'speaker' ? (cameras.find((c) => c.participant.identity === lastSpeaker) ?? cameras.find((c) => c.participant.identity !== meId) ?? cameras[0]) : undefined);
  if (featured) {
    const rest = cameras.filter((c) => c !== featured);
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <div className="min-h-0 flex-1">{featured.source === Track.Source.ScreenShare ? <ScreenTile trackRef={featured} meId={meId} /> : tile(featured, true)}</div>
        {rest.length > 0 && <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">{rest.map((t) => <div key={`${t.participant.identity}:f`} className="w-48 shrink-0">{tile(t)}</div>)}</div>}
      </div>
    );
  }
  // Gallery: up to 49 tiles in a square-ish grid.
  const shown = cameras.slice(0, 49);
  const cols = Math.ceil(Math.sqrt(shown.length || 1));
  return (
    <div className="grid h-full gap-2 p-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
      {shown.map((t) => tile(t))}
    </div>
  );
}

function ScreenTile({ trackRef, meId }: { trackRef: TrackReferenceOrPlaceholder; meId: string }) {
  return (
    <div className="relative h-full overflow-hidden rounded-lg bg-black">
      {isTrackReference(trackRef) && <VideoTrack trackRef={trackRef} className="h-full w-full object-contain" />}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">
        {trackRef.participant.identity === meId ? 'You are presenting' : `${trackRef.participant.name} is presenting`}
      </span>
    </div>
  );
}

function Tile({ trackRef, isMe, hand, role, big }: { trackRef: TrackReferenceOrPlaceholder; isMe: boolean; hand?: number; role?: MeetingRole; big?: boolean }) {
  const p = trackRef.participant;
  const speaking = useIsSpeaking(p);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const camMuted = useIsMuted(trackRef);
  const name = p.name || p.identity;
  return (
    <div className={clsx('relative h-full min-h-24 overflow-hidden rounded-lg bg-white/5 ring-2', speaking && !micMuted ? 'ring-brand' : 'ring-transparent')}>
      {isTrackReference(trackRef) && !camMuted ? (
        <VideoTrack trackRef={trackRef} className={clsx('h-full w-full object-cover', isMe && '-scale-x-100')} />
      ) : (
        <div className="flex h-full items-center justify-center"><Avatar name={name} size={big ? 96 : 64} /></div>
      )}
      {hand && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-yellow-400 px-1.5 py-0.5 text-xs font-bold text-black" aria-label={`Hand raised, number ${hand}`}>
          <Hand size={12} /> {hand}
        </span>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[90%] items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs">
        {micMuted && <MicOff size={12} aria-label="Muted" />}
        <span className="truncate">{name}{isMe && ' (You)'}</span>
        {role && role !== 'attendee' && role !== 'presenter' && <span className="text-white/60">· {ROLE_LABEL[role]}</span>}
      </span>
    </div>
  );
}

function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside aria-label={title} className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-[#17172280] max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:bg-[#171722]">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="rounded p-1 hover:bg-white/10"><X size={16} /></button>
      </div>
      {children}
    </aside>
  );
}

function PeoplePanel({ state, meId, organizer, call, onClose }: {
  state: MeetingLiveState; meId: string; organizer: boolean; call: (path: string, json: unknown) => Promise<void>; onClose: () => void;
}) {
  const handOrder = new Map(state.hands.map((h, i) => [h.userId, i + 1]));
  const people = [...state.participants].sort((a, b) => (handOrder.get(a.id) ?? 999) - (handOrder.get(b.id) ?? 999));
  return (
    <SidePanel title="People" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 text-sm">
        {organizer && state.lobby.length > 0 && (
          <section className="mb-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white/60 uppercase">Waiting in lobby ({state.lobby.length})</h3>
              <button onClick={() => void call('lobby', { userIds: state.lobby.map((l) => l.id), admit: true })} className="text-xs text-brand hover:underline">Admit all</button>
            </div>
            <ul className="space-y-1">
              {state.lobby.map((u) => (
                <li key={u.id} className="flex items-center gap-2">
                  <Avatar name={u.displayName} src={u.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
                  <button onClick={() => void call('lobby', { userIds: [u.id], admit: true })} className="rounded bg-brand px-2 py-0.5 text-xs font-semibold">Admit</button>
                  <button onClick={() => void call('lobby', { userIds: [u.id], admit: false })} className="rounded px-2 py-0.5 text-xs hover:bg-white/10">Deny</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {organizer && (
          <section className="mb-4 space-y-1.5">
            <h3 className="text-xs font-semibold text-white/60 uppercase">Meeting controls</h3>
            <button onClick={() => void call('host', { action: 'mute_all' })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-white/10"><MicOff size={14} /> Mute all</button>
            <label className="flex items-center gap-2 px-2 py-1">
              <input type="checkbox" checked={!state.allowAttendeeMic} onChange={(e) => void call('host', { action: 'attendee_mic', allowed: !e.target.checked })} /> Disable mic for attendees
            </label>
            <label className="flex items-center gap-2 px-2 py-1">
              <input type="checkbox" checked={!state.allowAttendeeCamera} onChange={(e) => void call('host', { action: 'attendee_camera', allowed: !e.target.checked })} /> Disable camera for attendees
            </label>
            <button onClick={() => void call('host', { action: 'lock', locked: !state.locked })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-white/10">
              {state.locked ? <LockOpen size={14} /> : <Lock size={14} />} {state.locked ? 'Unlock meeting' : 'Lock meeting'}
            </button>
          </section>
        )}
        <h3 className="mb-1 text-xs font-semibold text-white/60 uppercase">In this meeting ({people.length})</h3>
        <ul className="space-y-1">
          {people.map((p) => (
            <li key={p.id} className="group flex items-center gap-2">
              <Avatar name={p.displayName} src={p.avatarUrl} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.displayName}{p.id === meId && ' (You)'}</span>
                <span className="block text-xs text-white/50">{ROLE_LABEL[p.role]}</span>
              </span>
              {handOrder.has(p.id) && (
                <span className="flex items-center gap-0.5 text-xs text-yellow-300" aria-label={`Hand raised, number ${handOrder.get(p.id)}`}>
                  <Hand size={12} /> {handOrder.get(p.id)}
                  {organizer && <button onClick={() => void call('host', { action: 'lower_hand', userId: p.id })} className="ml-1 rounded px-1 text-white/70 hover:bg-white/10">Lower</button>}
                </span>
              )}
              {organizer && p.id !== meId && p.role !== 'organizer' && (
                <button onClick={() => confirm(`Remove ${p.displayName} from the meeting?`) && void call('host', { action: 'remove', userId: p.id })} aria-label={`Remove ${p.displayName}`} title="Remove from meeting" className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-red-300">
                  <UserMinus size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SidePanel>
  );
}

/** The meeting chat (a normal group chat, so it stays after the meeting). */
function ChatPanel({ meeting, meId, onClose }: { meeting: MeetingInfo; meId: string; onClose: () => void }) {
  const { data } = useMessages(meeting.conversationId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages: MessageInfo[] = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.messages) : []), [data]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function sendMessage() {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      await api(`/conversations/${meeting.conversationId}/messages`, { method: 'POST', json: { body } });
    } catch (e) {
      setText(body);
      setError(e instanceof Error ? e.message : 'Could not send');
    }
  }

  return (
    <SidePanel title="Meeting chat" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 text-sm">
        {messages.filter((m) => !m.deletedAt).map((m) => (
          <div key={m.id} className={clsx('mb-2', m.type === 'system' && 'text-center text-xs text-white/50')}>
            {m.type !== 'system' && <span className="block text-xs text-white/60">{m.author?.id === meId ? 'You' : m.author?.displayName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            <div className="break-words"><RichText body={m.body} meId={meId} /></div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {meeting.options.allowChat ? (
        <form onSubmit={(e) => { e.preventDefault(); void sendMessage(); }} className="flex gap-2 border-t border-white/10 p-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" aria-label="Message" className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-brand" />
          <button type="submit" aria-label="Send" className="rounded-md bg-brand px-2"><Send size={16} /></button>
        </form>
      ) : (
        <p className="border-t border-white/10 p-2 text-xs text-white/60">The organizer turned off meeting chat.</p>
      )}
      {error && <p role="alert" className="px-2 pb-2 text-xs text-red-300">{error}</p>}
      <Link href={`/chat/${meeting.conversationId}`} className="px-3 pb-2 text-xs text-brand hover:underline">Open in Chat</Link>
    </SidePanel>
  );
}
