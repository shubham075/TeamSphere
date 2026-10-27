import { create } from 'zustand';
import type { PublicUser } from '@teamsphere/shared';

type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

interface AuthState {
  status: AuthStatus;
  /** Kept in memory only; the refresh token lives in an httpOnly cookie. */
  accessToken: string | null;
  user: PublicUser | null;
  setSession: (accessToken: string, user: PublicUser) => void;
  setUser: (user: PublicUser) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ status: 'signed-in', accessToken, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: 'signed-out', accessToken: null, user: null }),
}));
