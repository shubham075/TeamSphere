'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { COLLAB_WS_EVENTS, type CollabChangedEvent } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { ck } from '@/lib/pages';
import { getSocket } from '@/lib/socket';

/** Refetches page and whiteboard lists when something the user can see is created, renamed, shared or deleted. */
export function CollabRealtime() {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();
    const onChanged = (e: CollabChangedEvent) => void qc.invalidateQueries({ queryKey: e.kind === 'page' ? ck.pages : ck.boards });
    socket.on(COLLAB_WS_EVENTS.changed, onChanged);
    return () => void socket.off(COLLAB_WS_EVENTS.changed, onChanged);
  }, [meId, qc]);
  return null;
}
