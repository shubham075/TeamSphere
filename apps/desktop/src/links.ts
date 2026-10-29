// Pure deep-link parsing (no Electron imports) so it can be unit-tested.
import type { CallToastAction } from '@teamsphere/shared';

export const PROTOCOL = 'teamsphere';

export type DeepLink =
  | { kind: 'navigate'; path: string }
  | { kind: 'call'; callId: string; action: CallToastAction };

const CALL_ACTIONS: CallToastAction[] = ['open', 'accept', 'accept-audio', 'decline'];
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Supported links:
 *   teamsphere://meet/<code>         → /meet/<code>
 *   teamsphere://chat/<id>           → /chat/<id>
 *   teamsphere://teams/<id>[/<ch>]   → /teams/<id>/<ch>
 *   teamsphere://files/<id>          → /files/<id>
 *   teamsphere://call/<id>           → open that call (ringing card, or the chat where it's running)
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
  let segments: string[];
  try {
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (!segments.every((s) => SAFE_SEGMENT.test(s))) return null;

  if (section === 'call') {
    const id = url.searchParams.get('id');
    if (!id && segments.length === 1 && !CALL_ACTIONS.includes(segments[0] as CallToastAction)) {
      // A plain link to a call never answers it; the web app decides what "open" shows.
      return { kind: 'call', callId: segments[0], action: 'open' };
    }
    const action = segments[0] as CallToastAction;
    if (segments.length !== 1 || !CALL_ACTIONS.includes(action) || !id || !SAFE_SEGMENT.test(id)) return null;
    return { kind: 'call', callId: id, action };
  }
  if (['meet', 'chat', 'teams', 'files', 'calendar', 'calls', 'activity'].includes(section) && segments.length <= 3) {
    return { kind: 'navigate', path: `/${[section, ...segments].join('/')}` };
  }
  return null;
}
