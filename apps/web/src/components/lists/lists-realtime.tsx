'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LISTS_WS_EVENTS } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { lk } from '@/lib/lists';
import { getSocket } from '@/lib/socket';

/** Refetches open lists and forms (items, responses, settings) when someone else changes them. */
export function ListsRealtime() {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();
    const lists = () => void qc.invalidateQueries({ queryKey: lk.lists });
    const forms = () => void qc.invalidateQueries({ queryKey: lk.forms });
    socket.on(LISTS_WS_EVENTS.listsChanged, lists);
    socket.on(LISTS_WS_EVENTS.formsChanged, forms);
    return () => {
      socket.off(LISTS_WS_EVENTS.listsChanged, lists);
      socket.off(LISTS_WS_EVENTS.formsChanged, forms);
    };
  }, [meId, qc]);
  return null;
}
