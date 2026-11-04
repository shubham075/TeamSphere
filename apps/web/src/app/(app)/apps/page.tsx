'use client';

import { CalendarCheck, ClipboardList, Clapperboard, Clock, Award, ListChecks, Megaphone, Stamp, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useMyPolicies } from '@/lib/search';

interface AppTile {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  /** Roadmap phase for apps that aren't built yet (SOURCE_OF_TRUTH §9). */
  phase?: string;
}

const APPS: AppTile[] = [
  { id: 'lists', label: 'Lists', description: 'Track issues, assets and events in tables with your own columns.', icon: ListChecks, href: '/lists' },
  { id: 'forms', label: 'Forms', description: 'Create surveys and quizzes, collect responses and see results live.', icon: ClipboardList, href: '/forms' },
  { id: 'approvals', label: 'Approvals', description: 'Request and track sign-offs.', icon: Stamp, phase: '8d' },
  { id: 'stream', label: 'Stream', description: 'Recordings and videos with chapters and comments.', icon: Clapperboard, phase: '8e' },
  { id: 'bookings', label: 'Bookings', description: 'Booking pages and virtual appointments.', icon: CalendarCheck, phase: '10' },
  { id: 'shifts', label: 'Shifts', description: 'Schedules, time off and time clock.', icon: Clock, phase: '11' },
  { id: 'community', label: 'Community', description: 'Org-wide feed, communities and announcements.', icon: Megaphone, phase: '11' },
  { id: 'praise', label: 'Praise', description: 'Thank colleagues with badges.', icon: Award, phase: '11' },
];

/** The "Apps" launcher on the rail: built apps open, upcoming ones show their roadmap phase. */
export default function AppsPage() {
  const { data: policies } = useMyPolicies();
  // Apps an admin turned off for this person are hidden, like rail apps.
  const hidden = new Set([...(policies && !policies.apps.lists ? ['lists'] : []), ...(policies && !policies.apps.forms ? ['forms'] : [])]);
  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold">Apps</h1>
        <p className="mb-5 text-sm text-muted">Everything in TeamSphere is available to everyone. Lists and Forms can also be added as channel tabs.</p>
        <ul className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {APPS.filter((a) => !hidden.has(a.id)).map((a) => {
            const body = (
              <>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand"><a.icon size={22} /></span>
                <span className="font-medium">{a.label}</span>
                <span className="text-sm text-muted">{a.description}</span>
                {a.phase && <span className="mt-auto w-fit rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Arrives in phase {a.phase}</span>}
              </>
            );
            return (
              <li key={a.id}>
                {a.href ? (
                  <Link href={a.href} className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 hover:border-brand">{body}</Link>
                ) : (
                  <div aria-disabled="true" className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 opacity-70">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
