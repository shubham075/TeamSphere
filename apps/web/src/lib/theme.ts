/**
 * Personal display preferences (theme, density, zoom, language, time zone), kept per device in localStorage and
 * applied as classes/styles on <html>. `contrast` is the high-contrast theme (see globals.css `.hc`).
 */
export type ThemePref = 'system' | 'light' | 'dark' | 'contrast';
export type Density = 'comfortable' | 'compact';

export interface DisplayPrefs {
  theme: ThemePref;
  density: Density;
  /** Percent, 80–150. */
  zoom: number;
  language: string;
  /** IANA zone, or 'auto' for the device's zone. */
  timeZone: string;
}

export const DEFAULT_PREFS: DisplayPrefs = { theme: 'system', density: 'comfortable', zoom: 100, language: 'en', timeZone: 'auto' };
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150];

const KEY = 'ts-theme';
const PREFS_KEY = 'ts-prefs';
const listeners = new Set<(p: DisplayPrefs) => void>();

export function getPrefs(): DisplayPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<DisplayPrefs>;
    const theme = localStorage.getItem(KEY);
    return {
      ...DEFAULT_PREFS,
      ...raw,
      theme: theme === 'light' || theme === 'dark' || theme === 'contrast' ? theme : 'system',
      zoom: Math.min(150, Math.max(80, Number(raw.zoom) || 100)),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(patch: Partial<DisplayPrefs>) {
  const next = { ...getPrefs(), ...patch };
  try {
    // Theme keeps its own key so the boot script (and older builds) can read it.
    localStorage.setItem(KEY, next.theme);
    const { theme: _, ...rest } = next;
    localStorage.setItem(PREFS_KEY, JSON.stringify(rest));
  } catch {
    /* storage unavailable */
  }
  applyPrefs(next);
  listeners.forEach((l) => l(next));
}

export function onPrefsChange(listener: (p: DisplayPrefs) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function applyPrefs(p: DisplayPrefs) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark || p.theme === 'contrast');
  root.classList.toggle('hc', p.theme === 'contrast');
  root.classList.toggle('compact', p.density === 'compact');
  root.style.zoom = p.zoom === 100 ? '' : String(p.zoom / 100);
  root.lang = p.language;
}

export function getThemePref(): ThemePref {
  return getPrefs().theme;
}

export function setThemePref(theme: ThemePref) {
  setPrefs({ theme });
}

export function stepZoom(direction: 1 | -1 | 0) {
  const current = getPrefs().zoom;
  if (direction === 0) return setPrefs({ zoom: 100 });
  const i = ZOOM_STEPS.findIndex((z) => z >= current);
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i === -1 ? ZOOM_STEPS.length - 1 : i) + direction))];
  setPrefs({ zoom: next });
}

/** Inline script for <head> so theme, density and zoom apply before first paint (no flash). */
export const themeBootScript = `try{var t=localStorage.getItem('${KEY}');var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}');var c=document.documentElement.classList;var d=t==='dark'||t==='contrast'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)c.add('dark');if(t==='contrast')c.add('hc');if(p.density==='compact')c.add('compact');if(p.zoom&&p.zoom!==100)document.documentElement.style.zoom=String(p.zoom/100)}catch(e){}`;
