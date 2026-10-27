import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ManualPresence, PresenceInfo, PublicUser } from '@teamsphere/shared';
import { api } from './api';
import { useAuth } from './auth-store';

export type Me = PublicUser & { presence: PresenceInfo };

export function useMe() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/users/me'), enabled: signedIn });
}

export function useSetPresence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: ManualPresence; until?: string | null }) =>
      api<PresenceInfo>('/users/me/presence', { method: 'PUT', json: input }),
    onSuccess: (presence) => qc.setQueryData<Me>(['me'], (me) => (me ? { ...me, presence } : me)),
  });
}

export function useSetStatusMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: string | null; expiresAt?: string | null }) =>
      api<PresenceInfo>('/users/me/status-message', { method: 'PUT', json: input }),
    onSuccess: (presence) => qc.setQueryData<Me>(['me'], (me) => (me ? { ...me, presence } : me)),
  });
}
