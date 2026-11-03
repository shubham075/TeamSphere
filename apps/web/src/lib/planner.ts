import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BucketInfo, ChannelTabApp, ChannelTabInfo, ChecklistItemInfo, CreatePlanInput, CreateTaskInput, PlanDetail, PlanSummary, PlanTasks,
  TaskAttachmentInfo, TaskCommentInfo, TaskDetail, TaskInfo, TaskLabelColor, TaskPriority, TaskProgress, TodoList, UpdatePlanInput,
  UpdateTaskInput,
} from '@teamsphere/shared';
import { api } from './api';
import { resolvedTimeZone } from './i18n';

// ------------------------------------------------------------------ pure helpers (unit-tested)

/** Today's date (YYYY-MM-DD) in the person's chosen time zone: due dates and My Day are calendar days. */
export function localDay(now = new Date(), timeZone = resolvedTimeZone()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** Where a due date falls relative to today, ignoring progress (Board "Due" columns). */
export function dueBucket(dueDate: string | null, today: string): DueState {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return dueDate <= addDays(today, 7) ? 'soon' : 'later';
}

/** For highlighting: completed tasks are never late. */
export function dueState(task: Pick<TaskInfo, 'dueDate' | 'progress'>, today: string): DueState {
  if (task.progress === 'completed' && task.dueDate) return 'later';
  return dueBucket(task.dueDate, today);
}

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function dueLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

export type GroupBy = 'bucket' | 'progress' | 'assignee' | 'due' | 'priority' | 'label';

export interface TaskGroup {
  id: string;
  name: string;
  tasks: TaskInfo[];
}

export const PROGRESS_LABEL: Record<TaskProgress, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { urgent: 'Urgent', important: 'Important', medium: 'Medium', low: 'Low' };
export const LABEL_COLORS: Record<TaskLabelColor, string> = {
  pink: '#e3008c', red: '#d13438', yellow: '#c19c00', green: '#107c10', blue: '#0f6cbd',
  purple: '#8764b8', bronze: '#a74109', lime: '#5c7e10', aqua: '#038387', gray: '#69797e',
};

const DUE_GROUPS: [DueState, string][] = [['overdue', 'Late'], ['today', 'Today'], ['soon', 'Next 7 days'], ['later', 'Later'], ['none', 'No date']];

/** Board columns for a grouping. Task order inside a column follows `position`. */
export function groupTasks(tasks: TaskInfo[], by: GroupBy, plan: Pick<PlanDetail, 'buckets' | 'people' | 'labels'>, today: string): TaskGroup[] {
  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  const make = (id: string, name: string, pick: (t: TaskInfo) => boolean): TaskGroup => ({ id, name, tasks: sorted.filter(pick) });
  switch (by) {
    case 'bucket': {
      const known = new Set(plan.buckets.map((b) => b.id));
      const groups = [...plan.buckets].sort((a, b) => a.position - b.position).map((b) => make(b.id, b.name, (t) => t.bucketId === b.id));
      const orphans = sorted.filter((t) => !t.bucketId || !known.has(t.bucketId));
      return orphans.length ? [...groups, { id: '', name: 'No bucket', tasks: orphans }] : groups;
    }
    case 'progress':
      return (Object.keys(PROGRESS_LABEL) as TaskProgress[]).map((p) => make(p, PROGRESS_LABEL[p], (t) => t.progress === p));
    case 'priority':
      return (Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => make(p, PRIORITY_LABEL[p], (t) => t.priority === p));
    case 'due':
      return DUE_GROUPS.map(([id, name]) => make(id, name, (t) => dueBucket(t.dueDate, today) === id));
    case 'assignee':
      return [
        make('', 'Unassigned', (t) => !t.assignees.length),
        // A task with several assignees shows in each of their columns, as in other planners.
        ...plan.people.map((p) => make(p.id, p.displayName, (t) => t.assignees.some((a) => a.id === p.id))).filter((g) => g.tasks.length),
      ];
    case 'label': {
      const colors = Object.keys(LABEL_COLORS) as TaskLabelColor[];
      return [
        make('', 'No label', (t) => !t.labels.length),
        ...colors.map((c) => make(c, plan.labels[c] || c[0].toUpperCase() + c.slice(1), (t) => t.labels.includes(c))).filter((g) => g.tasks.length || plan.labels[g.id as TaskLabelColor]),
      ];
    }
  }
}

/** What dropping a task into another column changes, given the grouping. */
export function dropPatch(by: GroupBy, groupId: string, task: TaskInfo, today: string): UpdateTaskInput | null {
  switch (by) {
    case 'bucket':
      return groupId && groupId !== task.bucketId ? { bucketId: groupId } : null;
    case 'progress':
      return groupId !== task.progress ? { progress: groupId as TaskProgress } : null;
    case 'priority':
      return groupId !== task.priority ? { priority: groupId as TaskPriority } : null;
    case 'due': {
      const target = { overdue: addDays(today, -1), today, soon: addDays(today, 1), later: addDays(today, 8), none: null }[groupId as DueState];
      return target === undefined ? null : { dueDate: target };
    }
    case 'assignee':
      if (!groupId) return task.assignees.length ? { assigneeIds: [] } : null;
      return task.assignees.some((a) => a.id === groupId) ? null : { assigneeIds: [groupId] };
    case 'label':
      if (!groupId) return task.labels.length ? { labels: [] } : null;
      return task.labels.includes(groupId as TaskLabelColor) ? null : { labels: [...task.labels, groupId as TaskLabelColor] };
  }
}

/** Position for a task dropped at `index` in a column (fractional ordering, like the server). */
export function positionAt(column: TaskInfo[], index: number, movingId: string): number {
  const others = column.filter((t) => t.id !== movingId);
  const before = others[index - 1]?.position;
  const after = others[index]?.position;
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

// ------------------------------------------------------------------ queries

export const pk = {
  all: ['planner'] as const,
  plans: ['planner', 'plans'] as const,
  plan: (id: string) => ['planner', 'plan', id] as const,
  todo: (list: TodoList) => ['planner', 'todo', list] as const,
  task: (id: string) => ['planner', 'task', id] as const,
  tabs: (channelId: string) => ['channel-tabs', channelId] as const,
};

export function usePlans() {
  return useQuery({ queryKey: pk.plans, queryFn: () => api<PlanSummary[]>('/planner/plans') });
}

export function usePlan(id: string | null) {
  return useQuery({ queryKey: pk.plan(id ?? ''), queryFn: () => api<PlanTasks>(`/planner/plans/${id}?day=${localDay()}`), enabled: !!id });
}

export function useTodo(list: TodoList) {
  return useQuery({ queryKey: pk.todo(list), queryFn: () => api<TaskInfo[]>(`/planner/todo?list=${list}&day=${localDay()}`) });
}

export function useTask(id: string | null) {
  return useQuery({ queryKey: pk.task(id ?? ''), queryFn: () => api<TaskDetail>(`/planner/tasks/${id}?day=${localDay()}`), enabled: !!id });
}

export function useChannelTabs(channelId: string) {
  return useQuery({ queryKey: pk.tabs(channelId), queryFn: () => api<ChannelTabInfo[]>(`/channels/${channelId}/tabs`) });
}

/** Mutation that refreshes every Planner view afterwards (realtime does the same for everyone else). */
export function usePlannerMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: pk.all }) });
}

/**
 * Task edits update every cached list optimistically so drag and drop feels instant; the server result and the
 * realtime refetch settle it.
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      api<TaskInfo>(`/planner/tasks/${id}?day=${localDay()}`, { method: 'PATCH', json: patch }),
    onMutate: ({ id, patch }) => {
      const apply = (t: TaskInfo): TaskInfo => {
        if (t.id !== id) return t;
        const { assigneeIds, ...rest } = patch;
        const next = { ...t, ...rest } as TaskInfo;
        if (assigneeIds) next.assignees = t.assignees.filter((a) => assigneeIds.includes(a.id));
        return next;
      };
      qc.setQueriesData<PlanTasks>({ queryKey: ['planner', 'plan'] }, (d) => (d ? { ...d, tasks: d.tasks.map(apply) } : d));
      qc.setQueriesData<TaskInfo[]>({ queryKey: ['planner', 'todo'] }, (d) => d?.map(apply));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: pk.all }),
  });
}

export const plannerApi = {
  createPlan: (input: CreatePlanInput) => api<PlanDetail>('/planner/plans', { method: 'POST', json: input }),
  updatePlan: (id: string, input: UpdatePlanInput) => api<PlanDetail>(`/planner/plans/${id}`, { method: 'PATCH', json: input }),
  deletePlan: (id: string) => api(`/planner/plans/${id}`, { method: 'DELETE' }),
  addMembers: (id: string, userIds: string[]) => api<PlanDetail>(`/planner/plans/${id}/members`, { method: 'POST', json: { userIds } }),
  removeMember: (id: string, userId: string) => api(`/planner/plans/${id}/members/${userId}`, { method: 'DELETE' }),
  createBucket: (planId: string, name: string, position?: number) =>
    api<BucketInfo>(`/planner/plans/${planId}/buckets`, { method: 'POST', json: { name, position } }),
  updateBucket: (id: string, patch: { name?: string; position?: number }) => api<BucketInfo>(`/planner/buckets/${id}`, { method: 'PATCH', json: patch }),
  deleteBucket: (id: string) => api(`/planner/buckets/${id}`, { method: 'DELETE' }),
  createTask: (input: CreateTaskInput) => api<TaskInfo>('/planner/tasks', { method: 'POST', json: input }),
  deleteTask: (id: string) => api(`/planner/tasks/${id}`, { method: 'DELETE' }),
  setMyDay: (id: string, on: boolean) => api(`/planner/tasks/${id}/my-day`, { method: 'PUT', json: { on, day: localDay() } }),
  addChecklistItem: (taskId: string, text: string) => api<ChecklistItemInfo>(`/planner/tasks/${taskId}/checklist`, { method: 'POST', json: { text } }),
  updateChecklistItem: (id: string, patch: { text?: string; done?: boolean }) =>
    api<ChecklistItemInfo>(`/planner/checklist/${id}`, { method: 'PATCH', json: patch }),
  deleteChecklistItem: (id: string) => api(`/planner/checklist/${id}`, { method: 'DELETE' }),
  addComment: (taskId: string, body: string) => api<TaskCommentInfo>(`/planner/tasks/${taskId}/comments`, { method: 'POST', json: { body } }),
  deleteComment: (id: string) => api(`/planner/comments/${id}`, { method: 'DELETE' }),
  addAttachment: (taskId: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return api<TaskAttachmentInfo>(`/planner/tasks/${taskId}/attachments`, { method: 'POST', body: form });
  },
  deleteAttachment: (id: string) => api(`/planner/attachments/${id}`, { method: 'DELETE' }),
  addTab: (channelId: string, refId: string, app: ChannelTabApp = 'planner') => api<ChannelTabInfo>(`/channels/${channelId}/tabs`, { method: 'POST', json: { app, refId } }),
  removeTab: (channelId: string, tabId: string) => api(`/channels/${channelId}/tabs/${tabId}`, { method: 'DELETE' }),
};
