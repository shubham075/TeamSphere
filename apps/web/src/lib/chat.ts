import { InfiniteData, QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityItem, AttachmentInfo, ConversationInfo, CreateConversationInput, MessageInfo, MessagePage, ReactionSummary,
} from '@teamsphere/shared';
import { api } from './api';
import { useAuth } from './auth-store';

export const qk = {
  conversations: ['conversations'] as const,
  messages: (id: string) => ['messages', id] as const,
  activity: ['activity'] as const,
};

type Pages = InfiniteData<MessagePage, string | null>;

// ------------------------------------------------------------------ queries

export function useConversations() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  return useQuery({ queryKey: qk.conversations, queryFn: () => api<ConversationInfo[]>('/conversations'), enabled: signedIn });
}

export function useConversation(id: string) {
  const { data, ...rest } = useConversations();
  return { conversation: data?.find((c) => c.id === id), ...rest };
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: qk.messages(conversationId),
    queryFn: ({ pageParam }) =>
      api<MessagePage>(`/conversations/${conversationId}/messages${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: Infinity, // kept fresh by realtime events
  });
}

export function useActivity() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  return useQuery({ queryKey: qk.activity, queryFn: () => api<ActivityItem[]>('/activity'), enabled: signedIn });
}

// ------------------------------------------------------------------ mutations

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationInput) => api<ConversationInfo>('/conversations', { method: 'POST', json: input }),
    onSuccess: (c) => upsertConversation(qc, c),
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; parentId?: string; importance?: MessageInfo['importance']; attachments?: AttachmentInfo[]; clientId: string }) =>
      api<MessageInfo>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        json: {
          body: input.body,
          parentId: input.parentId,
          importance: input.importance ?? 'normal',
          attachmentIds: input.attachments?.map((a) => a.id) ?? [],
          clientId: input.clientId,
        },
      }),
    onMutate: (input) => {
      const me = useAuth.getState().user;
      const optimistic: MessageInfo & { pending: true } = {
        id: `temp-${input.clientId}`,
        clientId: input.clientId,
        conversationId,
        author: me ? { id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl } : null,
        parent: null,
        type: 'text',
        body: input.body,
        importance: input.importance ?? 'normal',
        reactions: [],
        attachments: input.attachments ?? [],
        mentionIds: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        pending: true,
      };
      upsertMessage(qc, optimistic);
    },
    onSuccess: (message) => upsertMessage(qc, message),
    onError: (_e, input) => markFailed(qc, conversationId, input.clientId),
  });
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api<MessageInfo>(`/messages/${id}`, { method: 'PATCH', json: { body } }),
    onSuccess: (m) => upsertMessage(qc, m),
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<MessageInfo>(`/messages/${id}`, { method: 'DELETE' }),
    onSuccess: (m) => upsertMessage(qc, m),
  });
}

export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, emoji, add }: { message: MessageInfo; emoji: string; add: boolean }) =>
      api<{ reactions: ReactionSummary[] }>(`/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`, {
        method: add ? 'PUT' : 'DELETE',
      }),
    onSuccess: (res, { message }) => setReactions(qc, message.conversationId, message.id, res.reactions),
  });
}

export function useMemberSettings(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { muted?: boolean; pinned?: boolean; hidden?: boolean }) =>
      api<ConversationInfo>(`/conversations/${conversationId}/me`, { method: 'PATCH', json: input }),
    onSuccess: (c) => upsertConversation(qc, c),
  });
}

export async function uploadAttachment(conversationId: string, file: File): Promise<AttachmentInfo> {
  const form = new FormData();
  form.append('file', file, file.name || 'pasted-image.png');
  return api<AttachmentInfo>(`/conversations/${conversationId}/attachments`, { method: 'POST', body: form });
}

// ------------------------------------------------------------------ cache helpers (also used by realtime events)

export function sortConversations(list: ConversationInfo[]) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export function upsertConversation(qc: QueryClient, c: ConversationInfo) {
  qc.setQueryData<ConversationInfo[]>(qk.conversations, (list) =>
    list ? sortConversations([c, ...list.filter((x) => x.id !== c.id)]) : list,
  );
}

export function removeConversation(qc: QueryClient, id: string) {
  qc.setQueryData<ConversationInfo[]>(qk.conversations, (list) => list?.filter((c) => c.id !== id));
  qc.removeQueries({ queryKey: qk.messages(id) });
}

export function patchConversation(qc: QueryClient, id: string, patch: (c: ConversationInfo) => ConversationInfo) {
  qc.setQueryData<ConversationInfo[]>(qk.conversations, (list) => (list ? sortConversations(list.map((c) => (c.id === id ? patch(c) : c))) : list));
}

/** Inserts or replaces a message (matching by id, or by clientId for the sender's optimistic copy). */
export function upsertMessage(qc: QueryClient, m: MessageInfo) {
  qc.setQueryData<Pages>(qk.messages(m.conversationId), (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((p) => ({
      ...p,
      messages: p.messages.map((x) => {
        if (x.id === m.id || (m.clientId && x.clientId === m.clientId)) {
          found = true;
          return m;
        }
        return x;
      }),
    }));
    if (!found) pages[0] = { ...pages[0], messages: [...pages[0].messages, m] };
    return { ...data, pages };
  });
  patchConversation(qc, m.conversationId, (c) =>
    !c.lastMessage || c.lastMessage.id === m.id || m.createdAt >= c.lastMessage.createdAt
      ? { ...c, lastMessage: m, lastMessageAt: m.createdAt > c.lastMessageAt ? m.createdAt : c.lastMessageAt }
      : c,
  );
}

export function setReactions(qc: QueryClient, conversationId: string, messageId: string, reactions: ReactionSummary[]) {
  qc.setQueryData<Pages>(qk.messages(conversationId), (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, messages: p.messages.map((x) => (x.id === messageId ? { ...x, reactions } : x)) })) }
      : data,
  );
}

function markFailed(qc: QueryClient, conversationId: string, clientId: string) {
  qc.setQueryData<Pages>(qk.messages(conversationId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            messages: p.messages.map((x) => (x.clientId === clientId ? ({ ...x, failed: true, pending: false } as MessageInfo) : x)),
          })),
        }
      : data,
  );
}

// ------------------------------------------------------------------ display helpers

/** Chat title: the group name, the other person's name, or a list of member names. */
export function conversationTitle(c: ConversationInfo, meId: string | undefined): string {
  if (c.title) return c.title;
  if (c.type === 'self') return 'You';
  const others = c.members.filter((m) => m.user.id !== meId).map((m) => m.user.displayName);
  if (!others.length) return 'Chat';
  return c.type === 'direct' ? others[0] : others.length <= 3 ? others.join(', ') : `${others.slice(0, 3).join(', ')} +${others.length - 3}`;
}

export function otherMember(c: ConversationInfo, meId: string | undefined) {
  return c.members.find((m) => m.user.id !== meId)?.user ?? c.members[0]?.user;
}

export function formatListTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
