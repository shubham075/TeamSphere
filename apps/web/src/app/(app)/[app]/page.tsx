'use client';

import { notFound, useParams } from 'next/navigation';
import { ALL_APPS } from '@/lib/apps';

/**
 * Placeholder for apps not built yet. Each phase replaces its entry with a dedicated route
 * (static routes such as app/(app)/chat take precedence over this dynamic one).
 */
export default function UpcomingApp() {
  const { app: id } = useParams<{ app: string }>();
  const app = ALL_APPS.find((a) => a.id === id);
  if (!app) notFound();
  const Icon = app.icon;

  return (
    <>
      <aside className="hidden w-80 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <h1 className="px-5 pt-4 pb-3 text-xl font-semibold">{app.label}</h1>
        <div className="space-y-2 px-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md p-2">
              <span className="h-8 w-8 rounded-full bg-surface-2" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-2/3 rounded bg-surface-2" />
                <span className="block h-2 w-1/2 rounded bg-surface-2" />
              </span>
            </div>
          ))}
        </div>
      </aside>
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Icon size={32} />
        </span>
        <h2 className="text-xl font-semibold">{app.label}</h2>
        <p className="max-w-sm text-sm text-muted">{app.description}</p>
        <p className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">Arrives in phase {app.phase}</p>
      </section>
    </>
  );
}
