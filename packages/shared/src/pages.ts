import { z } from 'zod';

/** Phase 8b: co-edited Pages (personal, channel wiki, meeting notes) and standalone whiteboards. */

export type PageOwnerType = 'user' | 'channel' | 'meeting';
export type BoardOwnerType = 'user' | 'channel';
/** Same scale as plans: owners manage (share, delete), editors edit, viewers read. */
export type CollabRole = 'owner' | 'edit' | 'view';

/**
 * Yjs documents synced over the existing Socket.IO connection. `doc` is `page:<id>` or `board:<id>`.
 * join → { ok, state, readOnly }; update ↔ incremental Yjs updates; awareness = cursors (relayed, never stored).
 */
export const COLLAB_WS_EVENTS = {
  join: 'collab:join',
  update: 'collab:update',
  awareness: 'collab:awareness',
  leave: 'collab:leave',
  /** Page or board lists the user can see changed (created, renamed, moved, shared, deleted): refetch. */
  changed: 'collab:changed',
} as const;

export type CollabDocKind = 'page' | 'board';
export const collabDocKey = (kind: CollabDocKind, id: string) => `${kind}:${id}`;

export interface CollabJoinResult {
  ok: boolean;
  state?: ArrayBuffer | Uint8Array;
  readOnly?: boolean;
  error?: string;
}

export interface CollabChangedEvent {
  kind: CollabDocKind;
  ids: string[];
}

// ---------- requests ----------

const title = z.string().trim().min(1, 'Enter a title').max(200);

export const createPageSchema = z.object({
  title: title.default('Untitled'),
  /** A subpage of this page (inherits its owner and access). */
  parentId: z.string().min(1).nullable().default(null),
  /** A channel wiki page; omitted with no parent = a personal page. */
  channelId: z.string().min(1).nullable().default(null),
  memberIds: z.array(z.string().min(1)).max(100).default([]),
});
export type CreatePageInput = z.input<typeof createPageSchema>;

export const updatePageSchema = z.object({
  title: title.optional(),
  icon: z.string().max(8).nullable().optional(),
  /** Move under another page of the same tree owner (null = top level). */
  parentId: z.string().min(1).nullable().optional(),
  position: z.number().finite().optional(),
});
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

export const createBoardSchema = z.object({
  title: title.default('Untitled board'),
  channelId: z.string().min(1).nullable().default(null),
  memberIds: z.array(z.string().min(1)).max(100).default([]),
  addTab: z.boolean().default(false),
});
export type CreateBoardInput = z.input<typeof createBoardSchema>;

export const updateBoardSchema = z.object({ title: title.optional() });
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;

export const collabMembersSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(100) });
export type CollabMembersInput = z.infer<typeof collabMembersSchema>;

// ---------- responses ----------

export interface CollabPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PageSummary {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  rootId: string;
  position: number;
  /** First characters of the text, for lists. */
  excerpt: string;
  updatedAt: string;
  updatedBy: CollabPerson | null;
}

export interface PageLocation {
  ownerType: PageOwnerType;
  /** Channel pages: the channel; meeting notes: the meeting. */
  channel: { id: string; name: string; teamName: string } | null;
  meeting: { id: string; title: string } | null;
}

export interface PageDetail extends PageSummary, PageLocation {
  role: CollabRole;
  breadcrumbs: { id: string; title: string }[];
  children: PageSummary[];
  /** Personal pages: the owner and members of the tree's root page. */
  owner: CollabPerson | null;
  members: CollabPerson[];
  createdBy: CollabPerson | null;
  createdAt: string;
}

/** The pages side pane: my pages, pages shared with me, and the trees of the channels I'm in. */
export interface PagesHome {
  mine: PageSummary[];
  shared: (PageSummary & { owner: CollabPerson | null })[];
  recent: (PageSummary & PageLocation)[];
}

export interface BoardSummary {
  id: string;
  title: string;
  ownerType: BoardOwnerType | 'meeting';
  channel: { id: string; name: string; teamName: string } | null;
  role: CollabRole;
  updatedAt: string;
  updatedBy: CollabPerson | null;
}

export interface BoardDetail extends BoardSummary {
  owner: CollabPerson | null;
  members: CollabPerson[];
}
