/** Keyboard shortcut catalog: drives both the global handler and the cheat sheet (Ctrl+.). */

export interface Shortcut {
  /** Display keys, e.g. ['Ctrl', 'E']. */
  keys: string[];
  description: string;
  group: 'General' | 'Navigation' | 'Calls & meetings' | 'Messaging' | 'View';
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'E'], description: 'Search and commands', group: 'General' },
  { keys: ['Ctrl', 'K'], description: 'Search and commands', group: 'General' },
  { keys: ['/'], description: 'Commands (in the search box)', group: 'General' },
  { keys: ['Ctrl', '.'], description: 'Show keyboard shortcuts', group: 'General' },
  { keys: ['Ctrl', ','], description: 'Open settings', group: 'General' },
  { keys: ['Esc'], description: 'Close dialog or menu', group: 'General' },
  { keys: ['Ctrl', '1'], description: 'Activity', group: 'Navigation' },
  { keys: ['Ctrl', '2'], description: 'Chat', group: 'Navigation' },
  { keys: ['Ctrl', '3'], description: 'Teams', group: 'Navigation' },
  { keys: ['Ctrl', '4'], description: 'Calendar', group: 'Navigation' },
  { keys: ['Ctrl', '5'], description: 'Calls', group: 'Navigation' },
  { keys: ['Ctrl', '6'], description: 'Files', group: 'Navigation' },
  { keys: ['Ctrl', 'Shift', 'S'], description: 'Saved messages', group: 'Navigation' },
  { keys: ['Alt', '←'], description: 'Back', group: 'Navigation' },
  { keys: ['Alt', '→'], description: 'Forward', group: 'Navigation' },
  { keys: ['Ctrl', 'Shift', 'M'], description: 'Mute / unmute (in a call)', group: 'Calls & meetings' },
  { keys: ['Ctrl', 'Shift', 'O'], description: 'Camera on / off (in a call)', group: 'Calls & meetings' },
  { keys: ['Ctrl', 'Shift', 'H'], description: 'Hang up', group: 'Calls & meetings' },
  { keys: ['Enter'], description: 'Send message', group: 'Messaging' },
  { keys: ['Shift', 'Enter'], description: 'New line', group: 'Messaging' },
  { keys: ['Ctrl', 'B'], description: 'Bold', group: 'Messaging' },
  { keys: ['Ctrl', 'I'], description: 'Italic', group: 'Messaging' },
  { keys: ['Ctrl', '='], description: 'Zoom in', group: 'View' },
  { keys: ['Ctrl', '-'], description: 'Zoom out', group: 'View' },
  { keys: ['Ctrl', '0'], description: 'Reset zoom', group: 'View' },
];

/** Rail order for Ctrl+1…6. */
export const NAV_SHORTCUTS = ['/activity', '/chat', '/teams', '/calendar', '/calls', '/files'];

export type ShortcutAction =
  | { type: 'search' }
  | { type: 'cheatsheet' }
  | { type: 'navigate'; href: string }
  | { type: 'zoom'; direction: 1 | -1 | 0 }
  | { type: 'call'; action: 'mic' | 'camera' | 'hangup' };

/** Maps a keydown to an app action; null leaves the key to the page. */
export function shortcutFor(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.shiftKey) {
    if (key === 'm') return { type: 'call', action: 'mic' };
    if (key === 'o') return { type: 'call', action: 'camera' };
    if (key === 'h') return { type: 'call', action: 'hangup' };
    if (key === 's') return { type: 'navigate', href: '/chat/saved' };
    return null;
  }
  if (key === 'e' || key === 'k') return { type: 'search' };
  if (key === '.') return { type: 'cheatsheet' };
  if (key === ',') return { type: 'navigate', href: '/settings' };
  if (key === '=' || key === '+') return { type: 'zoom', direction: 1 };
  if (key === '-') return { type: 'zoom', direction: -1 };
  if (key === '0') return { type: 'zoom', direction: 0 };
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= NAV_SHORTCUTS.length) return { type: 'navigate', href: NAV_SHORTCUTS[n - 1] };
  return null;
}
