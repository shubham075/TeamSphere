import { describe, expect, it } from 'vitest';
import {
  between, canPersonalTask, canPlan, completionChange, fromDateOnly, inTodoList, invalidAssignees, newlyAssigned, nextPosition, planRole,
  toDateOnly,
} from './planner.logic';

const OWNER = 'u-owner';
const ALICE = 'u-alice';
const BOB = 'u-bob';

describe('plan roles', () => {
  it('gives the owner of a personal plan full control, members edit and strangers nothing', () => {
    const base = { ownerType: 'user' as const, ownerId: OWNER, memberIds: [ALICE], channelRole: null };
    expect(planRole({ ...base, userId: OWNER })).toBe('owner');
    expect(planRole({ ...base, userId: ALICE })).toBe('edit');
    expect(planRole({ ...base, userId: BOB })).toBeNull();
  });

  it('follows the channel role for channel plans', () => {
    const base = { ownerType: 'channel' as const, ownerId: 'c1', memberIds: [], userId: ALICE };
    expect(planRole({ ...base, channelRole: 'edit' })).toBe('edit');
    expect(planRole({ ...base, channelRole: 'view' })).toBe('view');
    expect(planRole({ ...base, channelRole: null })).toBeNull();
  });

  it('maps roles to actions', () => {
    expect(canPlan('view', 'read')).toBe(true);
    expect(canPlan('view', 'edit')).toBe(false);
    expect(canPlan('edit', 'edit')).toBe(true);
    expect(canPlan('edit', 'manage')).toBe(false);
    expect(canPlan('owner', 'manage')).toBe(true);
    expect(canPlan(null, 'read')).toBe(false);
  });

  it('keeps personal tasks private to their owner', () => {
    expect(canPersonalTask(OWNER, { ownerId: OWNER })).toBe(true);
    expect(canPersonalTask(ALICE, { ownerId: OWNER })).toBe(false);
  });
});

describe('ordering', () => {
  it('places items between neighbours and at the ends', () => {
    expect(between(null, null)).toBe(1024);
    expect(between(1024, 2048)).toBe(1536);
    expect(between(null, 1024)).toBe(0);
    expect(between(1024, null)).toBe(2048);
  });

  it('appends after the highest position', () => {
    expect(nextPosition([])).toBe(1024);
    expect(nextPosition([{ position: 5 }, { position: 3000 }, { position: 10 }])).toBe(4024);
  });
});

describe('dates', () => {
  it('round-trips calendar dates through UTC midnight', () => {
    expect(fromDateOnly(toDateOnly('2026-11-03')!)).toBe('2026-11-03');
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeUndefined();
  });

  it('rejects impossible dates', () => {
    expect(() => toDateOnly('2026-02-30')).toThrow();
  });
});

describe('completion', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  it('stamps who completed a task and clears it when reopened', () => {
    expect(completionChange('in_progress', 'completed', ALICE, now)).toEqual({ completedAt: now, completedById: ALICE });
    expect(completionChange('completed', 'not_started', ALICE, now)).toEqual({ completedAt: null, completedById: null });
  });

  it('changes nothing otherwise', () => {
    expect(completionChange('not_started', 'in_progress', ALICE, now)).toBeUndefined();
    expect(completionChange('completed', 'completed', ALICE, now)).toBeUndefined();
    expect(completionChange('completed', undefined, ALICE, now)).toBeUndefined();
  });
});

describe('assignees', () => {
  it('flags people who cannot open the plan', () => {
    expect(invalidAssignees([ALICE, BOB, ALICE], [OWNER, ALICE])).toEqual([BOB]);
  });

  it('notifies only newly added people other than the actor', () => {
    expect(newlyAssigned([ALICE], [ALICE, BOB, OWNER], OWNER)).toEqual([BOB]);
  });
});

describe('To Do lists', () => {
  const personal = { planId: null, ownerId: OWNER, important: false, priority: 'medium' as const, dueDate: null, assigneeIds: [], myDay: false };
  const planTask = { ...personal, planId: 'p1', ownerId: null, assigneeIds: [OWNER] };

  it('puts personal tasks in Tasks and plan tasks in Assigned to me', () => {
    expect(inTodoList('tasks', personal, OWNER)).toBe(true);
    expect(inTodoList('assigned', personal, OWNER)).toBe(false);
    expect(inTodoList('assigned', planTask, OWNER)).toBe(true);
    expect(inTodoList('tasks', planTask, OWNER)).toBe(false);
  });

  it('treats starred personal tasks and urgent/important plan tasks as Important', () => {
    expect(inTodoList('important', { ...personal, important: true }, OWNER)).toBe(true);
    expect(inTodoList('important', { ...planTask, priority: 'urgent' }, OWNER)).toBe(true);
    expect(inTodoList('important', planTask, OWNER)).toBe(false);
  });

  it('lists dated tasks in Planned and flagged ones in My Day', () => {
    expect(inTodoList('planned', { ...personal, dueDate: new Date() }, OWNER)).toBe(true);
    expect(inTodoList('planned', personal, OWNER)).toBe(false);
    expect(inTodoList('myday', { ...planTask, myDay: true }, OWNER)).toBe(true);
  });

  it('never shows plan tasks assigned to someone else', () => {
    expect(inTodoList('planned', { ...planTask, assigneeIds: [ALICE], dueDate: new Date() }, OWNER)).toBe(false);
  });
});
