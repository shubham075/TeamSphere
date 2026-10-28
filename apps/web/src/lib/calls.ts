import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  CallHistoryPage, CallInfo, CallSettingsInfo, CallUser, SpeedDialEntry, VoicemailInfo,
} from '@teamsphere/shared';
import { api } from './api';
import { useAuth } from './auth-store';

export const callQk = {
  history: ['calls', 'history'] as const,
  voicemails: ['voicemails'] as const,
  settings: ['calls', 'settings'] as const,
  speedDial: ['calls', 'speed-dial'] as const,
};

export function useCallHistory() {
  return useInfiniteQuery({
    queryKey: callQk.history,
    queryFn: ({ pageParam }) => api<CallHistoryPage>(`/calls/history${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useVoicemails() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  return useQuery({ queryKey: callQk.voicemails, queryFn: () => api<VoicemailInfo[]>('/voicemails'), enabled: signedIn });
}

export function useCallSettings() {
  return useQuery({ queryKey: callQk.settings, queryFn: () => api<CallSettingsInfo>('/calls/settings') });
}

export function useSpeedDial() {
  return useQuery({ queryKey: callQk.speedDial, queryFn: () => api<SpeedDialEntry[]>('/calls/speed-dial') });
}

/** People on the call other than me (and other than rings that were forwarded away). */
export function otherCallUsers(call: CallInfo, meId: string): CallUser[] {
  return call.participants.filter((p) => p.user.id !== meId && p.status !== 'forwarded').map((p) => p.user);
}

export function callTitle(call: CallInfo, meId: string): string {
  if (call.title) return call.title;
  const names = otherCallUsers(call, meId).map((u) => u.displayName);
  if (!names.length) return 'Call';
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

export function myParticipant(call: CallInfo, meId: string) {
  return call.participants.find((p) => p.user.id === meId);
}

export function formatCallDuration(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = String(totalSec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const END_REASONS: Record<string, string> = {
  no_answer: 'No answer',
  declined: 'Declined',
  busy: 'Busy in another call',
  dnd: 'Set to Do not disturb',
  voicemail: 'Calls go to voicemail',
  cancelled: 'Call cancelled',
  transferred: 'Call transferred',
  hangup: 'Call ended',
};

export const endReasonLabel = (reason: string | null) => END_REASONS[reason ?? ''] ?? 'Call ended';
