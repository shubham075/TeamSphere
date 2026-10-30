import { z } from 'zod';
import type { PublicUser } from './auth';

export const SEARCH_SCOPES = ['all', 'people', 'messages', 'files', 'teams', 'channels', 'meetings'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  scope: z.enum(SEARCH_SCOPES).default('all'),
  /** Messages only: author user id. */
  from: z.string().optional(),
  /** Messages only: inside this conversation (chat or channel conversation). */
  in: z.string().optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  hasAttachment: z
    .enum(['1', '0', 'true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '1' || v === 'true')),
  /** Per-section result cap; the typeahead asks for a handful. */
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.output<typeof searchQuerySchema>;

export interface MessageHit {
  id: string;
  conversationId: string;
  /** Where it lives: chat title / "Team › Channel". */
  location: string;
  kind: 'chat' | 'channel';
  channelId: string | null;
  /** Channel replies point at their thread root. */
  threadId: string | null;
  author: { id: string; displayName: string } | null;
  /** Plain text with the matched words wrapped in «…» (rendered as <mark> by the client). */
  snippet: string;
  hasAttachment: boolean;
  createdAt: string;
}

export interface FileHit {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  mimeType: string | null;
  size: number;
  modifiedAt: string;
  location: string;
}

export interface TeamHit {
  id: string;
  name: string;
  description: string | null;
  isMember: boolean;
}

export interface ChannelHit {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  type: 'standard' | 'private' | 'shared';
}

export interface MeetingHit {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

export interface SearchResults {
  people: PublicUser[];
  messages: MessageHit[];
  files: FileHit[];
  teams: TeamHit[];
  channels: ChannelHit[];
  meetings: MeetingHit[];
}
