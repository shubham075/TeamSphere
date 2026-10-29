import { InfiniteData, QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelInfo, ChannelMemberInfo, ChannelNotes, ChannelPost, ChannelPostPage, CreateChannelInput, CreateTeamInput,
  MessageInfo, ReactionSummary, TagInfo, TeamInfo, TeamMemberInfo,
} from '@teamsphere/shared';
import { api } from './api';
import { useAuth } from './auth-store';

export const tk = {
  teams: ['teams'] as const,
  posts: (channelId: string) => ['channel-posts', channelId] as const,
  members: (teamId: string) => ['team-members', teamId] as const,
  channelMembers: (channelId: string) => ['channel-members', channelId] as const,
  tags: (teamId: string) => ['team-tags', teamId] as const,
  notes: (channelId: string) => ['channel-notes', channelId] as const,
  files: (channelId: string) => ['channel-files', channelId] as const,
};

type Pages = InfiniteData<ChannelPostPage, string | null>;

// ------------------------------------------------------------------ queries

export function useTeams() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  return useQuery({ queryKey: tk.teams, queryFn: () => api<TeamInfo[]>('/teams'), enabled: signedIn });
}

export function useChannel(channelId: string) {
  const { data, ...rest } = useTeams();
  for (const team of data ?? []) {
    const channel = team.channels.find((c) => c.id === channelId);
    if (channel) return { channel, team, ...rest };
  }
  return { channel: undefined, team: undefined, ...rest };
}

/** Channels with unread posts (not muted), for the rail badge and the window title. */
export function useTeamsUnread() {
  const { data } = useTeams();
  return (data ?? []).flatMap((t) => t.channels).filter((c) => c.unread > 0 && !c.muted).length;
}

export function usePosts(channelId: string) {
  return useInfiniteQuery({
    queryKey: tk.posts(channelId),
    queryFn: ({ pageParam }) => api<ChannelPostPage>(`/channels/${channelId}/posts${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: Infinity, // kept fresh by realtime events
  });
}

export function useTeamMembers(teamId: string) {
  return useQuery({ queryKey: tk.members(teamId), queryFn: () => api<TeamMemberInfo[]>(`/teams/${teamId}/members`) });
}

export function useChannelMembers(channelId: string) {
  return useQuery({ queryKey: tk.channelMembers(channelId), queryFn: () => api<ChannelMemberInfo[]>(`/channels/${channelId}/members`) });
}

export function useTags(teamId: string | undefined) {
  return useQuery({ queryKey: tk.tags(teamId ?? ''), queryFn: () => api<TagInfo[]>(`/teams/${teamId}/tags`), enabled: !!teamId });
}

// ------------------------------------------------------------------ mutations

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => api<TeamInfo>('/teams', { method: 'POST', json: input }),
    onSuccess: (t) => upsertTeam(qc, t),
  });
}

export function useCreateChannel(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => api<ChannelInfo>(`/teams/${teamId}/channels`, { method: 'POST', json: input }),
    onSuccess: (c) => upsertChannel(qc, c),
  });
}

export function useChannelSettings(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { pinned?: boolean; muted?: boolean }) => api<ChannelInfo>(`/channels/${channelId}/me`, { method: 'PATCH', json: input }),
    onSuccess: (c) => upsertChannel(qc, c),
  });
}

export function useCreatePost(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      body: string;
      subject?: string;
      announcement?: boolean;
      headerAttachmentId?: string;
      importance?: MessageInfo['importance'];
      attachmentIds?: string[];
      alsoChannelIds?: string[];
      clientId: string;
    }) => api<ChannelPost[]>(`/channels/${channelId}/posts`, { method: 'POST', json: input }),
    onSuccess: (posts) => {
      for (const p of posts) upsertPost(qc, channelIdOf(qc, p.root.conversationId) ?? channelId, p);
    },
  });
}

export function useCreateReply(channelId: string, rootId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; attachmentIds?: string[]; clientId: string }) =>
      api<MessageInfo>(`/channels/${channelId}/posts/${rootId}/replies`, { method: 'POST', json: input }),
    onSuccess: (m) => upsertReply(qc, channelId, rootId, m),
  });
}

export function useModeratorDelete(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api<MessageInfo>(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: (m) => updateChannelMessage(qc, m),
  });
}

export function useSaveNotes(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { notes: string; version: number }) => api<ChannelNotes>(`/channels/${channelId}/notes`, { method: 'PUT', json: input }),
    onSuccess: (n) => qc.setQueryData(tk.notes(channelId), n),
  });
}

export function markChannelRead(qc: QueryClient, channelId: string) {
  patchChannel(qc, channelId, (c) => ({ ...c, unread: 0, unreadMentions: 0 }));
  void api<ChannelInfo>(`/channels/${channelId}/read`, { method: 'POST' }).catch(() => undefined);
}

// ------------------------------------------------------------------ cache helpers (also used by realtime events)

export function upsertTeam(qc: QueryClient, team: TeamInfo) {
  qc.setQueryData<TeamInfo[]>(tk.teams, (list) => (list ? [...list.filter((t) => t.id !== team.id), team].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)) : list));
}

export function upsertChannel(qc: QueryClient, channel: ChannelInfo) {
  qc.setQueryData<TeamInfo[]>(tk.teams, (list) => {
    if (!list) return list;
    const found = list.some((t) => t.channels.some((c) => c.id === channel.id));
    if (!found && !list.some((t) => t.id === channel.teamId)) {
      void qc.invalidateQueries({ queryKey: tk.teams });
      return list;
    }
    return list.map((t) =>
      t.channels.some((c) => c.id === channel.id)
        ? { ...t, channels: t.channels.map((c) => (c.id === channel.id ? { ...channel, sharedFrom: c.sharedFrom } : c)) }
        : !found && t.id === channel.teamId
          ? { ...t, channels: [...t.channels, channel] }
          : t,
    );
  });
}

export function patchChannel(qc: QueryClient, channelId: string, patch: (c: ChannelInfo) => ChannelInfo) {
  qc.setQueryData<TeamInfo[]>(tk.teams, (list) =>
    list?.map((t) => (t.channels.some((c) => c.id === channelId) ? { ...t, channels: t.channels.map((c) => (c.id === channelId ? patch(c) : c)) } : t)),
  );
}

export function channelIdOf(qc: QueryClient, conversationId: string): string | undefined {
  const list = qc.getQueryData<TeamInfo[]>(tk.teams);
  for (const t of list ?? []) for (const c of t.channels) if (c.conversationId === conversationId) return c.id;
  return undefined;
}

export function findChannel(list: TeamInfo[] | undefined, pred: (c: ChannelInfo) => boolean) {
  for (const t of list ?? []) for (const c of t.channels) if (pred(c)) return { team: t, channel: c };
  return undefined;
}

function mapPosts(qc: QueryClient, channelId: string, fn: (posts: ChannelPost[], first: boolean) => ChannelPost[]) {
  qc.setQueryData<Pages>(tk.posts(channelId), (data) =>
    data ? { ...data, pages: data.pages.map((p, i) => ({ ...p, posts: fn(p.posts, i === 0) })) } : data,
  );
}

/** Inserts a new post (newest page) or replaces an existing one (matching id, or the sender's clientId). */
export function upsertPost(qc: QueryClient, channelId: string, post: ChannelPost) {
  let found = false;
  mapPosts(qc, channelId, (posts) =>
    posts.map((p) => {
      if (p.root.id === post.root.id || (post.root.clientId && p.root.clientId === post.root.clientId)) {
        found = true;
        return { ...post, replies: post.replies.length >= p.replies.length ? post.replies : p.replies };
      }
      return p;
    }),
  );
  if (!found) mapPosts(qc, channelId, (posts, first) => (first ? [...posts, post] : posts));
}

export function upsertReply(qc: QueryClient, channelId: string, rootId: string, reply: MessageInfo) {
  mapPosts(qc, channelId, (posts) =>
    posts.map((p) => {
      if (p.root.id !== rootId) return p;
      const exists = p.replies.some((r) => r.id === reply.id || (reply.clientId && r.clientId === reply.clientId));
      return {
        ...p,
        replies: exists ? p.replies.map((r) => (r.id === reply.id || (reply.clientId && r.clientId === reply.clientId) ? reply : r)) : [...p.replies, reply],
      };
    }),
  );
}

/** Edits and deletes arrive as chat `message:updated` events keyed by conversation. */
export function updateChannelMessage(qc: QueryClient, m: MessageInfo) {
  const channelId = channelIdOf(qc, m.conversationId);
  if (!channelId) return;
  mapPosts(qc, channelId, (posts) =>
    posts.map((p) =>
      p.root.id === m.id
        ? { ...p, root: { ...m, attachments: m.attachments.filter((a) => !p.meta.headerImageUrl?.includes(`/attachments/${a.id}/`)) }, meta: m.deletedAt ? { ...p.meta, subject: null, announcement: false, headerImageUrl: null } : p.meta }
        : p.replies.some((r) => r.id === m.id)
          ? { ...p, replies: p.replies.map((r) => (r.id === m.id ? m : r)) }
          : p,
    ),
  );
}

export function setChannelReactions(qc: QueryClient, conversationId: string, messageId: string, reactions: ReactionSummary[]) {
  const channelId = channelIdOf(qc, conversationId);
  if (!channelId) return;
  mapPosts(qc, channelId, (posts) =>
    posts.map((p) =>
      p.root.id === messageId
        ? { ...p, root: { ...p.root, reactions } }
        : p.replies.some((r) => r.id === messageId)
          ? { ...p, replies: p.replies.map((r) => (r.id === messageId ? { ...r, reactions } : r)) }
          : p,
    ),
  );
}

// ------------------------------------------------------------------ display helpers

export const TEAM_PALETTE = ['#5b5bd6', '#0f7b8a', '#b4467d', '#8a5a00', '#3b7d23', '#a4373a', '#6b4fbb', '#2b6cb0'];

export function teamColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length];
}

export function teamInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}
