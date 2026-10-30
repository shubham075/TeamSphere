'use client';

import { useEffect, useState } from 'react';
import { DisplayPrefs, getPrefs, onPrefsChange } from './theme';

/**
 * Minimal i18n: message catalogs keyed by language, `{name}` placeholders, and Intl-based date formatting in the
 * user's chosen time zone. English only for now; adding a language means adding a catalog with the same keys.
 */
const en = {
  'search.placeholder': 'Search or type / for commands (Ctrl+E)',
  'search.seeAll': 'See all results for “{q}”',
  'search.noResults': 'No results for “{q}”',
  'search.people': 'People',
  'search.messages': 'Messages',
  'search.files': 'Files',
  'search.teams': 'Teams',
  'search.channels': 'Channels',
  'search.meetings': 'Meetings',
  'search.commands': 'Commands',
  'shortcuts.title': 'Keyboard shortcuts',
  'prefs.saved': 'Saved',
} as const;

export type MessageKey = keyof typeof en;
const CATALOGS: Record<string, Record<MessageKey, string>> = { en };
export const LANGUAGES = [{ id: 'en', label: 'English' }];

export function translate(lang: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = (CATALOGS[lang] ?? en)[key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : text;
}

/** Time zones offered in settings: the device's plus everything Intl knows. */
export function timeZones(): string[] {
  const all = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  return all;
}

export function resolvedTimeZone(p: DisplayPrefs = getPrefs()) {
  return p.timeZone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : p.timeZone;
}

export function formatDateTime(iso: string | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }, p: DisplayPrefs = getPrefs()) {
  return new Intl.DateTimeFormat(p.language, { ...opts, timeZone: resolvedTimeZone(p) }).format(new Date(iso));
}

export function usePrefs(): DisplayPrefs {
  const [prefs, setPrefs] = useState<DisplayPrefs>(getPrefs);
  useEffect(() => onPrefsChange(setPrefs), []);
  return prefs;
}

export function useT() {
  const { language } = usePrefs();
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(language, key, vars);
}
