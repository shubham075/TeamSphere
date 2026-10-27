import { app } from 'electron';
import { resolve } from 'node:path';
import type { CallToastAction } from '@teamsphere/shared';

export const PROTOCOL = 'teamsphere';

export type DeepLink =
  | { kind: 'navigate'; path: string }
  | { kind: 'call'; callId: string; action: CallToastAction };

export function registerProtocol() {
  if (!process.defaultApp) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  } else if (process.env.TEAMSPHERE_DEV_PROTOCOL === '1') {
    // Development (opt-in, writes to HKCU): `electron .` needs the app path so Windows can relaunch us with the link.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
  }
}

export function findDeepLink(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`));
}

const CALL_ACTIONS: CallToastAction[] = ['open', 'accept', 'accept-audio', 'decline'];
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Supported links:
 *   teamsphere://meet/<code>         → /meet/<code>
 *   teamsphere://chat/<id>           → /chat/<id>
 *   teamsphere://teams/<id>[/<ch>]   → /teams/<id>/<ch>
 *   teamsphere://files/<id>          → /files/<id>
 *   teamsphere://call/<action>?id=X  → call toast button
 * Anything else is ignored, so a crafted link can't navigate outside these app routes.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:`) return null;

  const section = url.hostname;
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!segments.every((s) => SAFE_SEGMENT.test(s))) return null;

  if (section === 'call') {
    const action = segments[0] as CallToastAction;
    const callId = url.searchParams.get('id');
    if (!CALL_ACTIONS.includes(action) || !callId || !SAFE_SEGMENT.test(callId)) return null;
    return { kind: 'call', callId, action };
  }
  if (['meet', 'chat', 'teams', 'files', 'calendar', 'calls', 'activity'].includes(section) && segments.length <= 3) {
    return { kind: 'navigate', path: `/${[section, ...segments].join('/')}` };
  }
  return null;
}
