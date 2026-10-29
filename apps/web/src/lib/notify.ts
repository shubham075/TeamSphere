import type { QueryClient } from '@tanstack/react-query';
import type { PresenceStatus } from '@teamsphere/shared';
import { getDesktop } from './desktop';
import { isPopout } from './popout';
import type { Me } from './presence';

export const myStatus = (qc: QueryClient): PresenceStatus | undefined => qc.getQueryData<Me>(['me'])?.presence.status;

/**
 * Message toast: a native Windows toast in the desktop app (clicking it opens `path` in the main window),
 * a browser notification otherwise. Callers decide whether to notify (see `shouldNotify`).
 */
export function notifyDesktop(title: string, body: string, path: string) {
  // The main window already notifies; a popped-out chat would only duplicate it.
  if (isPopout()) return;
  const desktop = getDesktop();
  if (desktop) return desktop.notify({ title, body, path });
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag: path });
    n.onclick = () => {
      window.focus();
      location.assign(path);
    };
  }
}
