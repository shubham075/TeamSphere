'use client';

import { Users } from 'lucide-react';
import type { ConversationInfo } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { otherMember } from '@/lib/chat';
import { usePresence } from '@/lib/chat-store';

export function ConversationAvatar({ conversation, meId, size = 36 }: { conversation: ConversationInfo; meId?: string; size?: number }) {
  const other = otherMember(conversation, meId);
  const presence = usePresence(other?.id, other?.presence);

  if (conversation.type === 'group') {
    const [a, b] = conversation.members.filter((m) => m.user.id !== meId).map((m) => m.user);
    if (!a) {
      return (
        <span className="flex items-center justify-center rounded-full bg-brand-soft text-brand" style={{ width: size, height: size }}>
          <Users size={size * 0.5} />
        </span>
      );
    }
    const small = Math.round(size * 0.68);
    return (
      <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
        <span className="absolute top-0 left-0">
          <Avatar name={a.displayName} src={a.avatarUrl} size={small} />
        </span>
        {b && (
          <span className="absolute right-0 bottom-0 rounded-full ring-2 ring-surface">
            <Avatar name={b.displayName} src={b.avatarUrl} size={small} />
          </span>
        )}
      </span>
    );
  }
  return <Avatar name={other?.displayName ?? '?'} src={other?.avatarUrl} size={size} presence={presence} />;
}
