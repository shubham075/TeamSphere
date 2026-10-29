import type { ManualPresence, PresenceStatus } from './presence';

/** User-adjustable desktop app settings, persisted by the Electron main process. */
export interface DesktopSettings {
  serverUrl: string;
  openAtLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
}

export type DesktopShortcut = 'toggle-mute' | 'toggle-camera';
export type SystemIdleState = 'active' | 'idle' | 'locked';
export type CallToastAction = 'open' | 'accept' | 'accept-audio' | 'decline';
/** Main-window state changes reported by the shell (drives the always-on-top mini call window). */
export type DesktopWindowState = 'minimized' | 'hidden' | 'restored';

export interface DesktopNotification {
  title: string;
  body: string;
  /** In-app path opened when the notification is clicked, e.g. `/chat/abc`. */
  path?: string;
  silent?: boolean;
}

export interface IncomingCallToast {
  callId: string;
  callerName: string;
  video: boolean;
}

export interface PopOutWindow {
  /** Same-origin path to open, e.g. `/chat/abc?popout=1`. */
  path: string;
  width?: number;
  height?: number;
  alwaysOnTop?: boolean;
}

export type UpdateStatus =
  | { state: 'disabled'; reason: string }
  | { state: 'checking' | 'none' | 'downloading' }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

/**
 * API exposed by the desktop app's preload script as `window.teamsphere`.
 * Absent in a normal browser, so every web caller must feature-check it.
 */
export interface DesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;
  readonly version: string;

  setUnreadCount(count: number): void;
  notify(n: DesktopNotification): void;
  showIncomingCall(call: IncomingCallToast): void;
  dismissIncomingCall(callId: string): void;
  flashFrame(on: boolean): void;
  /** Enables the global mute/camera shortcuts while a call is active. */
  setInCall(inCall: boolean): void;
  openWindow(w: PopOutWindow): void;
  /** Restores and focuses the main window (e.g. from the mini call window). */
  showMainWindow(): void;
  /** Shows the user's current status as checked in the tray menu. */
  setPresence(status: PresenceStatus): void;

  getSettings(): Promise<DesktopSettings>;
  updateSettings(patch: Partial<Omit<DesktopSettings, 'serverUrl'>>): Promise<DesktopSettings>;
  /** Clears the saved server and shows the server setup screen. */
  changeServer(): void;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): void;

  // Events from the main process. Each returns an unsubscribe function.
  onNavigate(cb: (path: string) => void): () => void;
  onShortcut(cb: (s: DesktopShortcut) => void): () => void;
  onSystemIdle(cb: (s: SystemIdleState) => void): () => void;
  onCallAction(cb: (e: { callId: string; action: CallToastAction }) => void): () => void;
  onPresenceRequest(cb: (status: ManualPresence) => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
  /** Main window only. */
  onWindowState(cb: (s: DesktopWindowState) => void): () => void;
}
