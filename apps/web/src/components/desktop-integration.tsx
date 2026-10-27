'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { getDesktop } from '@/lib/desktop';
import { useMe, useSetPresence } from '@/lib/presence';

/**
 * Connects the desktop app's native features to the web app. Renders nothing; a no-op in the browser.
 * Call toasts, unread badges and in-call shortcuts are wired by the chat and calling features as they land.
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
    ];
    return () => offs.forEach((off) => off());
  }, [router]);

  return null;
}
