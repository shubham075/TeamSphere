'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { MeetingJoinResult, MeetingLobbyEvent } from '@teamsphere/shared';
import { WS_EVENTS } from '@teamsphere/shared';
import { MeetingStage, StageEnd } from '@/components/meetings/meeting-stage';
import { JoinChoices, PreJoin } from '@/components/meetings/pre-join';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { fmtRange, useMeeting } from '@/lib/meetings';
import { getSocket } from '@/lib/socket';

type Phase =
  | { kind: 'prejoin' }
  | { kind: 'joining' }
  | { kind: 'lobby'; sessionId: string }
  | { kind: 'in'; join: Extract<MeetingJoinResult, { status: 'admitted' }> }
  | { kind: 'out'; why: StageEnd | 'denied' | 'locked' | 'cancelled' | 'error'; message?: string };

const OUT_TEXT: Record<string, string> = {
  left: 'You left the meeting.',
  ended: 'The meeting has ended.',
  removed: 'You were removed from the meeting.',
  disconnected: 'You were disconnected.',
  denied: 'An organizer declined your request to join.',
  locked: 'This meeting is locked. Nobody new can join.',
  cancelled: 'This meeting was cancelled.',
  declined: 'You can’t join this meeting.',
};

export default function MeetingPage() {
  return (
    <Suspense>
      <MeetingJoin />
    </Suspense>
  );
}

/** Join flow: pre-join → (lobby) → meeting stage → left/ended screen with rejoin. */
function MeetingJoin() {
  const { id } = useParams<{ id: string }>();
  const occurrence = useSearchParams().get('occurrence') ?? undefined;
  const meId = useAuth((s) => s.user?.id);
  const { data: meeting, error: loadError } = useMeeting(id);
  const [phase, setPhase] = useState<Phase>({ kind: 'prejoin' });
  const choices = useRef<JoinChoices>({ mic: true, camera: true, audioOff: false });

  const join = useCallback(async () => {
    setPhase((p) => (p.kind === 'lobby' ? p : { kind: 'joining' }));
    try {
      const r = await api<MeetingJoinResult>(`/meetings/${id}/join`, { method: 'POST', json: { occurrence } });
      if (r.status === 'admitted') setPhase({ kind: 'in', join: r });
      else if (r.status === 'lobby') setPhase({ kind: 'lobby', sessionId: r.sessionId });
      else setPhase({ kind: 'out', why: r.reason === 'locked' ? 'locked' : r.reason === 'cancelled' ? 'cancelled' : 'denied', message: OUT_TEXT[r.reason] });
    } catch (e) {
      setPhase({ kind: 'out', why: 'error', message: e instanceof Error ? e.message : 'Could not join the meeting.' });
    }
  }, [id, occurrence]);

  // While waiting in the lobby: admitted → join again (now gets a token); denied → out.
  const sessionId = phase.kind === 'lobby' ? phase.sessionId : null;
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();
    const onLobby = (e: MeetingLobbyEvent) => {
      if (e.sessionId !== sessionId) return;
      if (e.kind === 'admitted') void join();
      if (e.kind === 'denied') setPhase({ kind: 'out', why: 'denied', message: OUT_TEXT.denied });
    };
    socket.on(WS_EVENTS.meetingLobby, onLobby);
    // Covers an admit that happened while the socket was reconnecting.
    const poll = setInterval(() => void join(), 20_000);
    const leave = () => void api(`/meetings/sessions/${sessionId}/leave`, { method: 'POST', keepalive: true }).catch(() => undefined);
    window.addEventListener('pagehide', leave);
    return () => {
      socket.off(WS_EVENTS.meetingLobby, onLobby);
      clearInterval(poll);
      window.removeEventListener('pagehide', leave);
    };
  }, [sessionId, join]);

  if (!meId) return null;
  if (loadError) return <Centered>Meeting not found. <Link href="/calendar" className="text-brand hover:underline">Back to calendar</Link></Centered>;
  if (!meeting) return <Centered><Loader2 className="animate-spin" /></Centered>;

  if (phase.kind === 'prejoin' || phase.kind === 'joining') {
    return (
      <PreJoin
        title={meeting.title}
        subtitle={meeting.isInstant ? `Organized by ${meeting.organizer.displayName}` : `${fmtRange(meeting.startAt, meeting.endAt)} · ${meeting.organizer.displayName}`}
        busy={phase.kind === 'joining'}
        onJoin={(c) => {
          choices.current = c;
          void join();
        }}
      />
    );
  }
  if (phase.kind === 'lobby') {
    return (
      <Centered>
        <Loader2 className="mb-2 animate-spin" />
        <p className="text-lg font-semibold">{meeting.title}</p>
        <p className="text-muted">Someone in the meeting should let you in soon.</p>
        <button
          onClick={() => {
            void api(`/meetings/sessions/${phase.sessionId}/leave`, { method: 'POST' }).catch(() => undefined);
            setPhase({ kind: 'out', why: 'left', message: OUT_TEXT.left });
          }}
          className="mt-3 rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover"
        >
          Leave lobby
        </button>
      </Centered>
    );
  }
  if (phase.kind === 'in') {
    return (
      <MeetingStage
        key={phase.join.token}
        meeting={phase.join.meeting}
        join={phase.join}
        choices={choices.current}
        meId={meId}
        onEnd={(why) => setPhase({ kind: 'out', why, message: OUT_TEXT[why] })}
      />
    );
  }
  return (
    <Centered>
      <p className="text-lg font-semibold">{meeting.title}</p>
      <p className="text-muted">{phase.message ?? OUT_TEXT[phase.why]}</p>
      <div className="mt-3 flex gap-2">
        {phase.why !== 'cancelled' && phase.why !== 'removed' && phase.why !== 'ended' && (
          <button onClick={() => setPhase({ kind: 'prejoin' })} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover">Rejoin</button>
        )}
        <Link href={`/chat/${meeting.conversationId}`} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover">Meeting chat</Link>
        <Link href="/calendar" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover">Calendar</Link>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm">{children}</div>;
}
