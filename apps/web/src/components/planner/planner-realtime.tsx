'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { PLANNER_WS_EVENTS } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { pk } from '@/lib/planner';
import { getSocket } from '@/lib/socket';

/** Refetches open Planner views and channel tab bars when someone changes something the user can see. */
export function PlannerRealtime() {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();
    const refresh = () => void qc.invalidateQueries({ queryKey: pk.all });
    const tabs = ({ channelId }: { channelId: string }) => void qc.invalidateQueries({ queryKey: pk.tabs(channelId) });
    socket.on(PLANNER_WS_EVENTS.changed, refresh);
    socket.on(PLANNER_WS_EVENTS.tabsChanged, tabs);
    return () => {
      socket.off(PLANNER_WS_EVENTS.changed, refresh);
      socket.off(PLANNER_WS_EVENTS.tabsChanged, tabs);
    };
  }, [meId, qc]);
  return null;
}
