'use client';

import { Phone, PhoneOff } from 'lucide-react';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-store';
import { useCallStore } from '@/lib/call-store';
import { callTitle } from '@/lib/calls';
import { startTone, stopTone } from '@/lib/ringtone';
import { CallEnded } from './call-ended';
import { CallView, ErrorToast } from './call-view';
import { IncomingCall } from './incoming-call';

/**
 * Everything call-related that floats over the app: ringing cards, the call itself, the "call ended"
 * card with the voicemail offer, and the "Rejoin" banner after a reload. Mounted once in the app layout.
 */
export function CallManager() {
  const meId = useAuth((s) => s.user?.id);
  const incoming = useCallStore((s) => s.incoming);
  const call = useCallStore((s) => s.call);
  const ended = useCallStore((s) => s.ended);
  const rejoin = useCallStore((s) => s.rejoin);
  const error = useCallStore((s) => s.error);
  const clearError = useCallStore((s) => s.clearError);
  const outgoing = !!call && call.status === 'ringing' && call.startedBy.id === meId;

  // Ringtone while ringing (not while already on another call: just the card); ringback while calling out.
  useEffect(() => {
    if (incoming.length && !call) startTone('incoming');
    else if (outgoing) startTone('outgoing');
    else stopTone();
  }, [incoming.length, call, outgoing]);
  useEffect(() => stopTone, []);

  // Browser notification for a ring while the tab is in the background.
  const newest = incoming[incoming.length - 1];
  useEffect(() => {
    if (!newest || document.visibilityState === 'visible' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(`${newest.startedBy.displayName} is calling`, { body: `Incoming ${newest.kind} call`, tag: `call-${newest.id}`, requireInteraction: true });
    n.onclick = () => window.focus();
    return () => n.close();
  }, [newest]);

  if (!meId) return null;

  return (
    <>
      <CallView meId={meId} />
      <div className="fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-3" aria-live="assertive">
        {incoming.map((c) => (
          <IncomingCall key={c.id} call={c} meId={meId} />
        ))}
        {ended && <CallEnded key={ended.call.id} ended={ended} meId={meId} />}
        {rejoin && !call && (
          <div role="status" className="flex w-80 items-center gap-3 rounded-xl border border-border bg-surface p-3 text-text shadow-2xl">
            <span className="min-w-0 flex-1 text-sm">
              You're still in a call with <strong className="font-semibold">{callTitle(rejoin, meId)}</strong>
            </span>
            <button onClick={() => void useCallStore.getState().hangUp()} aria-label="Hang up" title="Hang up" className="flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white">
              <PhoneOff size={16} />
            </button>
            <button onClick={() => void useCallStore.getState().accept(rejoin.id)} className="flex items-center gap-1 rounded-full bg-success px-3 py-2 text-sm font-semibold text-white">
              <Phone size={14} /> Rejoin
            </button>
          </div>
        )}
      </div>
      {error && !call && <ErrorToast message={error} onClose={clearError} />}
    </>
  );
}
