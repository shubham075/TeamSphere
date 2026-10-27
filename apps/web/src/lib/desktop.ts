import type { DesktopBridge } from '@teamsphere/shared';

declare global {
  interface Window {
    /** Present only inside the TeamSphere Windows app (see apps/desktop/src/preload.ts). */
    teamsphere?: DesktopBridge;
  }
}

/** The desktop bridge, or undefined in a normal browser and during server rendering. */
export function getDesktop(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.teamsphere;
}
