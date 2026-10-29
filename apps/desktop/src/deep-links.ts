import { app } from 'electron';
import { resolve } from 'node:path';
import { PROTOCOL } from './links';

export { PROTOCOL, parseDeepLink } from './links';
export type { DeepLink } from './links';

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
