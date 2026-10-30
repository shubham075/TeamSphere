'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import type { UsageOverview } from '@teamsphere/shared';
import { AdminAudit } from '@/components/admin/admin-audit';
import { AdminOrg } from '@/components/admin/admin-org';
import { AdminPolicies } from '@/components/admin/admin-policies';
import { AdminTeams } from '@/components/admin/admin-teams';
import { AdminUsers } from '@/components/admin/admin-users';
import { Panel } from '@/components/admin/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/presence';

const SECTIONS = ['Overview', 'Users', 'Guests', 'Teams & channels', 'Policies', 'Org settings', 'Audit log'] as const;
type Section = (typeof SECTIONS)[number];

export default function AdminCenterPage() {
  const { data: me } = useMe();
  const [section, setSection] = useState<Section>('Overview');
  if (!me) return null;
  if (me.role !== 'admin') {
    return <p className="m-auto text-muted">The admin center is only available to administrators.</p>;
  }
  return (
    <>
      <aside className="w-60 shrink-0 border-r border-border bg-surface">
        <h1 className="px-5 pt-4 pb-3 text-xl font-semibold">Admin center</h1>
        <nav aria-label="Admin sections" className="flex flex-col px-2">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              aria-current={section === s ? 'page' : undefined}
              className={clsx('rounded-md px-3 py-2 text-left text-sm', section === s ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover')}
            >
              {s}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {section === 'Overview' && <Overview />}
          {section === 'Users' && <AdminUsers />}
          {section === 'Guests' && <AdminUsers guestsOnly />}
          {section === 'Teams & channels' && <AdminTeams />}
          {section === 'Policies' && <AdminPolicies />}
          {section === 'Org settings' && <AdminOrg />}
          {section === 'Audit log' && <AdminAudit />}
        </div>
      </div>
    </>
  );
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function Overview() {
  const { data: o } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<UsageOverview>('/admin/overview') });
  if (!o) return null;
  const tiles: [string, string | number, string?][] = [
    ['Active users', o.users.active, `${o.users.activeLast7d} signed in this week`],
    ['Admins', o.users.admins],
    ['Guests', o.users.guests],
    ['Disabled', o.users.disabled],
    ['Teams', o.teams, `${o.channels} channels`],
    ['Messages', o.messages.total, `${o.messages.last7d} this week`],
    ['Meetings', o.meetings.total, `${o.meetings.last7d} this week`],
    ['Calls', o.calls.total, `${o.calls.last7d} this week`],
    ['Files', o.files.count, bytes(o.files.bytes)],
  ];
  return (
    <Panel title="Usage overview">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-md border border-border p-4">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-2xl font-semibold">{value}</dd>
            {sub && <dd className="text-xs text-muted">{sub}</dd>}
          </div>
        ))}
      </dl>
    </Panel>
  );
}
