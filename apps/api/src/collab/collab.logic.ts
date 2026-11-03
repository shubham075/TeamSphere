import * as Y from 'yjs';
import type { CollabRole, FileRole } from '@teamsphere/shared';

/** Pure rules for Pages and Boards, kept free of Prisma so they can be unit-tested. */

/**
 * Role in a personal item (page tree or board): the owner manages it, members edit. Channel items follow the
 * channel's document-library role; meeting notes: anyone in the meeting edits, organizers manage.
 */
export function collabRole(p: {
  userId: string;
  ownerType: 'user' | 'channel' | 'meeting';
  ownerId: string;
  memberIds: string[];
  channelRole?: FileRole | null;
  meeting?: { allowed: boolean; moderator: boolean } | null;
}): CollabRole | null {
  switch (p.ownerType) {
    case 'user':
      if (p.ownerId === p.userId) return 'owner';
      return p.memberIds.includes(p.userId) ? 'edit' : null;
    case 'channel':
      return p.channelRole ?? null;
    case 'meeting':
      if (!p.meeting?.allowed) return null;
      return p.meeting.moderator ? 'owner' : 'edit';
  }
}

export const canEdit = (role: CollabRole | null) => role === 'owner' || role === 'edit';

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock']);

/**
 * Plain text of a Tiptap document stored in a Y.XmlFragment, by walking the tree (its XML serialization doesn't
 * escape text). Blocks end with a line break. Used for previews, never rendered as HTML.
 */
export function fragmentText(node: Y.XmlFragment | Y.XmlElement): string {
  let out = '';
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as { insert: unknown }[]) if (typeof op.insert === 'string') out += op.insert;
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'hardBreak') out += '\n';
      else out += fragmentText(child) + (BLOCKS.has(child.nodeName) ? '\n' : '');
    }
  }
  return node instanceof Y.XmlFragment ? out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : out;
}

export function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A page can't move under itself or one of its own subpages. */
export function wouldCycle(pageId: string, newParentId: string | null, parentOf: Map<string, string | null>): boolean {
  for (let cur = newParentId; cur; cur = parentOf.get(cur) ?? null) if (cur === pageId) return true;
  return false;
}

/** Breadcrumb path from the root to `id` (inclusive). */
export function pathTo<T extends { id: string; parentId: string | null }>(id: string, byId: Map<string, T>): T[] {
  const out: T[] = [];
  for (let cur = byId.get(id); cur && out.length < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.unshift(cur);
  return out;
}
