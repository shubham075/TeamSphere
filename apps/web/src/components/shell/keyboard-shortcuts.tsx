'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RefObject, useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/lib/call-store';
import { useT } from '@/lib/i18n';
import { SHORTCUTS, shortcutFor } from '@/lib/shortcuts';
import { stepZoom } from '@/lib/theme';
import { SHOW_SHORTCUTS_EVENT } from './search-box';

/** Global keyboard shortcuts plus the cheat sheet dialog (Ctrl+.). */
export function KeyboardShortcuts({ searchRef }: { searchRef: RefObject<HTMLInputElement | null> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action.type === 'search') searchRef.current?.focus();
      else if (action.type === 'cheatsheet') setOpen((o) => !o);
      else if (action.type === 'navigate') router.push(action.href);
      else if (action.type === 'zoom') stepZoom(action.direction);
      else if (action.type === 'call') {
        const call = useCallStore.getState();
        if (!call.call) return;
        if (action.action === 'mic') void call.toggleMic();
        else if (action.action === 'camera') void call.toggleCamera();
        else void call.hangUp();
      }
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SHOW_SHORTCUTS_EVENT, show);
    };
  }, [router, searchRef]);

  return open ? <CheatSheet onClose={() => setOpen(false)} /> : null;
}

function CheatSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center">
          <h2 id="shortcuts-title" className="flex-1 text-lg font-semibold">{t('shortcuts.title')}</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded p-1.5 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-2 text-sm font-semibold text-muted">{g}</h3>
              <dl className="space-y-1.5">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div key={s.keys.join('+') + s.description} className="flex items-center gap-3 text-sm">
                    <dt className="flex shrink-0 gap-1">
                      {s.keys.map((k) => (
                        <kbd key={k} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                      ))}
                    </dt>
                    <dd className="text-muted">{s.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
