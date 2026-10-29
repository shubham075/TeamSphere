'use client';

import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ChannelView } from '@/components/teams/channel-view';
import { useAuth } from '@/lib/auth-store';
import { useChannel } from '@/lib/teams';

export default function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const meId = useAuth((s) => s.user?.id);
  const { channel, team, isLoading } = useChannel(channelId);
  if (!meId) return null;
  if (!channel || !team) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted">{isLoading ? <Loader2 className="animate-spin" /> : 'This channel is not available.'}</div>;
  }
  return <ChannelView key={channel.id} team={team} channel={channel} meId={meId} />;
}
