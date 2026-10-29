import { z } from 'zod';
import type { OutOfOfficeInfo, PresenceStatus } from './presence';

export const QUICK_REACTIONS = ['👍', '❤️', '😆', '😮', '😢', '😡'] as const;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_GROUP_MEMBERS = 250;

/** Mentions are stored inline in the message body as `@[Display Name](userId)`. */
export const MENTION_PATTERN = /@\[([^\]\n]{1,128})\]\(([a-z0-9]{8,40})\)/g;

export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_PATTERN)].map((m) => m[2]))];
}

/** Plain-text rendering of a body for previews, notifications and search. */
export function toPlainText(body: string): string {
  return body
    .replace(MENTION_PATTERN, '@$1')
    .replace(/```[\s\S]*?```/g, (m) => m.slice(3, -3))
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- requests ----------

export const createConversationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), userId: z.string().min(1) }),
  z.object({
    type: z.literal('group'),
    userIds: z.array(z.string().min(1)).min(1).max(MAX_GROUP_MEMBERS - 1),
    title: z.string().trim().max(128).optional(),
  }),
  z.object({ type: z.literal('self') }),
]);
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z.object({ title: z.string().trim().max(128).nullable() });
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const addMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(MAX_GROUP_MEMBERS),
  /** Share earlier chat history with the new members (Teams' "include history"). */
  shareHistory: z.boolean().default(true),
});
export type AddMembersInput = z.infer<typeof addMembersSchema>;

export const memberSettingsSchema = z.object({
  muted: z.boolean().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  /** Custom chat-list section ("folder"); null moves the chat back to Recent. */
  sectionId: z.string().nullable().optional(),
});
export type MemberSettingsInput = z.infer<typeof memberSettingsSchema>;

/** Without a message id the whole chat is flagged unread; with one, everything from that message on becomes unread. */
export const markUnreadSchema = z.object({ messageId: z.string().optional() });
export type MarkUnreadInput = z.infer<typeof markUnreadSchema>;

export const chatSectionSchema = z.object({ name: z.string().trim().min(1).max(64) });
export type ChatSectionInput = z.infer<typeof chatSectionSchema>;

export const reorderSectionsSchema = z.object({ ids: z.array(z.string()).max(50) });
export type ReorderSectionsInput = z.infer<typeof reorderSectionsSchema>;

export const MAX_POLL_OPTIONS = 10;

export const pollInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(MAX_POLL_OPTIONS),
  multiple: z.boolean().default(false),
});
export type PollInput = z.input<typeof pollInputSchema>;

export const votePollSchema = z.object({ options: z.array(z.number().int().min(0).max(MAX_POLL_OPTIONS - 1)).max(MAX_POLL_OPTIONS) });
export type VotePollInput = z.infer<typeof votePollSchema>;

const messageFields = {
  body: z.string().max(28_000).default(''),
  parentId: z.string().optional(),
  importance: z.enum(['normal', 'important', 'urgent']).default('normal'),
  attachmentIds: z.array(z.string()).max(10).default([]),
};

export const sendMessageSchema = z
  .object({
    ...messageFields,
    poll: pollInputSchema.optional(),
    /** Client-generated id so the sender can match its optimistic message to the server copy. */
    clientId: z.string().max(64).optional(),
  })
  .refine((m) => m.body.trim().length > 0 || m.attachmentIds.length > 0 || !!m.poll, { message: 'Message is empty' });
export type SendMessageInput = z.input<typeof sendMessageSchema>;

/** Scheduled send: a minute to 90 days ahead (checked again on the server against its clock). */
export const scheduleMessageSchema = z
  .object({ ...messageFields, sendAt: z.iso.datetime() })
  .refine((m) => m.body.trim().length > 0 || m.attachmentIds.length > 0, { message: 'Message is empty' });
export type ScheduleMessageInput = z.input<typeof scheduleMessageSchema>;

export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(28_000) });
export type EditMessageInput = z.infer<typeof editMessageSchema>;

// ---------- responses ----------

export interface UserSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  presence: PresenceStatus;
  /** Shown above the compose box when chatting with this person. */
  statusMessage: string | null;
  outOfOffice: OutOfOfficeInfo | null;
}

export interface AttachmentInfo {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ReactionSummary {
  emoji: string;
  userIds: string[];
}

export interface PollInfo {
  id: string;
  question: string;
  multiple: boolean;
  options: { text: string; voterIds: string[] }[];
  closedAt: string | null;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export interface MessageInfo {
  id: string;
  clientId?: string;
  conversationId: string;
  author: { id: string; displayName: string; avatarUrl: string | null } | null;
  parent: { id: string; authorName: string; preview: string } | null;
  type: 'text' | 'system';
  body: string;
  importance: 'normal' | 'important' | 'urgent';
  reactions: ReactionSummary[];
  attachments: AttachmentInfo[];
  mentionIds: string[];
  poll: PollInfo | null;
  linkPreview: LinkPreview | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ScheduledMessageInfo {
  id: string;
  conversationId: string;
  body: string;
  importance: 'normal' | 'important' | 'urgent';
  parentId: string | null;
  attachmentCount: number;
  sendAt: string;
  createdAt: string;
}

export interface SavedMessageInfo {
  message: MessageInfo;
  conversationTitle: string | null;
  savedAt: string;
}

export interface ChatSectionInfo {
  id: string;
  name: string;
  position: number;
}

export interface ConversationMemberInfo {
  user: UserSummary;
  lastReadAt: string | null;
}

export interface ConversationInfo {
  id: string;
  type: 'direct' | 'group' | 'self';
  title: string | null;
  members: ConversationMemberInfo[];
  lastMessage: MessageInfo | null;
  lastMessageAt: string;
  unread: number;
  /** "Mark as unread" on the whole chat; cleared when the chat is read. */
  markedUnread: boolean;
  muted: boolean;
  pinned: boolean;
  hidden: boolean;
  sectionId: string | null;
}

export interface MessagePage {
  messages: MessageInfo[];
  /** Pass as `before` to load older messages; null when the start of the chat is reached. */
  nextCursor: string | null;
}

export interface ActivityItem {
  id: string;
  type: 'mention' | 'reply' | 'reaction' | 'missed_call' | 'voicemail';
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  conversationId: string | null;
  conversationTitle: string | null;
  messageId: string | null;
  preview: string | null;
  read: boolean;
  createdAt: string;
}

// ---------- realtime payloads ----------

export interface TypingEvent {
  conversationId: string;
  userId: string;
  displayName: string;
}

export interface ReadEvent {
  conversationId: string;
  userId: string;
  lastReadAt: string;
}

export interface ReactionEvent {
  conversationId: string;
  messageId: string;
  reactions: ReactionSummary[];
}

export interface UrgentReminderEvent {
  conversationId: string;
  messageId: string;
  authorName: string;
  preview: string;
}

export interface MessageDeletedEvent {
  conversationId: string;
  messageId: string;
}

export interface PresenceEvent {
  userId: string;
  status: PresenceStatus;
  statusMessage: string | null;
  outOfOffice: OutOfOfficeInfo | null;
}
