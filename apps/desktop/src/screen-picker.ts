import { BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface PickerSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

/**
 * Handles getDisplayMedia() from the web app: shows our own picker (screens + windows with live thumbnails)
 * and returns the chosen source, with system audio ("loopback") when the user ticks "Include computer sound".
 */
export function installScreenPicker(getParent: () => BrowserWindow | null) {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      const list: PickerSource[] = sources
        .filter((s) => !s.name.startsWith('TeamSphere – Share')) // never offer the picker itself
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }));

      const choice = await showPicker(getParent(), list);
      const source = choice && sources.find((s) => s.id === choice.id);
      if (!source) return callback({});
      callback({ video: source, ...(choice.audio ? { audio: 'loopback' as const } : {}) });
    } catch (e) {
      console.error('screen picker failed', e);
      callback({});
    }
  });
}

function showPicker(parent: BrowserWindow | null, sources: PickerSource[]): Promise<{ id: string; audio: boolean } | null> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 760,
      height: 560,
      minWidth: 520,
      minHeight: 400,
      title: 'TeamSphere – Share your screen',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    const finish = (value: { id: string; audio: boolean } | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler(`picker:sources:${requestId}`);
      ipcMain.removeAllListeners(`picker:choose:${requestId}`);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };

    ipcMain.handle(`picker:sources:${requestId}`, () => sources);
    ipcMain.once(`picker:choose:${requestId}`, (_e, value: { id: string; audio: boolean } | null) => finish(value));
    win.on('closed', () => finish(null));
    win.once('ready-to-show', () => win.show());
    void win.loadFile(join(__dirname, '..', 'static', 'picker.html'), { query: { request: requestId } });
  });
}
