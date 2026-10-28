import { useSyncExternalStore } from 'react';
import { getDesktop } from './desktop';

const subscribe = () => () => undefined;

/** True when this window is a popped-out chat (`?popout=1`): no app rail, title bar or chat list. */
export function isPopout() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('popout') === '1';
}

export function usePopout() {
  return useSyncExternalStore(subscribe, isPopout, () => false);
}

/** Opens a chat in its own window: a native window in the desktop app, a browser popup otherwise. */
export function popOutChat(conversationId: string) {
  const path = `/chat/${conversationId}?popout=1`;
  const desktop = getDesktop();
  if (desktop) return desktop.openWindow({ path, width: 480, height: 720 });
  window.open(path, `chat-${conversationId}`, 'popup,width=480,height=720');
}
