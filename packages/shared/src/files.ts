import { z } from 'zod';

/** Phase 6: file libraries (My files today; team and channel libraries once Phase 2 lands). */

export const MAX_FILE_BYTES = 250 * 1024 * 1024;
/** Deleted items stay in the recycle bin this long before they are purged. */
export const RECYCLE_BIN_DAYS = 93;

export type FileOwnerType = 'user' | 'team' | 'channel';
export type FileItemKind = 'file' | 'folder';
/** Access granted to other people. The library owner always has full control ("owner"). */
export type FileShareRole = 'view' | 'edit';
export type FileRole = FileShareRole | 'owner';

/** Socket.IO events for the Files app (kept here rather than in WS_EVENTS so the module stays self-contained). */
export const FILE_WS_EVENTS = {
  /** Something visible to the user changed (upload, rename, share…): refetch file views. */
  changed: 'files:changed',
  /** A new access request for an item the user manages. */
  accessRequest: 'files:access_request',
} as const;

/** Activity feed entry types produced by the Files app. */
export const FILE_ACTIVITY_TYPES = ['file_shared', 'file_access_request', 'file_access_approved', 'file_access_denied'] as const;
export type FileActivityType = (typeof FILE_ACTIVITY_TYPES)[number];

// ---------- requests ----------

/** Names that are valid on Windows and in URLs: no path separators, reserved characters or trailing dots/spaces. */
export const fileNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(255)
  .refine((n) => !/[\\/:*?"<>|\u0000-\u001f]/.test(n), 'Names can’t contain \\ / : * ? " < > |')
  .refine((n) => !/[. ]$/.test(n) && n !== '.' && n !== '..', 'Names can’t end with a dot or space');

export const createFolderSchema = z.object({ parentId: z.string().nullable().default(null), name: fileNameSchema });
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const renameFileSchema = z.object({ name: fileNameSchema });
export type RenameFileInput = z.infer<typeof renameFileSchema>;

/** Move or copy into a folder; `parentId: null` is the root of the user's own library. */
export const moveFileSchema = z.object({ parentId: z.string().nullable() });
export type MoveFileInput = z.infer<typeof moveFileSchema>;

export const shareFileSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  role: z.enum(['view', 'edit']).default('view'),
  /** Optional note included in the recipients' activity entry. */
  message: z.string().trim().max(500).optional(),
});
export type ShareFileInput = z.infer<typeof shareFileSchema>;

export const createShareLinkSchema = z.object({ role: z.enum(['view', 'edit']).default('view') });
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

export const accessRequestSchema = z.object({
  role: z.enum(['view', 'edit']).default('view'),
  message: z.string().trim().max(500).optional(),
});
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

export const decideAccessRequestSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  /** Approve with a different role than requested. */
  role: z.enum(['view', 'edit']).optional(),
});
export type DecideAccessRequestInput = z.infer<typeof decideAccessRequestSchema>;

// ---------- responses ----------

export interface FilePerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface FileItemInfo {
  id: string;
  kind: FileItemKind;
  name: string;
  mimeType: string | null;
  size: number;
  version: number;
  parentId: string | null;
  ownerType: FileOwnerType;
  ownerId: string;
  /** The caller's access to this item. */
  role: FileRole;
  /** Shared with anyone besides the owner (people or an active link). */
  shared: boolean;
  createdBy: FilePerson | null;
  modifiedBy: FilePerson | null;
  createdAt: string;
  modifiedAt: string;
  /** Recycle bin only. */
  deletedAt?: string | null;
  deletedBy?: FilePerson | null;
  /** Shared with me: who shared it. Recent: when I last opened it. */
  sharedBy?: FilePerson | null;
  accessedAt?: string;
  /** Folder path shown in search, recent and recycle bin results, e.g. "My files / Reports". */
  location?: string;
}

export interface FileCrumb {
  id: string | null;
  name: string;
}

export interface FolderListing {
  /** Which top-level view the breadcrumbs start from: your own library or "Shared with me". */
  root: 'my' | 'shared';
  /** null at the library root. */
  folder: FileItemInfo | null;
  breadcrumbs: FileCrumb[];
  role: FileRole;
  items: FileItemInfo[];
}

/** Single item with signed content URLs (opening it is audited and counts as "recent"). */
export interface FileDetail extends FileItemInfo {
  /** Inline URL for previews (files only). */
  contentUrl: string | null;
  downloadUrl: string | null;
  breadcrumbs: FileCrumb[];
}

export interface FileVersionInfo {
  id: string;
  version: number;
  size: number;
  mimeType: string;
  createdBy: FilePerson | null;
  createdAt: string;
  current: boolean;
  downloadUrl: string;
}

export interface FileShareInfo {
  user: FilePerson;
  role: FileShareRole;
  /** Inherited from a parent folder rather than set on this item. */
  inheritedFrom: { id: string; name: string } | null;
  createdAt: string;
}

export interface ShareLinkInfo {
  id: string;
  token: string;
  role: FileShareRole;
  createdBy: FilePerson | null;
  createdAt: string;
  inheritedFrom: { id: string; name: string } | null;
}

export interface AccessRequestInfo {
  id: string;
  item: { id: string; name: string; kind: FileItemKind };
  requester: FilePerson;
  role: FileShareRole;
  message: string | null;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
}

export interface FileSharingInfo {
  owner: FilePerson | null;
  shares: FileShareInfo[];
  links: ShareLinkInfo[];
  requests: AccessRequestInfo[];
}

/** Returned with HTTP 403 when the caller can't open an item, so the UI can offer "Request access". */
export interface FileNoAccessInfo {
  code: 'no_access';
  name: string | null;
  pendingRequest: boolean;
}

export interface ChatFileInfo {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  sharedBy: FilePerson | null;
  conversationId: string;
  conversationTitle: string;
  createdAt: string;
}

export interface FilesChangedEvent {
  itemIds: string[];
}
