'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MORE_APPS, RAIL_APPS, RailApp } from '@/lib/apps';

function RailItem({ app, active }: { app: RailApp; active: boolean }) {
  const Icon = app.icon;
  return (
    <Link
      href={`/${app.id}`}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'relative flex w-full flex-col items-center gap-0.5 py-2 text-[11px]',
        active ? 'font-semibold text-brand' : 'text-muted hover:text-text',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-brand" />}
      <Icon size={22} strokeWidth={active ? 2.2 : 1.7} />
      {app.label}
    </Link>
  );
}

export function AppRail() {
  const pathname = usePathname();
  const current = pathname.split('/')[1];

  return (
    <nav aria-label="Apps" className="flex w-[68px] shrink-0 flex-col items-center border-r border-border bg-rail py-1">
      {RAIL_APPS.map((app) => (
        <RailItem key={app.id} app={app} active={current === app.id} />
      ))}
      <div className="mt-auto w-full">
        <RailItem app={MORE_APPS} active={current === MORE_APPS.id} />
      </div>
    </nav>
  );
}
