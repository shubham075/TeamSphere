'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { MORE_APPS, RAIL_APPS, RailApp } from '@/lib/apps';
import { useMe } from '@/lib/presence';
import { useMyPolicies } from '@/lib/search';
import { useActivity, useConversations } from '@/lib/chat';
import { useTeamsUnread } from '@/lib/teams';

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

const ADMIN_APP: RailApp = { id: 'admin', label: 'Admin', icon: ShieldCheck, phase: 7, description: 'Admin center' };

export function AppRail() {
  const pathname = usePathname();
  const current = pathname.split('/')[1];
  const { data: conversations } = useConversations();
  const { data: activity } = useActivity();
  const teamsUnread = useTeamsUnread();
  const { data: me } = useMe();
  const { data: policies } = useMyPolicies();
  // The apps policy hides apps an admin turned off for this person (the server refuses their actions too).
  const hidden = new Set<string>([
    ...(policies && !policies.apps.files ? ['files'] : []),
    ...(policies && !policies.apps.meetings ? ['calendar'] : []),
    ...(policies && (!policies.apps.calls || !policies.calling.allowCalls) ? ['calls'] : []),
  ]);
  const badges: Record<string, number> = {
    chat: conversations?.filter((c) => c.unread > 0 && !c.muted).length ?? 0,
    activity: activity?.filter((a) => !a.read).length ?? 0,
    teams: teamsUnread,
  };

  return (
    <nav aria-label="Apps" className="flex w-[68px] shrink-0 flex-col items-center border-r border-border bg-rail py-1">
      {RAIL_APPS.filter((app) => !hidden.has(app.id)).map((app) => (
        <RailItem key={app.id} app={app} active={current === app.id} badge={badges[app.id]} />
      ))}
      <div className="mt-auto w-full">
        {me?.role === 'admin' && <RailItem app={ADMIN_APP} active={current === ADMIN_APP.id} />}
        <RailItem app={MORE_APPS} active={current === MORE_APPS.id} />
      </div>
    </nav>
  );
}
