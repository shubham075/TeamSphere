'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Presentation } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { InstantMeetingInput, MeetingInfo } from '@teamsphere/shared';
import { api } from '@/lib/api';
import { mk, useLiveMeeting } from '@/lib/meetings';

/** "Meet now" for a chat or channel; turns into "Join meeting" while that chat's meeting is running. */
export function MeetNowButton({ conversationId, channelId }: { conversationId?: string; channelId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: live } = useLiveMeeting({ conversationId, channelId });
  const [busy, setBusy] = useState(false);

  if (live) {
    return (
      <button onClick={() => router.push(`/meetings/${live.meetingId}`)} className="mr-1 flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-hover">
        <Presentation size={15} /> Join meeting
      </button>
    );
  }
  async function start() {
    setBusy(true);
    try {
      const body: InstantMeetingInput = channelId ? { channelId } : { conversationId };
      const m = await api<MeetingInfo>('/meetings/instant', { method: 'POST', json: body });
      await qc.invalidateQueries({ queryKey: mk.all });
      router.push(`/meetings/${m.id}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={() => void start()} disabled={busy} title="Meet now" aria-label="Meet now" className="rounded p-2 hover:bg-surface-hover disabled:opacity-50">
      <Presentation size={18} />
    </button>
  );
}
