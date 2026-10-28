import { create } from 'zustand';
import type { OutOfOfficeInfo, PresenceStatus } from '@teamsphere/shared';

export interface PresenceDetails {
  statusMessage: string | null;
  outOfOffice: OutOfOfficeInfo | null;
}

interface Typist {
  userId: string;
  displayName: string;
  until: number;
}

interface ChatUiState {
  /** Conversation currently on screen (null when none). */
  activeConversationId: string | null;
  /** Chat the user just marked unread while viewing it: don't auto-mark it read until they act in it again. */
  readPausedFor: string | null;
  pauseRead: (id: string | null) => void;
  presence: Record<string, PresenceStatus>;
  /** Live status message / out-of-office per user, from presence events. */
  details: Record<string, PresenceDetails>;
  typing: Record<string, Typist[]>;
  setActive: (id: string | null) => void;
  setPresence: (entries: Record<string, PresenceStatus>) => void;
  setDetails: (userId: string, details: PresenceDetails) => void;
  addTyping: (conversationId: string, userId: string, displayName: string) => void;
  pruneTyping: () => void;
}

const TYPING_TTL = 4000;

export const useChatUi = create<ChatUiState>((set, get) => ({
  activeConversationId: null,
  readPausedFor: null,
  pauseRead: (id) => set({ readPausedFor: id }),
  presence: {},
  details: {},
  typing: {},
  setActive: (id) => set({ activeConversationId: id }),
  setPresence: (entries) => set({ presence: { ...get().presence, ...entries } }),
  setDetails: (userId, details) => set({ details: { ...get().details, [userId]: details } }),
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

/** Live status message / out of office for a user, falling back to the value that came with the data. */
export function usePresenceDetails(userId: string | undefined, fallback: PresenceDetails): PresenceDetails {
  // Select the stored object (stable reference) and apply the fallback outside the selector.
  const live = useChatUi((s) => (userId ? s.details[userId] : undefined));
  return live ?? fallback;
}

/** Live presence for a user, falling back to the value that came with the data. */
export function usePresence(userId: string | undefined, fallback: PresenceStatus = 'offline'): PresenceStatus {
  return useChatUi((s) => (userId ? (s.presence[userId] ?? fallback) : fallback));
}
