import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopSettings } from '@teamsphere/shared';

export interface StoredConfig extends DesktopSettings {
  windowBounds?: { x: number; y: number; width: number; height: number; maximized: boolean };
}

const DEFAULTS: StoredConfig = {
  serverUrl: '',
  openAtLogin: true,
  startMinimized: false,
  closeToTray: true,
};

const file = () => join(app.getPath('userData'), 'config.json');

let cache: StoredConfig | null = null;

export function loadConfig(): StoredConfig {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function saveConfig(patch: Partial<StoredConfig>): StoredConfig {
  cache = { ...loadConfig(), ...patch };
  writeFileSync(file(), JSON.stringify(cache, null, 2));
  return cache;
}

export function publicSettings(c = loadConfig()): DesktopSettings {
  return { serverUrl: c.serverUrl, openAtLogin: c.openAtLogin, startMinimized: c.startMinimized, closeToTray: c.closeToTray };
}

/** Normalizes a user-entered server address to an origin like `https://teamsphere.company.local`. */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Server to use, in priority order:
 * 1. `--server=<url>` command-line flag (development)
 * 2. TEAMSPHERE_SERVER_URL environment variable
 * 3. The user's saved choice
 * 4. `server.json` next to the app resources — IT drops this in during mass deployment: {"serverUrl": "..."}
 */
export function resolveServerUrl(): string | null {
  const flag = process.argv.find((a) => a.startsWith('--server='))?.slice('--server='.length);
  const candidates = [flag, process.env.TEAMSPHERE_SERVER_URL, loadConfig().serverUrl, readDeploymentServer()];
  for (const c of candidates) {
    const url = c ? normalizeServerUrl(c) : null;
    if (url) return url;
  }
  return null;
}

function readDeploymentServer(): string | undefined {
  const path = join(process.resourcesPath ?? '', 'server.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')).serverUrl;
  } catch {
    return undefined;
  }
}
