import {
  app, BrowserWindow, clipboard, globalShortcut, ipcMain, IpcMainEvent, IpcMainInvokeEvent, Menu, nativeImage, net,
  powerMonitor, screen,
} from 'electron';
import { join } from 'node:path';
import type {
  DesktopNotification, DesktopSettings, DesktopWindowState, IncomingCallToast, ManualPresence, PopOutWindow, PresenceStatus,
  SystemIdleState, UpdateStatus,
} from '@teamsphere/shared';
import { loadConfig, normalizeServerUrl, publicSettings, resolveServerUrl, saveConfig } from './config';
import { DeepLink, findDeepLink, parseDeepLink, registerProtocol } from './deep-links';
import { dismissIncomingCall, showIncomingCall, showNotification } from './notifications';
import { installScreenPicker } from './screen-picker';
import { installSessionSecurity, isServerUrl, secureWebPreferences, setServerOrigin } from './security';
import { AppTray } from './tray';
import { Updater } from './updater';

const APP_ID = 'com.teamsphere.desktop';
const STATIC = join(__dirname, '..', 'static');
const ICON = join(__dirname, '..', 'assets', 'icon.png');
const IDLE_AFTER_SECONDS = 5 * 60;

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let serverUrl: string | null = null;
let quitting = false;
let pendingLink: DeepLink | null = null;
let rendererReady = false;

const updater = new Updater((s: UpdateStatus) => send('ts:update-status', s));

// ---------- single instance & deep links ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const raw = findDeepLink(argv);
    const link = raw ? parseDeepLink(raw) : null;
    if (link) handleDeepLink(link);
    else showMain();
  });
  void app.whenReady().then(start);
}

app.setAppUserModelId(APP_ID);
registerProtocol();

function handleDeepLink(link: DeepLink) {
  if (link.kind === 'call') dismissIncomingCall(link.callId);
  // Declining a call from the toast shouldn't pop the app to the front.
  if (!(link.kind === 'call' && link.action === 'decline')) showMain();
  if (!rendererReady) {
    pendingLink = link;
    return;
  }
  if (link.kind === 'navigate') sendMain('ts:navigate', link.path);
  else sendMain('ts:call-action', { callId: link.callId, action: link.action });
}

// ---------- startup ----------

function start() {
  installSessionSecurity();
  installScreenPicker(() => mainWindow);
  Menu.setApplicationMenu(null);

  const initial = findDeepLink(process.argv);
  pendingLink = initial ? parseDeepLink(initial) : null;

  serverUrl = resolveServerUrl();
  setServerOrigin(serverUrl);
  applyLoginItem(loadConfig().openAtLogin);

  tray = new AppTray({
    show: showMain,
    setPresence: (status: ManualPresence) => send('ts:presence', status),
    toggleOpenAtLogin: (enabled) => {
      saveConfig({ openAtLogin: enabled });
      applyLoginItem(enabled);
    },
    isOpenAtLogin: () => loadConfig().openAtLogin,
    checkForUpdates: () => void updater.check(),
    quit: () => {
      quitting = true;
      app.quit();
    },
  });

  createMainWindow();
  watchIdle();
  if (serverUrl) updater.start(serverUrl);
}

function createMainWindow() {
  const cfg = loadConfig();
  const bounds = visibleBounds(cfg.windowBounds);
  const autostarted = process.argv.includes('--autostart');

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 500,
    title: 'TeamSphere',
    icon: ICON,
    backgroundColor: '#141418',
    show: false,
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(join(__dirname, 'preload.js')),
  });
  if (cfg.windowBounds?.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    if (!(autostarted && cfg.startMinimized)) mainWindow?.show();
  });

  mainWindow.on('close', (e) => {
    saveBounds();
    if (!quitting && loadConfig().closeToTray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    // "Keep running when I close the window" is off → closing the main window quits the app.
    if (!quitting) {
      quitting = true;
      app.quit();
    }
  });

  const wc = mainWindow.webContents;
  // A full page load means the web app must announce itself again (ts:ready) before receiving events.
  wc.on('did-navigate', () => {
    rendererReady = false;
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 (ERR_ABORTED) is a normal superseded navigation, unless it leaves the window empty
    // (e.g. Chromium's network service restarted mid-load).
    const blank = !url || url === 'about:blank' || wc.getURL() === 'about:blank' || wc.getURL() === '';
    if (isMainFrame && serverUrl && (code !== -3 || blank) && !url.startsWith('file:')) {
      void mainWindow?.loadFile(join(STATIC, 'offline.html'), { query: { server: serverUrl, error: description } });
    }
  });
  wc.on('context-menu', (_e, params) => buildContextMenu(params).popup());

  // The web app opens the always-on-top mini call window while the main window is out of sight during a call.
  const state = (s: DesktopWindowState) => () => sendMain('ts:window-state', s);
  mainWindow.on('minimize', state('minimized'));
  mainWindow.on('hide', state('hidden'));
  mainWindow.on('restore', state('restored'));
  mainWindow.on('show', () => {
    if (!mainWindow?.isMinimized()) sendMain('ts:window-state', 'restored');
  });

  loadApp();
}

function loadApp() {
  if (!mainWindow) return;
  if (serverUrl) void mainWindow.loadURL(serverUrl);
  else void mainWindow.loadFile(join(STATIC, 'setup.html'));
}

function showMain() {
  if (!mainWindow) createMainWindow();
  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.show();
  mainWindow!.focus();
}

/** Broadcast to every app window (main + pop-outs), e.g. presence and shortcut events. */
function send(channel: string, payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && isServerUrl(win.webContents.getURL())) win.webContents.send(channel, payload);
  }
}

/** Main window only, e.g. navigation and call actions. */
function sendMain(channel: string, payload?: unknown) {
  if (mainWindow && !mainWindow.isDestroyed() && isServerUrl(mainWindow.webContents.getURL())) {
    mainWindow.webContents.send(channel, payload);
  }
}

function applyLoginItem(enabled: boolean) {
  if (!app.isPackaged) return; // don't register electron.exe during development
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--autostart'] });
}

// ---------- window bounds ----------

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getNormalBounds();
  saveConfig({ windowBounds: { ...b, maximized: mainWindow.isMaximized() } });
}

function visibleBounds(b?: { x: number; y: number; width: number; height: number }) {
  if (!b) return undefined;
  const onScreen = screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y,
  );
  return onScreen ? b : { width: b.width, height: b.height, x: undefined, y: undefined };
}

// ---------- idle / lock detection → automatic "Away" ----------

function watchIdle() {
  let last: SystemIdleState = 'active';
  const emit = (state: SystemIdleState) => {
    if (state !== last) {
      last = state;
      send('ts:idle', state);
    }
  };
  powerMonitor.on('lock-screen', () => emit('locked'));
  powerMonitor.on('unlock-screen', () => emit('active'));
  powerMonitor.on('suspend', () => emit('locked'));
  powerMonitor.on('resume', () => emit('active'));
  setInterval(() => {
    const state = powerMonitor.getSystemIdleState(IDLE_AFTER_SECONDS);
    emit(state === 'unknown' ? 'active' : state);
  }, 30_000);
}

// ---------- spellcheck / clipboard context menu ----------

function buildContextMenu(p: Electron.ContextMenuParams) {
  const items: Electron.MenuItemConstructorOptions[] = [];
  for (const suggestion of p.dictionarySuggestions.slice(0, 5)) {
    items.push({ label: suggestion, click: () => mainWindow?.webContents.replaceMisspelling(suggestion) });
  }
  if (p.misspelledWord) {
    items.push({
      label: 'Add to dictionary',
      click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord),
    });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  else if (p.selectionText) items.push({ role: 'copy' });
  if (p.linkURL) items.push({ label: 'Copy link', click: () => clipboard.writeText(p.linkURL) });
  if (!items.length) items.push({ role: 'reload' });
  return Menu.buildFromTemplate(items);
}

// ---------- IPC (renderer → main) ----------

/** Only pages from the configured TeamSphere server may use the bridge. */
function fromServer(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!e.senderFrame && isServerUrl(e.senderFrame.url);
}
function fromStaticPage(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!e.senderFrame && e.senderFrame.url.startsWith('file://') && e.senderFrame.url.includes('/static/');
}

ipcMain.on('ts:ready', (e) => {
  if (!fromServer(e)) return;
  if (BrowserWindow.fromWebContents(e.sender) !== mainWindow) return;
  rendererReady = true;
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    handleDeepLink(link);
  }
});

ipcMain.on('ts:set-unread', (e, count: number, overlay: string | null) => {
  if (!fromServer(e) || typeof count !== 'number') return;
  const n = Math.max(0, Math.floor(count));
  tray?.setUnread(n);
  if (overlay && n > 0 && overlay.startsWith('data:image/png;base64,')) {
    mainWindow?.setOverlayIcon(nativeImage.createFromDataURL(overlay), `${n} unread`);
  } else {
    mainWindow?.setOverlayIcon(null, '');
  }
});

ipcMain.on('ts:notify', (e, n: DesktopNotification) => {
  if (!fromServer(e) || typeof n?.title !== 'string') return;
  showNotification(
    { title: n.title.slice(0, 200), body: String(n.body ?? '').slice(0, 500), path: n.path, silent: !!n.silent },
    (path) => {
      showMain();
      if (path?.startsWith('/')) sendMain('ts:navigate', path);
    },
  );
});

ipcMain.on('ts:call-show', (e, call: IncomingCallToast) => {
  if (!fromServer(e) || typeof call?.callId !== 'string') return;
  showIncomingCall({ callId: call.callId, callerName: String(call.callerName).slice(0, 100), video: !!call.video }, () =>
    handleDeepLink({ kind: 'call', callId: call.callId, action: 'open' }),
  );
  mainWindow?.flashFrame(true);
});

ipcMain.on('ts:call-dismiss', (e, callId: string) => {
  if (!fromServer(e)) return;
  dismissIncomingCall(String(callId));
  mainWindow?.flashFrame(false);
});

ipcMain.on('ts:flash', (e, on: boolean) => {
  if (fromServer(e)) mainWindow?.flashFrame(!!on);
});

ipcMain.on('ts:in-call', (e, inCall: boolean) => {
  if (!fromServer(e)) return;
  globalShortcut.unregister('CommandOrControl+Shift+M');
  globalShortcut.unregister('CommandOrControl+Shift+O');
  if (inCall) {
    globalShortcut.register('CommandOrControl+Shift+M', () => send('ts:shortcut', 'toggle-mute'));
    globalShortcut.register('CommandOrControl+Shift+O', () => send('ts:shortcut', 'toggle-camera'));
  }
});

/** Pop-out windows by URL, so opening the same chat (or the mini call window) twice focuses the existing one. */
const popouts = new Map<string, BrowserWindow>();

ipcMain.on('ts:open-window', (e, w: PopOutWindow) => {
  if (!fromServer(e) || !serverUrl || typeof w?.path !== 'string' || !w.path.startsWith('/')) return;
  const url = new URL(w.path, serverUrl);
  if (url.origin !== serverUrl) return;
  const key = url.toString();
  const existing = popouts.get(key);
  if (existing && !existing.isDestroyed()) {
    if (w.alwaysOnTop) existing.showInactive();
    else existing.focus();
    return;
  }
  const width = Math.min(Math.max(w.width ?? 960, 280), 2400);
  const height = Math.min(Math.max(w.height ?? 720, 160), 1600);
  // Always-on-top windows (the mini call window) sit in the bottom-right corner and don't steal focus.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = new BrowserWindow({
    width,
    height,
    ...(w.alwaysOnTop ? { x: area.x + area.width - width - 16, y: area.y + area.height - height - 16 } : {}),
    alwaysOnTop: !!w.alwaysOnTop,
    minimizable: !w.alwaysOnTop,
    show: false,
    title: 'TeamSphere',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(join(__dirname, 'preload.js')),
  });
  popouts.set(key, win);
  win.on('closed', () => popouts.delete(key));
  win.once('ready-to-show', () => (w.alwaysOnTop ? win.showInactive() : win.show()));
  void win.loadURL(key);
});

ipcMain.on('ts:show-main', (e) => {
  if (fromServer(e)) showMain();
});

ipcMain.on('ts:presence-state', (e, status: PresenceStatus) => {
  if (fromServer(e) && typeof status === 'string') tray?.setPresence(status);
});

// Report the server actually in use (it may come from --server, the env var or server.json rather than the saved choice).
ipcMain.handle('ts:get-settings', (e): DesktopSettings | null =>
  fromServer(e) ? { ...publicSettings(), serverUrl: serverUrl ?? '' } : null,
);

ipcMain.handle('ts:update-settings', (e, patch: Partial<DesktopSettings>): DesktopSettings | null => {
  if (!fromServer(e)) return null;
  const clean: Partial<DesktopSettings> = {};
  if (typeof patch?.openAtLogin === 'boolean') clean.openAtLogin = patch.openAtLogin;
  if (typeof patch?.startMinimized === 'boolean') clean.startMinimized = patch.startMinimized;
  if (typeof patch?.closeToTray === 'boolean') clean.closeToTray = patch.closeToTray;
  const cfg = saveConfig(clean);
  if (clean.openAtLogin !== undefined) {
    applyLoginItem(clean.openAtLogin);
    tray?.rebuildMenu();
  }
  return { ...publicSettings(cfg), serverUrl: serverUrl ?? '' };
});

ipcMain.on('ts:change-server', (e) => {
  if (!fromServer(e) && !fromStaticPage(e)) return;
  saveConfig({ serverUrl: '' });
  serverUrl = null;
  setServerOrigin(null);
  void mainWindow?.webContents.session.clearStorageData({ storages: ['cookies'] });
  loadApp();
});

ipcMain.handle('ts:check-updates', (e) => (fromServer(e) ? updater.check() : null));
ipcMain.on('ts:install-update', (e) => {
  if (!fromServer(e)) return;
  quitting = true;
  updater.install();
});

// Setup & offline pages (local files).
ipcMain.handle('ts:setup-connect', async (e, input: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!fromStaticPage(e)) return { ok: false, error: 'Not allowed' };
  const url = normalizeServerUrl(String(input ?? ''));
  if (!url) return { ok: false, error: 'Enter a valid server address, e.g. teamsphere.company.local' };
  try {
    const res = await net.fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `The server answered with HTTP ${res.status}. Is this a TeamSphere server?` };
  } catch (err) {
    return { ok: false, error: `Could not reach ${url}. (${err instanceof Error ? err.message : err})` };
  }
  saveConfig({ serverUrl: url });
  serverUrl = url;
  setServerOrigin(url);
  updater.start(url);
  loadApp();
  return { ok: true };
});

ipcMain.on('ts:retry', (e) => {
  if (fromStaticPage(e)) loadApp();
});

// ---------- lifecycle ----------

app.on('before-quit', () => {
  quitting = true;
  saveBounds();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  // Stay alive in the tray; quitting happens from the tray menu.
});
