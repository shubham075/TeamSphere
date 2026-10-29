'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-store';
import { useCallStore } from '@/lib/call-store';
import { callTitle } from '@/lib/calls';
import { getDesktop } from '@/lib/desktop';
import { callToastCommand, diffCallToasts } from '@/lib/desktop-logic';
import { hostMiniCallWindow } from '@/lib/mini-call';
import { useMe, useSetPresence } from '@/lib/presence';

/**
 * Connects the desktop app's native features to the web app (main window only). Renders nothing; a no-op in the
 * browser. The unread badge and message toasts are driven by RealtimeProvider / TeamsRealtime.
 */
export function DesktopIntegration() {
  const router = useRouter();
  const { data: me } = useMe();
  const setPresence = useSetPresence();
  const status = me?.presence.status;

  // Keep the latest values reachable from the long-lived listeners below.
  const latest = useRef({ status, setPresence });
  latest.current = { status, setPresence };
  /** True when we switched the user to "away" because the PC went idle/locked, so we know to switch back. */
  const autoAway = useRef(false);

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;

    const offs = [
      desktop.onNavigate((path) => router.push(path)),
      desktop.onPresenceRequest((s) => latest.current.setPresence.mutate({ status: s })),
      desktop.onSystemIdle((state) => {
        const { status: current, setPresence: mutation } = latest.current;
        if (state !== 'active' && current === 'available') {
          autoAway.current = true;
          mutation.mutate({ status: 'away' });
        } else if (state === 'active' && autoAway.current) {
          autoAway.current = false;
          if (current === 'away') mutation.mutate({ status: 'available' });
        }
      }),

      // Native call toast buttons (they work while the window is minimized or hidden in the tray).
      desktop.onCallAction(({ callId, action }) => {
        const s = useCallStore.getState();
        const call = s.incoming.find((c) => c.id === callId) ?? Object.values(s.running).find((c) => c.id === callId);
        const cmd = callToastCommand(action, call?.kind);
        if (cmd.type === 'accept') {
          if (s.call?.id !== callId) void s.accept(callId, { video: cmd.video });
        } else if (cmd.type === 'decline') {
          void s.decline(callId);
        } else if (!s.incoming.some((c) => c.id === callId) && s.call?.id !== callId) {
          // "Open" for a call that isn't ringing me: go where it can be joined (or the call history).
          router.push(call?.conversationId && call.conversationType !== 'channel' ? `/chat/${call.conversationId}` : '/calls');
        }
      }),

      // Ctrl+Shift+M / Ctrl+Shift+O, registered by the shell only while setInCall(true).
      desktop.onShortcut((shortcut) => {
        const s = useCallStore.getState();
        if (shortcut === 'toggle-mute') void s.toggleMic();
        else if (shortcut === 'toggle-camera') void s.toggleCamera();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [router]);

  // Tray menu shows the current status as checked.
  useEffect(() => {
    if (status) getDesktop()?.setPresence(status);
  }, [status]);

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;

    /**
     * Native toasts for ringing calls, only while the window isn't in front (otherwise the in-app ringing card is
     * on screen). Taken down when the call is answered here or elsewhere, declined, cancelled or missed.
     */
    const shown = new Set<string>();
    let inCall = false;
    const sync = () => {
      const s = useCallStore.getState();
      const meId = useAuth.getState().user?.id ?? '';
      const inFront = document.visibilityState === 'visible' && document.hasFocus();
      const { show, dismiss } = diffCallToasts(shown, inFront ? [] : s.incoming.map((c) => c.id));
      for (const id of dismiss) {
        shown.delete(id);
        desktop.dismissIncomingCall(id);
      }
      for (const id of show) {
        const call = s.incoming.find((c) => c.id === id)!;
        const caller = call.startedBy.displayName;
        const callerName = call.conversationType === 'group' ? `${caller} · ${callTitle(call, meId)}` : caller;
        shown.add(id);
        desktop.showIncomingCall({ callId: id, callerName, video: call.kind === 'video' });
      }
      // Global mute/camera shortcuts while connected to (or calling out on) a call.
      const nowInCall = !!s.call && s.phase !== 'idle';
      if (nowInCall !== inCall) {
        inCall = nowInCall;
        desktop.setInCall(inCall);
      }
    };

    const offStore = useCallStore.subscribe(sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    const offMini = hostMiniCallWindow();
    return () => {
      offStore();
      offMini();
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
      shown.forEach((id) => desktop.dismissIncomingCall(id));
      if (inCall) desktop.setInCall(false);
    };
  }, []);

  return null;
}
