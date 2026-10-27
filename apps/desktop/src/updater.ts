import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '@teamsphere/shared';

const FOUR_HOURS = 4 * 60 * 60 * 1000;

/**
 * Auto-update from the company's own server: <server>/desktop/latest.yml + installer.
 * One build works for every deployment because the feed URL comes from the configured server.
 */
export class Updater {
  private status: UpdateStatus = app.isPackaged
    ? { state: 'none' }
    : { state: 'disabled', reason: 'Updates are only checked in installed builds' };
  private timer?: NodeJS.Timeout;

  constructor(private readonly broadcast: (s: UpdateStatus) => void) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'none' }));
    autoUpdater.on('update-available', () => this.set({ state: 'downloading' }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: e?.message ?? String(e) }));
  }

  start(serverUrl: string) {
    if (!app.isPackaged) return;
    autoUpdater.setFeedURL({ provider: 'generic', url: `${serverUrl}/desktop/` });
    void this.check();
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.check(), FOUR_HOURS);
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    return this.status;
  }

  install() {
    if (this.status.state === 'ready') autoUpdater.quitAndInstall();
  }

  private set(s: UpdateStatus) {
    this.status = s;
    this.broadcast(s);
  }
}
