import type { FileRole, FileShareRole } from '@teamsphere/shared';
import { RECYCLE_BIN_DAYS } from '@teamsphere/shared';

/** Pure rules for file permissions and versions, kept free of Prisma so they can be unit-tested. */

const RANK: Record<FileRole, number> = { view: 1, edit: 2, owner: 3 };

export function maxRole(...roles: (FileRole | null | undefined)[]): FileRole | null {
  let best: FileRole | null = null;
  for (const r of roles) if (r && (!best || RANK[r] > RANK[best])) best = r;
  return best;
}

export function atLeast(role: FileRole | null, needed: FileRole): boolean {
  return !!role && RANK[role] >= RANK[needed];
}

/** One item on the path from an item up to its library root, with the grants set directly on it. */
export interface AccessNode {
  id: string;
  shares: { userId: string; role: FileShareRole }[];
  links: { role: FileShareRole; revokedAt: Date | null; usedBy: string[] }[];
}

/**
 * The caller's access to an item: the best of their library role (owner / team member), direct shares and
 * org-wide links they have opened, on the item or any folder above it. Revoked links grant nothing.
 * `presentedLink` covers someone opening a link for the first time.
 */
export function effectiveRole(input: {
  userId: string;
  libraryRole: FileRole | null;
  chain: AccessNode[];
  presentedLink?: { role: FileShareRole; revokedAt: Date | null; itemIdOnChain: string } | null;
}): FileRole | null {
  const roles: (FileRole | null)[] = [input.libraryRole];
  for (const node of input.chain) {
    for (const s of node.shares) if (s.userId === input.userId) roles.push(s.role);
    for (const l of node.links) if (!l.revokedAt && l.usedBy.includes(input.userId)) roles.push(l.role);
  }
  const link = input.presentedLink;
  if (link && !link.revokedAt && input.chain.some((n) => n.id === link.itemIdOnChain)) roles.push(link.role);
  return maxRole(...roles);
}

/** Library-level role. Personal libraries: only the owner. Team/channel libraries are resolved once Phase 2 lands. */
export function personalLibraryRole(userId: string, ownerType: string, ownerId: string): FileRole | null {
  return ownerType === 'user' && ownerId === userId ? 'owner' : null;
}

export type FileAction =
  | 'read' // list, preview, download, version history, copy elsewhere
  | 'write' // upload, new version, rename, move, delete to recycle bin, restore a version
  | 'share' // share with people, create/revoke links, decide access requests
  | 'purge'; // restore from / permanently delete in the recycle bin

const NEEDED: Record<FileAction, FileRole> = { read: 'view', write: 'edit', share: 'edit', purge: 'owner' };

export function can(role: FileRole | null, action: FileAction): boolean {
  return atLeast(role, NEEDED[action]);
}

/** What an upload of `name` into a folder does, given the active item with that name there (if any). */
export function planUpload(existing: { kind: 'file' | 'folder' } | null): 'create' | 'new-version' | 'conflict' {
  if (!existing) return 'create';
  return existing.kind === 'file' ? 'new-version' : 'conflict';
}

export function nextVersion(versions: { version: number }[]): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

/**
 * Restoring version N makes a new latest version with N's content (history is never rewritten).
 * Returns null when N already is the current version.
 */
export function planRestore(versions: { id: string; version: number }[], restoreId: string) {
  const target = versions.find((v) => v.id === restoreId);
  if (!target) throw new Error('Unknown version');
  const current = nextVersion(versions) - 1;
  if (target.version === current) return null;
  return { from: target.version, version: current + 1 };
}

/** "Report.pdf" → "Report (1).pdf", "Report (2).pdf"… until it doesn't clash (case-insensitive, like Windows). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export function purgeCutoff(now = new Date()): Date {
  return new Date(now.getTime() - RECYCLE_BIN_DAYS * 24 * 60 * 60 * 1000);
}
