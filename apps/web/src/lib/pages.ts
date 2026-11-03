import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardDetail, BoardSummary, CreateBoardInput, CreatePageInput, PageDetail, PagesHome, PageSummary, UpdatePageInput,
} from '@teamsphere/shared';
import { api } from './api';

export const ck = {
  pages: ['pages'] as const,
  home: ['pages', 'home'] as const,
  page: (id: string) => ['pages', 'page', id] as const,
  channel: (channelId: string) => ['pages', 'channel', channelId] as const,
  meeting: (meetingId: string) => ['pages', 'meeting', meetingId] as const,
  boards: ['boards'] as const,
  board: (id: string) => ['boards', id] as const,
};

export const usePagesHome = () => useQuery({ queryKey: ck.home, queryFn: () => api<PagesHome>('/pages') });
export const usePage = (id: string | null) => useQuery({ queryKey: ck.page(id ?? ''), queryFn: () => api<PageDetail>(`/pages/${id}`), enabled: !!id });
export const useChannelPages = (channelId: string) => useQuery({ queryKey: ck.channel(channelId), queryFn: () => api<PageSummary[]>(`/pages/channel/${channelId}`) });
/** Opens (and on first use creates) a meeting's notes page. */
export const useMeetingNotes = (meetingId: string) => useQuery({ queryKey: ck.meeting(meetingId), queryFn: () => api<PageDetail>(`/pages/meeting/${meetingId}`) });
export const useBoards = () => useQuery({ queryKey: ck.boards, queryFn: () => api<BoardSummary[]>('/whiteboards') });
export const useBoard = (id: string | null) => useQuery({ queryKey: ck.board(id ?? ''), queryFn: () => api<BoardDetail>(`/whiteboards/${id}`), enabled: !!id });

/** Mutation that refreshes page and board lists afterwards (realtime does the same for everyone else). */
export function useCollabMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ck.pages }), qc.invalidateQueries({ queryKey: ck.boards })]),
  });
}

export const pagesApi = {
  create: (input: CreatePageInput) => api<PageDetail>('/pages', { method: 'POST', json: input }),
  update: (id: string, input: UpdatePageInput) => api<PageDetail>(`/pages/${id}`, { method: 'PATCH', json: input }),
  remove: (id: string) => api(`/pages/${id}`, { method: 'DELETE' }),
  addMembers: (id: string, userIds: string[]) => api<PageDetail>(`/pages/${id}/members`, { method: 'POST', json: { userIds } }),
  removeMember: (id: string, userId: string) => api(`/pages/${id}/members/${userId}`, { method: 'DELETE' }),
};

export const boardsApi = {
  create: (input: CreateBoardInput) => api<BoardDetail>('/whiteboards', { method: 'POST', json: input }),
  rename: (id: string, title: string) => api<BoardDetail>(`/whiteboards/${id}`, { method: 'PATCH', json: { title } }),
  remove: (id: string) => api(`/whiteboards/${id}`, { method: 'DELETE' }),
  addMembers: (id: string, userIds: string[]) => api<BoardDetail>(`/whiteboards/${id}/members`, { method: 'POST', json: { userIds } }),
  removeMember: (id: string, userId: string) => api(`/whiteboards/${id}/members/${userId}`, { method: 'DELETE' }),
};

export interface PageNode extends PageSummary {
  children: PageNode[];
}

/** Flat pages → sorted tree (unit-tested). Pages whose parent isn't in the list become roots. */
export function buildTree(pages: PageSummary[]): PageNode[] {
  const nodes = new Map<string, PageNode>(pages.map((p) => [p.id, { ...p, children: [] }]));
  const roots: PageNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (list: PageNode[]) => {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    list.forEach((n) => sort(n.children));
    return list;
  };
  return sort(roots);
}

/** Starting content for meeting notes. */
export const MEETING_NOTES_TEMPLATE =
  '<h2>Agenda</h2><ul><li><p></p></li></ul><h2>Notes</h2><p></p><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
