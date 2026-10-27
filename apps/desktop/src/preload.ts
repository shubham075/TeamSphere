// Exposes `window.teamsphere` (DesktopBridge) to the TeamSphere web app.
// Sandboxed preload: only `electron` may be required here; types are erased at compile time.
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopSettings, UpdateStatus } from '@teamsphere/shared';

const EVENT_CHANNELS = ['ts:navigate', 'ts:shortcut', 'ts:idle', 'ts:call-action', 'ts:presence', 'ts:update-status'];

// Events can arrive before React has subscribed (e.g. the deep link that launched the app),
// so they're queued per channel until the first subscriber appears.
const subscribers = new Map<string, Set<(payload: unknown) => void>>();
const queued = new Map<string, unknown[]>();

for (const channel of EVENT_CHANNELS) {
  ipcRenderer.on(channel, (_e, payload: unknown) => {
    const subs = subscribers.get(channel);
    if (subs?.size) subs.forEach((cb) => cb(payload));
    else queued.set(channel, [...(queued.get(channel) ?? []), payload].slice(-20));
  });
}

function on<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const subs = subscribers.get(channel) ?? new Set();
    subscribers.set(channel, subs);
    const listener = cb as (payload: unknown) => void;
    subs.add(listener);
    const backlog = queued.get(channel);
    if (backlog) {
      queued.delete(channel);
      backlog.forEach((p) => listener(p));
    }
    return () => {
      subs.delete(listener);
    };
  };
}

/** Red circle with the unread count, used as the Windows taskbar overlay icon. */
function drawBadge(count: number): string | null {
  if (count <= 0) return null;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#c4314b';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${count > 9 ? 15 : 20}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(count > 99 ? '99+' : String(count), size / 2, size / 2 + 1);
  return canvas.toDataURL('image/png');
}

const versionArg = process.argv.find((a) => a.startsWith('--ts-version='));

const bridge: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  version: versionArg ? versionArg.slice('--ts-version='.length) : 'unknown',

  setUnreadCount: (count) => ipcRenderer.send('ts:set-unread', count, drawBadge(count)),
  notify: (n) => ipcRenderer.send('ts:notify', n),
  showIncomingCall: (call) => ipcRenderer.send('ts:call-show', call),
  dismissIncomingCall: (callId) => ipcRenderer.send('ts:call-dismiss', callId),
  flashFrame: (flash) => ipcRenderer.send('ts:flash', flash),
  setInCall: (inCall) => ipcRenderer.send('ts:in-call', inCall),
  openWindow: (w) => ipcRenderer.send('ts:open-window', w),

  getSettings: () => ipcRenderer.invoke('ts:get-settings') as Promise<DesktopSettings>,
  updateSettings: (patch) => ipcRenderer.invoke('ts:update-settings', patch) as Promise<DesktopSettings>,
  changeServer: () => ipcRenderer.send('ts:change-server'),
  checkForUpdates: () => ipcRenderer.invoke('ts:check-updates') as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.send('ts:install-update'),

  onNavigate: on('ts:navigate'),
  onShortcut: on('ts:shortcut'),
  onSystemIdle: on('ts:idle'),
  onCallAction: on('ts:call-action'),
  onPresenceRequest: on('ts:presence'),
  onUpdateStatus: on('ts:update-status'),
};

if (location.protocol === 'file:') {
  // Local setup / offline pages shown in the same window before a server is reachable.
  contextBridge.exposeInMainWorld('setup', {
    connect: (server: string) => ipcRenderer.invoke('ts:setup-connect', server),
    retry: () => ipcRenderer.send('ts:retry'),
    changeServer: () => ipcRenderer.send('ts:change-server'),
  });
} else {
  contextBridge.exposeInMainWorld('teamsphere', bridge);
  window.addEventListener('DOMContentLoaded', () => ipcRenderer.send('ts:ready'));
}
