/** Pure search helpers (query building and the visibility rule), kept free of Prisma so they can be unit-tested. */

const MAX_TERMS = 8;

/** Words of the query, lowercased; punctuation and tsquery operators are dropped so user input can't break the query. */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TERMS);
}

/**
 * A to_tsquery string: every word must match, each as a prefix so the typeahead finds "budg" → "budget".
 * Null when there is nothing searchable.
 */
export function toTsQuery(q: string): string | null {
  const terms = searchTerms(q);
  return terms.length ? terms.map((t) => `${t}:*`).join(' & ') : null;
}

/** ILIKE pattern for name matches, with LIKE wildcards in the input escaped. */
export function likePattern(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface MessageVisibilityInput {
  message: { deletedAt: Date | null; type: string; createdAt: Date };
  /** The searcher's membership in the message's conversation; null when they aren't a member. */
  membership: { historySince: Date | null } | null;
  /** Set when the conversation is a channel. */
  channel: { deletedAt: Date | null; teamDeletedAt: Date | null } | null;
}

/**
 * Whether a message may appear in someone's search results. Mirrors what the chat/channel views show: members only
 * (private and shared channel membership is materialized as conversation membership), nothing before the member's
 * `historySince`, no deleted messages, channels or teams, and no system/call messages.
 * The SQL applies the same rule; this is re-checked on every row as a guard against the two drifting apart.
 */
export function messageVisible({ message, membership, channel }: MessageVisibilityInput): boolean {
  if (!membership) return false;
  if (message.deletedAt || message.type !== 'text') return false;
  if (membership.historySince && message.createdAt < membership.historySince) return false;
  if (channel && (channel.deletedAt || channel.teamDeletedAt)) return false;
  return true;
}

/** Message bodies encode mentions as @[Display Name](userId); show just "@Display Name". */
export function stripMentionMarkup(text: string): string {
  return text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');
}
