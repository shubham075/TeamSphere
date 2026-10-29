'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { FILE_WS_EVENTS } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { fk } from '@/lib/files';
import { getSocket } from '@/lib/socket';

/** Refetches open Files views when someone changes, shares or requests something the user can see. */
export function FilesRealtime() {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();
    const refresh = () => void qc.invalidateQueries({ queryKey: fk.all });
    socket.on(FILE_WS_EVENTS.changed, refresh);
    socket.on(FILE_WS_EVENTS.accessRequest, refresh);
    return () => {
      socket.off(FILE_WS_EVENTS.changed, refresh);
      socket.off(FILE_WS_EVENTS.accessRequest, refresh);
    };
  }, [meId, qc]);
  return null;
}
