import { z } from 'zod';
import { USER_ROLES } from './auth';
import { LOBBY_BYPASS } from './meetings';
import type { PublicUser } from './auth';

// ---------------------------------------------------------------- Org settings

export const orgSettingsSchema = z.object({
  /** Product name shown in the title bar and on the sign-in page (branding). */
  orgName: z.string().trim().min(1).max(64).default('TeamSphere'),
  /** Whether guests (role guest, and anonymous meeting guests) may be added or join. */
  guestAccess: z.boolean().default(true),
  /** Largest file anyone can upload (files and chat attachments), in MB. Capped by the server's hard limit. */
  maxFileSizeMb: z.number().int().min(1).max(250).default(100),
  /** Org-wide switch for link previews in messages (policies can also turn them off per user). */
  linkPreviews: z.boolean().default(true),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export const updateOrgSettingsSchema = orgSettingsSchema.partial();
export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsSchema>;

/** What every signed-in client needs (and the sign-in page: name + logo only). */
export interface OrgInfo extends OrgSettings {
  logoUrl: string | null;
}

// ---------------------------------------------------------------- Policies

export const POLICY_TYPES = ['messaging', 'meeting', 'calling', 'apps'] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const messagingPolicySchema = z.object({
  allowEdit: z.boolean().default(true),
  allowDelete: z.boolean().default(true),
  allowUrgent: z.boolean().default(true),
  linkPreviews: z.boolean().default(true),
});
export const meetingPolicySchema = z.object({
  allowRecording: z.boolean().default(true),
  /** Default "who can bypass the lobby" for new meetings this person organizes. */
  lobbyDefault: z.enum(LOBBY_BYPASS).default('invited'),
});
export const callingPolicySchema = z.object({
  allowCalls: z.boolean().default(true),
  allowVideo: z.boolean().default(true),
});
export const appsPolicySchema = z.object({
  /** Feature toggles: hide the app on the rail and refuse its server routes that create content. */
  files: z.boolean().default(true),
  meetings: z.boolean().default(true),
  calls: z.boolean().default(true),
});

export const POLICY_SCHEMAS = {
  messaging: messagingPolicySchema,
  meeting: meetingPolicySchema,
  calling: callingPolicySchema,
  apps: appsPolicySchema,
} as const;

export interface EffectivePolicies {
  messaging: z.infer<typeof messagingPolicySchema>;
  meeting: z.infer<typeof meetingPolicySchema>;
  calling: z.infer<typeof callingPolicySchema>;
  apps: z.infer<typeof appsPolicySchema>;
}

export const createPolicySchema = z.object({
  type: z.enum(POLICY_TYPES),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(''),
  /** Validated against the type's schema on the server; unknown keys are dropped. */
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export const updatePolicySchema = createPolicySchema.omit({ type: true }).partial();
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

/** Replaces a policy's assignments. Groups are teams: the policy applies to every member of the team. */
export const policyAssignmentsSchema = z.object({
  userIds: z.array(z.string()).max(2000).default([]),
  teamIds: z.array(z.string()).max(500).default([]),
  /** The org-wide default for this type (one per type). */
  isDefault: z.boolean().optional(),
});
export type PolicyAssignmentsInput = z.infer<typeof policyAssignmentsSchema>;

export interface PolicyInfo {
  id: string;
  type: PolicyType;
  name: string;
  description: string;
  settings: Record<string, unknown>;
  isDefault: boolean;
  users: { id: string; displayName: string }[];
  teams: { id: string; name: string }[];
  updatedAt: string;
}

export interface EffectivePolicySource {
  type: PolicyType;
  /** Null means the built-in defaults apply. */
  policyId: string | null;
  policyName: string | null;
  via: 'user' | 'team' | 'default' | 'builtin';
}

// ---------------------------------------------------------------- Admin center

export const adminUpdateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(128).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
  jobTitle: z.string().max(128).nullable().optional(),
  department: z.string().max(128).nullable().optional(),
});
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export interface AdminUserRow extends PublicUser {
  lastLoginAt: string | null;
}

export interface AdminTeamRow {
  id: string;
  name: string;
  visibility: 'public' | 'private' | 'orgwide';
  memberCount: number;
  channelCount: number;
  owners: { id: string; displayName: string }[];
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface AdminChannelRow {
  id: string;
  teamId: string;
  name: string;
  type: 'standard' | 'private' | 'shared';
  isGeneral: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
}

export const adminTeamActionSchema = z.object({ action: z.enum(['archive', 'unarchive', 'delete', 'restore']) });
export const adminTeamOwnerSchema = z.object({ userId: z.string(), owner: z.boolean() });

export interface UsageOverview {
  users: { active: number; disabled: number; admins: number; guests: number; activeLast7d: number };
  teams: number;
  channels: number;
  messages: { total: number; last7d: number };
  meetings: { total: number; last7d: number };
  calls: { total: number; last7d: number };
  files: { count: number; bytes: number };
}

export interface AuditRow {
  id: string;
  action: string;
  actor: { id: string; displayName: string } | null;
  targetType: string | null;
  targetId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditRow[];
  nextCursor: string | null;
}

export const auditQuerySchema = z.object({
  actorId: z.string().optional(),
  /** Prefix match, e.g. "admin." or "file.share". */
  action: z.string().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
