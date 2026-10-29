import type { QueryClient } from '@tanstack/react-query';
import { ConnectionQuality, DisconnectReason, Room, RoomEvent, Track, VideoPresets } from 'livekit-client';
import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import {
  CallEndedEvent, CallInfo, CallJoinInfo, CallTransferredEvent, StartCallInput, VoicemailInfo, WS_EVENTS,
} from '@teamsphere/shared';
import { api, ApiError } from './api';
import { useAuth } from './auth-store';
import { callQk, myParticipant } from './calls';
import { getDevicePrefs } from './devices';

export type CallPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface CallStore {
  /** Calls ringing me right now. */
  incoming: CallInfo[];
  /** Running calls in my chats, by conversation id (for the chat header "Join" button). */
  running: Record<string, CallInfo>;
  /** The call I'm in or calling out on. */
  call: CallInfo | null;
  room: Room | null;
  phase: CallPhase;
  minimized: boolean;
  /** Shown after an outgoing call that wasn't answered (with the voicemail offer). */
  ended: CallEndedEvent | null;
  /** A call I was connected to before a page reload; offered as "Rejoin". */
  rejoin: CallInfo | null;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  /** Incoming video paused to save bandwidth (weak network). */
  audioOnly: boolean;
  /** Local network quality, for the indicator and the audio-only suggestion. */
  quality: ConnectionQuality;

  start: (input: StartCallInput) => Promise<void>;
  accept: (callId: string, opts?: { video?: boolean }) => Promise<void>;
  decline: (callId: string) => Promise<void>;
  hangUp: () => Promise<void>;
  endForEveryone: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  setHold: (onHold: boolean) => Promise<void>;
  setAudioOnly: (on: boolean) => void;
  invite: (userIds: string[]) => Promise<void>;
  transfer: (userId: string) => Promise<void>;
  setMinimized: (minimized: boolean) => void;
  dismissEnded: () => void;
  clearError: () => void;
  /** Connects to a call the server already put me in (used when I'm transferred). */
  switchTo: (join: CallJoinInfo) => Promise<void>;
}

const meId = () => useAuth.getState().user?.id ?? '';
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Call state and the LiveKit room. Actions are plain functions on the store (`useCallStore.getState().accept(...)`),
 * so the desktop shell's toast buttons and global mute/camera shortcuts can drive them (Phase 4).
 */
export const useCallStore = create<CallStore>((set, get) => {
  /** Mic/camera state before going on hold, restored on resume. */
  let beforeHold: { mic: boolean; cam: boolean } | null = null;

  function syncLocal(room: Room) {
    const lp = room.localParticipant;
    set({ micOn: lp.isMicrophoneEnabled, camOn: lp.isCameraEnabled, screenOn: lp.isScreenShareEnabled });
  }

  function applyAudioOnly(room: Room, audioOnly: boolean) {
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.videoTrackPublications.values()) {
        if (pub.source === Track.Source.Camera) pub.setEnabled(!audioOnly);
      }
    }
  }

  async function connect(join: CallJoinInfo, video: boolean) {
    const old = get().room;
    const prefs = getDevicePrefs();
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { deviceId: prefs.audioinput, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { deviceId: prefs.videoinput, resolution: VideoPresets.h720.resolution },
      audioOutput: { deviceId: prefs.audiooutput },
      publishDefaults: { simulcast: true },
    });
    set({ call: join.call, room, phase: 'connecting', minimized: false, ended: null, rejoin: null, error: null, audioOnly: false });
    // Set the new call first so late events about the old one are ignored.
    void old?.disconnect();

    const mine = () => get().room === room;
    room
      .on(RoomEvent.Reconnecting, () => mine() && set({ phase: 'reconnecting' }))
      .on(RoomEvent.SignalReconnecting, () => mine() && set({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => mine() && set({ phase: 'connected' }))
      .on(RoomEvent.Disconnected, (reason) => {
        if (!mine() || reason === DisconnectReason.CLIENT_INITIATED) return;
        // ROOM_DELETED = the call ended on the server; call:ended tidies up. Anything else: offer to rejoin.
        if (reason !== DisconnectReason.ROOM_DELETED) set({ phase: 'disconnected' });
      })
      .on(RoomEvent.LocalTrackPublished, () => mine() && syncLocal(room))
      .on(RoomEvent.LocalTrackUnpublished, () => mine() && syncLocal(room))
      .on(RoomEvent.TrackMuted, () => mine() && syncLocal(room))
      .on(RoomEvent.TrackUnmuted, () => mine() && syncLocal(room))
      .on(RoomEvent.TrackPublished, () => mine() && get().audioOnly && applyAudioOnly(room, true))
      .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (mine() && participant.isLocal) set({ quality });
      })
      .on(RoomEvent.MediaDevicesError, (e) => mine() && set({ error: `Can't use your camera or microphone: ${e.message}` }));

    try {
      await room.connect(join.url, join.token);
    } catch {
      if (mine()) set({ phase: 'disconnected', error: "Couldn't reach the call server. Check your network and try again." });
      return;
    }
    if (!mine()) return void room.disconnect();
    set({ phase: 'connected' });
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      set({ error: 'Your microphone is unavailable. Others can’t hear you.' });
    }
    if (video) {
      try {
        await room.localParticipant.setCameraEnabled(true);
      } catch {
        set({ error: 'Your camera is unavailable.' });
      }
    }
    syncLocal(room);
  }

  async function teardown() {
    const room = get().room;
    beforeHold = null;
    set({ call: null, room: null, phase: 'idle', minimized: false, micOn: false, camOn: false, screenOn: false, audioOnly: false });
    await room?.disconnect();
  }

  return {
    incoming: [],
    running: {},
    call: null,
    room: null,
    phase: 'idle',
    minimized: false,
    ended: null,
    rejoin: null,
    error: null,
    micOn: false,
    camOn: false,
    screenOn: false,
    audioOnly: false,
    quality: ConnectionQuality.Unknown,

    async start(input) {
      try {
        const join = await api<CallJoinInfo>('/calls', { method: 'POST', json: input });
        // Busy / DND / straight to voicemail: the call is already over (call:ended shows why).
        if (['ended', 'missed', 'declined'].includes(join.call.status)) return;
        await connect(join, input.kind === 'video');
      } catch (e) {
        set({ error: message(e, 'Could not start the call') });
      }
    },

    async accept(callId, opts) {
      set((s) => ({ incoming: s.incoming.filter((c) => c.id !== callId) }));
      try {
        const join = await api<CallJoinInfo>(`/calls/${callId}/join`, { method: 'POST' });
        await connect(join, opts?.video ?? false);
      } catch (e) {
        set({ error: message(e, 'Could not join the call'), rejoin: null });
      }
    },

    async decline(callId) {
      set((s) => ({ incoming: s.incoming.filter((c) => c.id !== callId) }));
      await api(`/calls/${callId}/decline`, { method: 'POST' }).catch(() => undefined);
    },

    async hangUp() {
      const id = get().call?.id ?? get().rejoin?.id;
      set({ rejoin: null });
      await teardown();
      if (id) await api(`/calls/${id}/leave`, { method: 'POST' }).catch(() => undefined);
    },

    async endForEveryone() {
      const id = get().call?.id;
      await teardown();
      if (id) await api(`/calls/${id}/end`, { method: 'POST' }).catch(() => undefined);
    },

    async toggleMic() {
      const room = get().room;
      if (!room || beforeHold) return;
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled).catch(() => {
        set({ error: 'Your microphone is unavailable.' });
      });
      syncLocal(room);
    },

    async toggleCamera() {
      const room = get().room;
      if (!room || beforeHold) return;
      await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled).catch(() => {
        set({ error: 'Your camera is unavailable.' });
      });
      syncLocal(room);
    },

    async toggleScreenShare() {
      const room = get().room;
      if (!room) return;
      // Cancelling the browser's screen picker rejects; that's not an error worth showing.
      await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, { audio: true }).catch(() => undefined);
      syncLocal(room);
    },

    async setHold(onHold) {
      const { room, call } = get();
      if (!room || !call) return;
      const lp = room.localParticipant;
      if (onHold && !beforeHold) {
        beforeHold = { mic: lp.isMicrophoneEnabled, cam: lp.isCameraEnabled };
        await Promise.all([lp.setMicrophoneEnabled(false), lp.setCameraEnabled(false)]).catch(() => undefined);
      } else if (!onHold && beforeHold) {
        const restore = beforeHold;
        beforeHold = null;
        await Promise.all([lp.setMicrophoneEnabled(restore.mic), lp.setCameraEnabled(restore.cam)]).catch(() => undefined);
      }
      syncLocal(room);
      await api<CallInfo>(`/calls/${call.id}/hold`, { method: 'POST', json: { onHold } })
        .then((info) => set({ call: info }))
        .catch((e) => set({ error: message(e, 'Could not change hold') }));
    },

    setAudioOnly(on) {
      const room = get().room;
      if (room) applyAudioOnly(room, on);
      set({ audioOnly: on });
      if (on && room?.localParticipant.isCameraEnabled) void get().toggleCamera();
    },

    async invite(userIds) {
      const id = get().call?.id;
      if (!id) return;
      await api<CallInfo>(`/calls/${id}/invite`, { method: 'POST', json: { userIds } })
        .then((info) => set({ call: info }))
        .catch((e) => set({ error: message(e, 'Could not add people') }));
    },

    async transfer(userId) {
      const id = get().call?.id;
      if (!id) return;
      try {
        await api(`/calls/${id}/transfer`, { method: 'POST', json: { userId } });
        await teardown();
      } catch (e) {
        set({ error: message(e, 'Could not transfer the call') });
      }
    },

    setMinimized: (minimized) => set({ minimized }),
    dismissEnded: () => set({ ended: null }),
    clearError: () => set({ error: null }),
    switchTo: (join) => connect(join, get().camOn),
  };
});

// ------------------------------------------------------------------ realtime

function foldCall(call: CallInfo) {
  const me = meId();
  const live = call.status === 'ringing' || call.status === 'active';
  useCallStore.setState((s) => {
    const ringingMe = live && myParticipant(call, me)?.status === 'ringing' && s.call?.id !== call.id;
    const running = { ...s.running };
    if (call.conversationId) {
      if (live) running[call.conversationId] = call;
      else if (running[call.conversationId]?.id === call.id) delete running[call.conversationId];
    }
    return {
      call: s.call?.id === call.id ? call : s.call,
      incoming: ringingMe ? [...s.incoming.filter((c) => c.id !== call.id), call] : s.incoming.filter((c) => c.id !== call.id),
      running,
    };
  });
}

/** Catch up after a (re)connect or reload: who is ringing me, which chats have calls, was I in one. */
async function syncActive() {
  const list = await api<CallInfo[]>('/calls/active').catch(() => null);
  if (!list) return;
  const me = meId();
  const { call } = useCallStore.getState();
  useCallStore.setState({
    incoming: list.filter((c) => c.id !== call?.id && myParticipant(c, me)?.status === 'ringing'),
    running: Object.fromEntries(list.filter((c) => c.conversationId).map((c) => [c.conversationId!, c])),
    rejoin: call ? null : (list.find((c) => myParticipant(c, me)?.status === 'joined') ?? null),
  });
}

/** Folds `call:*` events into the call store. Called by RealtimeProvider with the shared socket. */
export function bindCallEvents(socket: Socket, qc: QueryClient) {
  socket.on('connect', () => void syncActive());
  socket.on(WS_EVENTS.callIncoming, foldCall);
  socket.on(WS_EVENTS.callUpdated, foldCall);

  socket.on(WS_EVENTS.callEnded, (e: CallEndedEvent) => {
    foldCall(e.call);
    void qc.invalidateQueries({ queryKey: callQk.history });
    const s = useCallStore.getState();
    if (s.rejoin?.id === e.call.id) useCallStore.setState({ rejoin: null });
    const wasCurrent = s.call?.id === e.call.id;
    if (wasCurrent) {
      const room = s.room;
      useCallStore.setState({ call: null, room: null, phase: 'idle', minimized: false, micOn: false, camOn: false, screenOn: false });
      void room?.disconnect();
    }
    // Outgoing call that nobody picked up: say why and offer voicemail.
    const mine = e.call.startedBy.id === meId();
    if (e.voicemailFor || (mine && !e.call.answeredAt && e.call.endReason !== 'cancelled')) {
      useCallStore.setState({ ended: e });
    }
  });

  socket.on(WS_EVENTS.callTransferred, (e: CallTransferredEvent) => {
    const s = useCallStore.getState();
    // Switch rooms: this side now rings the transfer target.
    if (s.call?.id === e.fromCallId) void s.switchTo(e.join);
  });

  socket.on(WS_EVENTS.voicemailNew, (v: VoicemailInfo) => {
    qc.setQueryData<VoicemailInfo[]>(callQk.voicemails, (list) => (list ? [v, ...list.filter((x) => x.id !== v.id)] : list));
  });
}
