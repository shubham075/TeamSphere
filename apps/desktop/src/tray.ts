import { app, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import type { ManualPresence } from '@teamsphere/shared';

const asset = (name: string) => nativeImage.createFromPath(join(__dirname, '..', 'assets', name));

// Mirrors PRESENCE_LABELS in @teamsphere/shared (that package is types-only inside the desktop bundle).
const STATUSES: { id: ManualPresence; label: string }[] = [
  { id: 'available', label: 'Available' },
  { id: 'busy', label: 'Busy' },
  { id: 'dnd', label: 'Do not disturb' },
  { id: 'brb', label: 'Be right back' },
  { id: 'away', label: 'Appear away' },
  { id: 'offline', label: 'Appear offline' },
];

export interface TrayActions {
  show(): void;
  setPresence(status: ManualPresence): void;
  toggleOpenAtLogin(enabled: boolean): void;
  isOpenAtLogin(): boolean;
  checkForUpdates(): void;
  quit(): void;
}

export class AppTray {
  private tray: Tray;
  private unread = 0;

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(asset('tray.png'));
    this.tray.setToolTip('TeamSphere');
    this.tray.on('click', () => actions.show());
    this.rebuildMenu();
  }

  setUnread(count: number) {
    if (count === this.unread) return;
    this.unread = count;
    this.tray.setImage(asset(count > 0 ? 'tray-unread.png' : 'tray.png'));
    this.tray.setToolTip(count > 0 ? `TeamSphere – ${count} unread` : 'TeamSphere');
  }

  rebuildMenu() {
    const a = this.actions;
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open TeamSphere', click: a.show },
        { type: 'separator' },
        { label: 'Set status', submenu: STATUSES.map((s) => ({ label: s.label, click: () => a.setPresence(s.id) })) },
        { type: 'separator' },
        {
          label: 'Open at Windows sign-in',
          type: 'checkbox',
          checked: a.isOpenAtLogin(),
          click: (item) => a.toggleOpenAtLogin(item.checked),
        },
        { label: 'Check for updates', click: a.checkForUpdates, enabled: app.isPackaged },
        { type: 'separator' },
        { label: 'Quit TeamSphere', click: a.quit },
      ]),
    );
  }

  destroy() {
    this.tray.destroy();
  }
}
