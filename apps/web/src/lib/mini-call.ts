import { RoomEvent, type Room } from 'livekit-client';
import { useAuth } from './auth-store';
import { useCallStore } from './call-store';
import { callTitle } from './calls';
import { getDesktop } from './desktop';

/**
 * Always-on-top mini call window (desktop app). The LiveKit room lives in the main window, so the mini window is a
 * remote control: the main window publishes call state over a BroadcastChannel and runs the commands it sends back.
 */
export const MINI_CALL_CHANNEL = 'teamsphere-mini-call';
export const MINI_CALL_PATH = '/calls/mini?popout=1';

export interface MiniCallPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  micOn: boolean;
  speaking: boolean;
}

export interface MiniCallState {
  title: string;
  phase: string;
  onHold: boolean;
  /** ISO time the call was answered, for the timer. */
  answeredAt: string | null;
  micOn: boolean;
  camOn: boolean;
  people: MiniCallPerson[];
}

export type MiniCallCommand = 'toggle-mic' | 'toggle-camera' | 'hang-up';

export type MiniCallMessage =
  | { type: 'state'; state: MiniCallState | null }
  | { type: 'close' }
  | { type: 'hello' }
  | { type: 'closed' }
  | { type: 'command'; command: MiniCallCommand };

function snapshot(): MiniCallState | null {
  const { call, room, phase, micOn, camOn } = useCallStore.getState();
  const meId = useAuth.getState().user?.id ?? '';
  if (!call) return null;
  const speaking = new Set(room?.activeSpeakers.map((p) => p.identity) ?? []);
  const people = call.participants
    .filter((p) => p.status === 'joined' && p.user.id !== meId)
    .map((p) => ({
      id: p.user.id,
      name: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      micOn: room?.remoteParticipants.get(p.user.id)?.isMicrophoneEnabled ?? false,
      speaking: speaking.has(p.user.id),
    }));
  return {
    title: callTitle(call, meId),
    phase,
    onHold: call.participants.some((p) => p.user.id === meId && p.onHold),
    answeredAt: call.answeredAt,
    micOn,
    camOn,
    people,
  };
}

const ROOM_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
] as const;

/**
 * Main window side: opens the mini window while a call is running and the main window is minimized or hidden in the
 * tray, keeps it updated, and closes it when the call ends or the main window comes back. Returns a cleanup function.
 */
export function hostMiniCallWindow(): () => void {
  const desktop = getDesktop();
  if (!desktop || typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(MINI_CALL_CHANNEL);
  const post = (m: MiniCallMessage) => channel.postMessage(m);
  let away = false;
  let open = false;
  let room: Room | null = null;

  const publish = () => open && post({ type: 'state', state: snapshot() });

  const watchRoom = (next: Room | null) => {
    if (next === room) return;
    for (const ev of ROOM_EVENTS) room?.off(ev, publish);
    room = next;
    for (const ev of ROOM_EVENTS) room?.on(ev, publish);
  };

  const update = () => {
    const s = useCallStore.getState();
    watchRoom(s.room);
    const inCall = !!s.call && s.phase !== 'idle';
    if (inCall && away && !open) {
      open = true;
      desktop.openWindow({ path: MINI_CALL_PATH, width: 340, height: 200, alwaysOnTop: true });
    } else if (open && (!inCall || !away)) {
      open = false;
      post({ type: 'close' });
    }
    publish();
  };

  channel.onmessage = (e: MessageEvent<MiniCallMessage>) => {
    const m = e.data;
    const s = useCallStore.getState();
    if (m.type === 'hello') {
      // A mini window that outlived its call (or a reload while restored) closes itself.
      if (open) publish();
      else post({ type: 'close' });
    } else if (m.type === 'closed') {
      open = false;
    } else if (m.type === 'command') {
      if (m.command === 'toggle-mic') void s.toggleMic();
      else if (m.command === 'toggle-camera') void s.toggleCamera();
      else if (m.command === 'hang-up') void s.hangUp();
    }
  };

  const offWindow = desktop.onWindowState((state) => {
    away = state !== 'restored';
    update();
  });
  const offStore = useCallStore.subscribe(update);
  update();

  return () => {
    offWindow();
    offStore();
    watchRoom(null);
    if (open) post({ type: 'close' });
    channel.close();
  };
}
