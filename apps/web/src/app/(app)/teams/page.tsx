'use client';

import { Loader2, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { findChannel, useTeams } from '@/lib/teams';

/** `/teams?conversation=<id>` (from Activity) opens that channel; otherwise the first channel I can see. */
function TeamsHome() {
  const { data, isLoading } = useTeams();
  const router = useRouter();
  const conversation = useSearchParams().get('conversation');

  useEffect(() => {
    if (!data) return;
    const target = conversation ? findChannel(data, (c) => c.conversationId === conversation) : findChannel(data.filter((t) => !t.hidden), () => true);
    if (target) router.replace(`/teams/c/${target.channel.id}`);
  }, [data, conversation, router]);

  if (isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Users size={32} /></span>
      <h2 className="text-xl font-semibold">Teams</h2>
      <p className="max-w-sm text-sm text-muted">Create a team or join one to start working in channels.</p>
    </div>
  );
}

export default function TeamsPage() {
  return (
    <Suspense>
      <TeamsHome />
    </Suspense>
  );
}
