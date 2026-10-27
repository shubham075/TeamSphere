import { create } from 'zustand';
import type { PresenceStatus } from '@teamsphere/shared';

interface Typist {
  userId: string;
  displayName: string;
  until: number;
}

interface ChatUiState {
  /** Conversation currently on screen (null when none). */
  activeConversationId: string | null;
  presence: Record<string, PresenceStatus>;
  typing: Record<string, Typist[]>;
  setActive: (id: string | null) => void;
  setPresence: (entries: Record<string, PresenceStatus>) => void;
  addTyping: (conversationId: string, userId: string, displayName: string) => void;
  pruneTyping: () => void;
}

const TYPING_TTL = 4000;

export const useChatUi = create<ChatUiState>((set, get) => ({
  activeConversationId: null,
  presence: {},
  typing: {},
  setActive: (id) => set({ activeConversationId: id }),
  setPresence: (entries) => set({ presence: { ...get().presence, ...entries } }),
  addTyping: (conversationId, userId, displayName) => {
    const others = (get().typing[conversationId] ?? []).filter((t) => t.userId !== userId);
    set({ typing: { ...get().typing, [conversationId]: [...others, { userId, displayName, until: Date.now() + TYPING_TTL }] } });
  },
  pruneTyping: () => {
    const now = Date.now();
    const next: Record<string, Typist[]> = {};
    let changed = false;
    for (const [id, list] of Object.entries(get().typing)) {
      const alive = list.filter((t) => t.until > now);
      if (alive.length !== list.length) changed = true;
      if (alive.length) next[id] = alive;
    }
    if (changed) set({ typing: next });
  },
}));

/** Live presence for a user, falling back to the value that came with the data. */
export function usePresence(userId: string | undefined, fallback: PresenceStatus = 'offline'): PresenceStatus {
  return useChatUi((s) => (userId ? (s.presence[userId] ?? fallback) : fallback));
}
