import { z } from 'zod';
import type { MessageInfo, UserSummary } from './chat';

/** Deleted teams and channels can be restored for this long, then they're purged. */
export const DELETED_RETENTION_DAYS = 30;
export const MAX_CHANNELS_PER_TEAM = 200;
export const MAX_CROSS_POST_CHANNELS = 10;

/** Realtime events added by Phase 2 (`team:updated` / `channel:updated` live in WS_EVENTS). */
export const TEAMS_WS_EVENTS = {
  /** A new top-level post or reply in a channel: ChannelMessageEvent. */
  channelMessage: 'channel:message',
  /** The Notes tab changed: ChannelNotes. */
  channelNotes: 'channel:notes',
} as const;

export type TeamVisibility = 'public' | 'private' | 'orgwide';
export type TeamRole = 'owner' | 'member' | 'guest';
export type ChannelType = 'standard' | 'private' | 'shared';

// ---------- settings ----------

// Plain shapes (no zod defaults) so `.partial()` updates leave unspecified fields alone; defaults are merged on read.
export const teamSettingsSchema = z.object({
  membersCanCreateChannels: z.boolean(),
  membersCanCreatePrivateChannels: z.boolean(),
  membersCanDeleteChannels: z.boolean(),
  membersCanManageTags: z.boolean(),
  guestsCanCreateChannels: z.boolean(),
  /** Allow @team (notifies every member) and @channel mentions. */
  allowTeamMentions: z.boolean(),
  allowChannelMentions: z.boolean(),
  /** Owners may delete anyone's posts and replies. */
  ownersCanDeleteMessages: z.boolean(),
});
export type TeamSettings = z.infer<typeof teamSettingsSchema>;

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  membersCanCreateChannels: true,
  membersCanCreatePrivateChannels: true,
  membersCanDeleteChannels: false,
  membersCanManageTags: false,
  guestsCanCreateChannels: false,
  allowTeamMentions: true,
  allowChannelMentions: true,
  ownersCanDeleteMessages: true,
};

export const channelModerationSchema = z.object({
  /** Who can start new posts: everyone, or only team owners and moderators. */
  newPosts: z.enum(['everyone', 'moderators']),
  /** When false, only moderators can reply. */
  allowReplies: z.boolean(),
  /** Who can use @team / @channel / @tag mentions in this channel. */
  mentions: z.enum(['everyone', 'moderators']),
  /** Moderators besides team owners (and channel owners). */
  moderatorIds: z.array(z.string()).max(100),
});
export type ChannelModeration = z.infer<typeof channelModerationSchema>;

export const DEFAULT_MODERATION: ChannelModeration = { newPosts: 'everyone', allowReplies: true, mentions: 'everyone', moderatorIds: [] };

/** Reads stored JSON, ignoring unknown or invalid fields. */
function withDefaults<T extends object>(schema: z.ZodObject, defaults: T, value: unknown): T {
  const parsed = schema.partial().safeParse(value && typeof value === 'object' ? value : {});
  const clean = parsed.success ? Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) : {};
  return { ...defaults, ...clean };
}
export const parseTeamSettings = (value: unknown): TeamSettings => withDefaults(teamSettingsSchema, DEFAULT_TEAM_SETTINGS, value);
export const parseModeration = (value: unknown): ChannelModeration => withDefaults(channelModerationSchema, DEFAULT_MODERATION, value);

// ---------- requests ----------

const name = z.string().trim().min(1).max(80);
const description = z.string().trim().max(1024).nullable().optional();
const channelName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine((n) => !/[~#%&*{}+/\\:<>?|'".]/.test(n), { message: 'Channel names can’t contain ~ # % & * { } + / \\ : < > ? | \' " .' });

export const createTeamSchema = z.object({
  name,
  description,
  visibility: z.enum(['public', 'private', 'orgwide']).default('private'),
  /** Copy channels, settings, tags and/or members from an existing team. */
  copyFrom: z
    .object({
      teamId: z.string().min(1),
      channels: z.boolean().default(true),
      settings: z.boolean().default(true),
      tags: z.boolean().default(false),
      members: z.boolean().default(false),
    })
    .optional(),
  memberIds: z.array(z.string()).max(500).default([]),
});
export type CreateTeamInput = z.input<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: name.optional(),
  description,
  visibility: z.enum(['public', 'private']).optional(),
  settings: teamSettingsSchema.partial().optional(),
});
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;

export const addTeamMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  role: z.enum(['member', 'guest', 'owner']).default('member'),
});
export type AddTeamMembersInput = z.input<typeof addTeamMembersSchema>;

export const updateTeamMemberSchema = z.object({ role: z.enum(['owner', 'member', 'guest']) });

export const myTeamSettingsSchema = z.object({ hidden: z.boolean().optional() });
export const teamOrderSchema = z.object({ teamIds: z.array(z.string()).max(500) });
export const joinCodeSchema = z.object({ code: z.string().trim().min(4).max(32) });

export const createChannelSchema = z.object({
  name: channelName,
  description,
  type: z.enum(['standard', 'private', 'shared']).default('standard'),
  /** Initial members of a private/shared channel besides the creator. Shared channels may include people outside the team. */
  memberIds: z.array(z.string()).max(500).default([]),
});
export type CreateChannelInput = z.input<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: channelName.optional(),
  description,
  moderation: channelModerationSchema.partial().optional(),
});
export type UpdateChannelInput = z.input<typeof updateChannelSchema>;

export const channelMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  role: z.enum(['owner', 'member']).default('member'),
});
export const channelShareSchema = z.object({ teamId: z.string().min(1) });
export const myChannelSettingsSchema = z.object({ pinned: z.boolean().optional(), muted: z.boolean().optional() });

export const createPostSchema = z
  .object({
    body: z.string().max(28_000).default(''),
    subject: z.string().trim().max(200).optional(),
    announcement: z.boolean().default(false),
    /** Uploaded with the channel's conversation attachments endpoint; shown as the announcement banner. */
    headerAttachmentId: z.string().optional(),
    importance: z.enum(['normal', 'important', 'urgent']).default('normal'),
    attachmentIds: z.array(z.string()).max(10).default([]),
    /** Extra channels to post the same message in (cross-post). */
    alsoChannelIds: z.array(z.string()).max(MAX_CROSS_POST_CHANNELS - 1).default([]),
    clientId: z.string().max(64).optional(),
  })
  .refine((p) => p.body.trim().length > 0 || p.attachmentIds.length > 0 || !!p.subject, { message: 'Post is empty' });
export type CreatePostInput = z.input<typeof createPostSchema>;

export const createReplySchema = z
  .object({
    body: z.string().max(28_000).default(''),
    attachmentIds: z.array(z.string()).max(10).default([]),
    clientId: z.string().max(64).optional(),
  })
  .refine((p) => p.body.trim().length > 0 || p.attachmentIds.length > 0, { message: 'Reply is empty' });
export type CreateReplyInput = z.input<typeof createReplySchema>;

export const saveNotesSchema = z.object({ notes: z.string().max(200_000), version: z.number().int().min(0) });

export const createTagSchema = z.object({ name: z.string().trim().min(1).max(40), userIds: z.array(z.string()).max(500).default([]) });
export const updateTagSchema = z.object({ name: z.string().trim().min(1).max(40).optional(), userIds: z.array(z.string()).max(500).optional() });

// ---------- responses ----------

/** What the signed-in user may do in a channel (computed by the server). */
export interface ChannelPermissions {
  post: boolean;
  reply: boolean;
  /** @team / @channel / @tag. */
  mentionGroups: boolean;
  /** Rename, change moderation, archive/delete, manage members. */
  manage: boolean;
  /** Delete other people's messages. */
  moderate: boolean;
}

export interface ChannelInfo {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  type: ChannelType;
  isGeneral: boolean;
  conversationId: string;
  moderation: ChannelModeration;
  archivedAt: string | null;
  deletedAt: string | null;
  /** Unread messages (posts and replies) and how many of them mention me. */
  unread: number;
  unreadMentions: number;
  pinned: boolean;
  muted: boolean;
  /** Explicit channel role for private/shared channels. */
  myRole: 'owner' | 'member' | null;
  /** For a shared channel listed under a team other than its host. */
  sharedFrom: { teamId: string; teamName: string } | null;
  permissions: ChannelPermissions;
  lastMessageAt: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  description: string | null;
  visibility: TeamVisibility;
  /** Null when I only have access to a shared channel in this team. */
  myRole: TeamRole | null;
  /** Only visible to owners. */
  joinCode: string | null;
  settings: TeamSettings;
  memberCount: number;
  archivedAt: string | null;
  deletedAt: string | null;
  hidden: boolean;
  position: number;
  channels: ChannelInfo[];
  createdAt: string;
}

export interface TeamMemberInfo {
  user: UserSummary;
  role: TeamRole;
}

export interface ChannelMemberInfo {
  user: UserSummary;
  /** owner/member for explicit members; "team" when the access comes from team membership. */
  role: 'owner' | 'member' | 'team';
  /** Set for people outside the host team (shared channels). */
  external: boolean;
}

export interface TagInfo {
  id: string;
  teamId: string;
  name: string;
  memberIds: string[];
}

export interface DiscoverTeam {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

/** Deleted/archived items an owner can restore (team management page). */
export interface RecycledChannel {
  id: string;
  name: string;
  type: ChannelType;
  deletedAt: string;
  purgeAt: string;
}

export interface PostMeta {
  subject: string | null;
  announcement: boolean;
  headerImageUrl: string | null;
  /** Other channels the same post went to (cross-post), as "Team › Channel". */
  crossPostedTo: { channelId: string; label: string }[];
}

export interface ChannelPost {
  root: MessageInfo;
  meta: PostMeta;
  /** Oldest first. */
  replies: MessageInfo[];
}

export interface ChannelPostPage {
  posts: ChannelPost[];
  /** Pass as `before` to load older posts; null at the start of the channel. */
  nextCursor: string | null;
}

export interface ChannelMessageEvent {
  channelId: string;
  conversationId: string;
  /** Root post (with meta) or a reply (rootId set). */
  post?: ChannelPost;
  reply?: MessageInfo;
  rootId?: string;
}

export interface ChannelNotes {
  channelId: string;
  notes: string;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; displayName: string } | null;
}

/** `team:updated`: something about the team changed for me; clients refetch their teams list. */
export interface TeamUpdatedEvent {
  teamId: string;
  /** I lost access (removed, team deleted). */
  removed?: boolean;
}

/** `channel:updated`: as above for one channel. Carries my fresh view of it when only my state changed (read, pin). */
export interface ChannelUpdatedEvent {
  channelId: string;
  teamId: string;
  removed?: boolean;
  channel?: ChannelInfo;
}
