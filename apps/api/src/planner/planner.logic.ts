import type { FileRole, PlanRole, TaskPriority, TaskProgress, TodoList } from '@teamsphere/shared';

/** Pure Planner rules, kept free of Prisma so they can be unit-tested. */

/**
 * The caller's role in a plan. Personal plans: the creator owns it, members edit. Channel plans follow the channel's
 * document-library role (everyone in the channel edits, team/channel owners manage, archived channels are read-only).
 */
export function planRole(p: {
  userId: string;
  ownerType: 'user' | 'channel';
  ownerId: string;
  memberIds: string[];
  channelRole: FileRole | null;
}): PlanRole | null {
  if (p.ownerType === 'user') {
    if (p.ownerId === p.userId) return 'owner';
    return p.memberIds.includes(p.userId) ? 'edit' : null;
  }
  return p.channelRole;
}

export type PlanAction = 'read' | 'edit' | 'manage';

export function canPlan(role: PlanRole | null, action: PlanAction): boolean {
  if (!role) return false;
  if (action === 'read') return true;
  if (action === 'edit') return role !== 'view';
  return role === 'owner';
}

/** A personal To Do task: only its owner sees and edits it. */
export function canPersonalTask(userId: string, task: { ownerId: string | null }): boolean {
  return task.ownerId === userId;
}

/** Midpoint ordering: the position between two neighbours (either may be missing at the ends). */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1024;
  if (before == null) return after! - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

/** Position for a new item appended after the existing ones. */
export function nextPosition(existing: { position: number }[]): number {
  return between(existing.reduce<number | null>((max, e) => (max == null || e.position > max ? e.position : max), null), null);
}

/** 'YYYY-MM-DD' ↔ a UTC-midnight Date, so a due date is the same calendar day for everyone. */
export function toDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return d;
}

export function fromDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Completion bookkeeping when progress changes: completing stamps who and when, reopening clears it.
 * Returns undefined when nothing changes.
 */
export function completionChange(
  from: TaskProgress,
  to: TaskProgress | undefined,
  userId: string,
  now = new Date(),
): { completedAt: Date | null; completedById: string | null } | undefined {
  if (!to || to === from) return undefined;
  if (to === 'completed') return { completedAt: now, completedById: userId };
  if (from === 'completed') return { completedAt: null, completedById: null };
  return undefined;
}

/** Assignees must be able to open the plan; personal To Do tasks have none. */
export function invalidAssignees(assigneeIds: string[], allowed: Iterable<string>): string[] {
  const ok = new Set(allowed);
  return [...new Set(assigneeIds)].filter((id) => !ok.has(id));
}

/** People to tell about a new assignment: newly added assignees other than the person assigning. */
export function newlyAssigned(before: string[], after: string[], actorId: string): string[] {
  const had = new Set(before);
  return [...new Set(after)].filter((id) => !had.has(id) && id !== actorId);
}

/** A plan task counts as "Important" in To Do when it is urgent or important. */
export const isHighPriority = (p: TaskPriority) => p === 'urgent' || p === 'important';

/** Whether a task the caller can see belongs in a To Do list. */
export function inTodoList(
  list: TodoList,
  t: { planId: string | null; ownerId: string | null; important: boolean; priority: TaskPriority; dueDate: Date | null; assigneeIds: string[]; myDay: boolean },
  userId: string,
): boolean {
  const personal = t.planId === null && t.ownerId === userId;
  const assigned = t.planId !== null && t.assigneeIds.includes(userId);
  switch (list) {
    case 'myday':
      // Anyone who can open a task may add it to their own day (the caller re-checks plan access).
      return t.myDay;
    case 'important':
      return (personal && t.important) || (assigned && isHighPriority(t.priority));
    case 'planned':
      return !!t.dueDate && (personal || assigned);
    case 'assigned':
      return assigned;
    case 'tasks':
      return personal;
  }
}
