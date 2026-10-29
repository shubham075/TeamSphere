'use client';

import clsx from 'clsx';
import { Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { formatCallDuration } from '@/lib/calls';
import { getDesktop } from '@/lib/desktop';
import { MINI_CALL_CHANNEL, MiniCallCommand, MiniCallMessage, MiniCallState } from '@/lib/mini-call';

/** Always-on-top mini call window (desktop app), opened by the main window while it's minimized during a call. */
export default function MiniCallPage() {
  const [state, setState] = useState<MiniCallState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(MINI_CALL_CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<MiniCallMessage>) => {
      if (e.data.type === 'state') {
        if (e.data.state) setState(e.data.state);
        else window.close();
      } else if (e.data.type === 'close') {
        window.close();
      }
    };
    ch.postMessage({ type: 'hello' } satisfies MiniCallMessage);
    const bye = () => ch.postMessage({ type: 'closed' } satisfies MiniCallMessage);
    window.addEventListener('pagehide', bye);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    document.title = 'Call – TeamSphere';
    return () => {
      window.removeEventListener('pagehide', bye);
      clearInterval(tick);
      ch.close();
    };
  }, []);

  const send = (command: MiniCallCommand) => channel.current?.postMessage({ type: 'command', command } satisfies MiniCallMessage);
  const expand = () => {
    getDesktop()?.showMainWindow();
    window.close();
  };

  if (!state) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-muted">Connecting…</div>;
  }

  const elapsed = state.answeredAt ? Math.max(0, Math.floor((now - Date.parse(state.answeredAt)) / 1000)) : null;
  const status = state.onHold
    ? 'On hold'
    : state.phase === 'reconnecting'
      ? 'Reconnecting…'
      : elapsed !== null
        ? formatCallDuration(elapsed)
        : 'Calling…';
  const btn = 'flex h-9 w-9 items-center justify-center rounded-full hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2';

  return (
    <section aria-label={`Call with ${state.title}`} className="flex h-full w-full flex-col gap-2 bg-surface p-3 text-text">
      <header className="flex min-w-0 items-baseline gap-2">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{state.title}</h1>
        <span className="shrink-0 text-xs text-muted" aria-live="polite">
          {status}
        </span>
      </header>
      <ul className="flex min-h-0 flex-1 items-center gap-2 overflow-hidden" aria-label="Participants">
        {state.people.length === 0 && <li className="text-xs text-muted">Waiting for others to join…</li>}
        {state.people.slice(0, 5).map((p) => (
          <li key={p.id} className="relative" title={`${p.name}${p.micOn ? '' : ' (muted)'}`}>
            <span className={clsx('block rounded-full ring-2', p.speaking ? 'ring-brand' : 'ring-transparent')}>
              <Avatar name={p.name} src={p.avatarUrl} size={40} />
            </span>
            <span className="sr-only">
              {p.name}
              {p.speaking ? ', speaking' : ''}
              {p.micOn ? '' : ', muted'}
            </span>
            {!p.micOn && (
              <MicOff size={14} aria-hidden="true" className="absolute -right-1 -bottom-1 rounded-full bg-surface p-0.5 text-danger" />
            )}
          </li>
        ))}
        {state.people.length > 5 && <li className="text-xs text-muted">+{state.people.length - 5}</li>}
      </ul>
      <div className="flex items-center justify-center gap-2">
        <button onClick={() => send('toggle-mic')} aria-pressed={!state.micOn} aria-label={state.micOn ? 'Mute' : 'Unmute'} title={state.micOn ? 'Mute (Ctrl+Shift+M)' : 'Unmute (Ctrl+Shift+M)'} className={clsx(btn, state.micOn ? 'bg-surface-2 hover:bg-surface-hover' : 'bg-danger text-white')}>
          {state.micOn ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <button onClick={() => send('toggle-camera')} aria-pressed={state.camOn} aria-label={state.camOn ? 'Turn camera off' : 'Turn camera on'} title={state.camOn ? 'Turn camera off (Ctrl+Shift+O)' : 'Turn camera on (Ctrl+Shift+O)'} className={clsx(btn, 'bg-surface-2 hover:bg-surface-hover')}>
          {state.camOn ? <Video size={16} /> : <VideoOff size={16} />}
        </button>
        <button onClick={expand} aria-label="Back to the call window" title="Back to the call window" className={clsx(btn, 'bg-surface-2 hover:bg-surface-hover')}>
          <Maximize2 size={16} />
        </button>
        <button onClick={() => send('hang-up')} aria-label="Hang up" title="Hang up" className={clsx(btn, 'bg-danger text-white')}>
          <PhoneOff size={16} />
        </button>
      </div>
    </section>
  );
}
