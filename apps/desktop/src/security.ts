import { app, BrowserWindowConstructorOptions, session, shell, WebContents } from 'electron';
import { join } from 'node:path';

/** Top-level navigation is allowed only to the TeamSphere server and the Microsoft sign-in pages used by Entra SSO. */
const SSO_HOSTS = new Set(['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'device.login.microsoftonline.com']);

const ALLOWED_PERMISSIONS = new Set([
  'media', // camera & microphone
  'display-capture', // screen sharing
  'notifications',
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'pointerLock',
  'speaker-selection',
]);

let serverOrigin: string | null = null;

export function setServerOrigin(origin: string | null) {
  serverOrigin = origin;
}

export function isServerUrl(url: string): boolean {
  try {
    return !!serverOrigin && new URL(url).origin === serverOrigin;
  } catch {
    return false;
  }
}

function isAllowedNavigation(url: string): boolean {
  if (url.startsWith('file://') && url.includes('/static/')) return true;
  if (isServerUrl(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SSO_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function openExternal(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') void shell.openExternal(url);
  } catch {
    /* ignore malformed URLs */
  }
}

/** Hardened defaults for every window that shows server content. */
export function secureWebPreferences(preload: string): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: true,
    backgroundThrottling: false, // keep calls and ringing alive when minimized
    additionalArguments: [`--ts-version=${app.getVersion()}`],
  };
}

export function installSessionSecurity() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isServerUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && !!serverOrigin && requestingOrigin === serverOrigin;
  });

  // Identify the desktop app to the server (shown in "Signed-in devices").
  ses.setUserAgent(`${ses.getUserAgent()} TeamSphereDesktop/${app.getVersion()}`);

  app.on('web-contents-created', (_e, contents) => lockDownContents(contents));
}

function lockDownContents(contents: WebContents) {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());

  // window.open: same-origin pop-outs become app windows; everything else opens in the default browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 720,
          autoHideMenuBar: true,
          icon: join(__dirname, '..', 'assets', 'icon.png'),
          webPreferences: secureWebPreferences(join(__dirname, 'preload.js')),
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}
