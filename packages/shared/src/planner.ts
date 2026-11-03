import { z } from 'zod';

/** Phase 8a: Planner (plans, buckets, tasks) and To Do (personal lists), plus generic channel app tabs. */

export const TASK_PRIORITIES = ['urgent', 'important', 'medium', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PROGRESS = ['not_started', 'in_progress', 'completed'] as const;
export type TaskProgress = (typeof TASK_PROGRESS)[number];
/** Fixed label colors; each plan names the ones it uses. */
export const TASK_LABEL_COLORS = ['pink', 'red', 'yellow', 'green', 'blue', 'purple', 'bronze', 'lime', 'aqua', 'gray'] as const;
export type TaskLabelColor = (typeof TASK_LABEL_COLORS)[number];

export const TODO_LISTS = ['myday', 'important', 'planned', 'assigned', 'tasks'] as const;
export type TodoList = (typeof TODO_LISTS)[number];

export type PlanRole = 'owner' | 'edit' | 'view';

/** Apps that can be pinned as a channel tab after Posts / Files / Notes. */
/** `wiki` = the channel's page tree (refId is the channel id); `whiteboard` = a channel board. */
export const CHANNEL_TAB_APPS = ['planner', 'wiki', 'whiteboard'] as const;
export type ChannelTabApp = (typeof CHANNEL_TAB_APPS)[number];

export const PLANNER_WS_EVENTS = {
  /** Plans or tasks the user can see changed: refetch planner views. */
  changed: 'planner:changed',
  /** A channel's app tabs changed. */
  tabsChanged: 'channel:tabs',
} as const;

export const PLANNER_ACTIVITY_TYPES = ['task_assigned', 'task_comment'] as const;
export type PlannerActivityType = (typeof PLANNER_ACTIVITY_TYPES)[number];

export const MAX_TASK_ATTACHMENT_BYTES = 100 * 1024 * 1024;

// ---------- requests ----------

/** Calendar date without a time or zone: due and start dates mean the same day everywhere. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const title = z.string().trim().min(1, 'Enter a name').max(255);
const position = z.number().finite();

export const createPlanSchema = z.object({
  title,
  /** Owned by a channel (everyone in it) or, when omitted, by the creator and the members listed. */
  channelId: z.string().min(1).nullable().default(null),
  memberIds: z.array(z.string().min(1)).max(100).default([]),
  /** Also pin the plan as a tab in its channel. */
  addTab: z.boolean().default(false),
});
export type CreatePlanInput = z.input<typeof createPlanSchema>;

export const updatePlanSchema = z.object({
  title: title.optional(),
  /** Color → name; an empty name removes the label name. */
  labels: z.partialRecord(z.enum(TASK_LABEL_COLORS), z.string().trim().max(40)).optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const planMembersSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(100) });
export type PlanMembersInput = z.infer<typeof planMembersSchema>;

export const createBucketSchema = z.object({ name: title, position: position.optional() });
export type CreateBucketInput = z.infer<typeof createBucketSchema>;

export const updateBucketSchema = z.object({ name: title.optional(), position: position.optional() });
export type UpdateBucketInput = z.infer<typeof updateBucketSchema>;

export const createTaskSchema = z.object({
  /** null = a personal To Do task. */
  planId: z.string().min(1).nullable().default(null),
  bucketId: z.string().min(1).nullable().optional(),
  title,
  notes: z.string().max(10_000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  progress: z.enum(TASK_PROGRESS).optional(),
  startDate: dateOnlySchema.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  assigneeIds: z.array(z.string().min(1)).max(20).optional(),
  labels: z.array(z.enum(TASK_LABEL_COLORS)).optional(),
  important: z.boolean().optional(),
  /** Add straight to My Day for this local date. */
  myDay: dateOnlySchema.optional(),
  /** "Create task" from a chat message or channel post. */
  source: z.object({ conversationId: z.string().min(1), messageId: z.string().min(1) }).optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: title.optional(),
  notes: z.string().max(10_000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  progress: z.enum(TASK_PROGRESS).optional(),
  startDate: dateOnlySchema.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  labels: z.array(z.enum(TASK_LABEL_COLORS)).optional(),
  important: z.boolean().optional(),
  bucketId: z.string().min(1).nullable().optional(),
  position: position.optional(),
  /** Replaces the assignee list. */
  assigneeIds: z.array(z.string().min(1)).max(20).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const myDaySchema = z.object({ day: dateOnlySchema, on: z.boolean() });
export type MyDayInput = z.infer<typeof myDaySchema>;

export const checklistItemSchema = z.object({ text: z.string().trim().min(1).max(500) });
export const updateChecklistItemSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
  position: position.optional(),
});
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

export const taskCommentSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const createChannelTabSchema = z.object({
  app: z.enum(CHANNEL_TAB_APPS),
  refId: z.string().min(1),
  title: z.string().trim().min(1).max(60).optional(),
});
export type CreateChannelTabInput = z.infer<typeof createChannelTabSchema>;

// ---------- responses ----------

export interface PlanPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PlanSummary {
  id: string;
  title: string;
  ownerType: 'user' | 'channel';
  /** Channel plans: where they live. */
  channel: { id: string; name: string; teamId: string; teamName: string } | null;
  role: PlanRole;
  openTasks: number;
  updatedAt: string;
}

export interface BucketInfo {
  id: string;
  name: string;
  position: number;
}

export interface PlanDetail extends PlanSummary {
  labels: Partial<Record<TaskLabelColor, string>>;
  buckets: BucketInfo[];
  /** People who can be assigned: plan members (personal plans) or everyone in the channel. */
  people: PlanPerson[];
  /** Personal plans: explicit members besides the owner. */
  members: PlanPerson[];
  owner: PlanPerson | null;
}

export interface TaskInfo {
  id: string;
  planId: string | null;
  planTitle: string | null;
  bucketId: string | null;
  title: string;
  notes: string;
  priority: TaskPriority;
  progress: TaskProgress;
  startDate: string | null;
  dueDate: string | null;
  labels: TaskLabelColor[];
  important: boolean;
  position: number;
  completedAt: string | null;
  completedBy: PlanPerson | null;
  assignees: PlanPerson[];
  checklist: { total: number; done: number };
  commentCount: number;
  attachmentCount: number;
  /** In the caller's My Day for the requested day. */
  myDay: boolean;
  source: { conversationId: string; messageId: string } | null;
  createdBy: PlanPerson | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItemInfo {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface TaskCommentInfo {
  id: string;
  author: PlanPerson | null;
  body: string;
  createdAt: string;
}

export interface TaskAttachmentInfo {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: PlanPerson | null;
  createdAt: string;
}

export interface TaskDetail extends TaskInfo {
  canEdit: boolean;
  checklistItems: ChecklistItemInfo[];
  comments: TaskCommentInfo[];
  attachments: TaskAttachmentInfo[];
}

export interface PlanTasks {
  plan: PlanDetail;
  tasks: TaskInfo[];
}

export interface ChannelTabInfo {
  id: string;
  channelId: string;
  app: ChannelTabApp;
  refId: string;
  title: string;
  position: number;
}

export interface PlannerChangedEvent {
  planIds: string[];
  taskIds: string[];
}
