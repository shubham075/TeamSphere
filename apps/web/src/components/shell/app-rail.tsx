'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MORE_APPS, RAIL_APPS, RailApp } from '@/lib/apps';
import { useActivity, useConversations } from '@/lib/chat';

function RailItem({ app, active, badge = 0 }: { app: RailApp; active: boolean; badge?: number }) {
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
      <span className="relative">
        <Icon size={22} strokeWidth={active ? 2.2 : 1.7} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {app.label}
    </Link>
  );
}

export function AppRail() {
  const pathname = usePathname();
  const current = pathname.split('/')[1];
  const { data: conversations } = useConversations();
  const { data: activity } = useActivity();
  const badges: Record<string, number> = {
    chat: conversations?.filter((c) => c.unread > 0 && !c.muted).length ?? 0,
    activity: activity?.filter((a) => !a.read).length ?? 0,
  };

  return (
    <nav aria-label="Apps" className="flex w-[68px] shrink-0 flex-col items-center border-r border-border bg-rail py-1">
      {RAIL_APPS.map((app) => (
        <RailItem key={app.id} app={app} active={current === app.id} badge={badges[app.id]} />
      ))}
      <div className="mt-auto w-full">
        <RailItem app={MORE_APPS} active={current === MORE_APPS.id} />
      </div>
    </nav>
  );
}
