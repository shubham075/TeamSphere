// Bridge for static/picker.html (the screen-share source picker).
import { contextBridge, ipcRenderer } from 'electron';

const requestId = new URLSearchParams(location.search).get('request') ?? '';

contextBridge.exposeInMainWorld('picker', {
  getSources: () => ipcRenderer.invoke(`picker:sources:${requestId}`),
  choose: (id: string | null, audio: boolean) =>
    ipcRenderer.send(`picker:choose:${requestId}`, id ? { id, audio } : null),
});
