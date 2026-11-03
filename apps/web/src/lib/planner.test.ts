import { describe, expect, it } from 'vitest';
import type { TaskInfo } from '@teamsphere/shared';
import { addDays, dropPatch, dueLabel, dueState, groupTasks, localDay, positionAt } from './planner';

const task = (id: string, extra: Partial<TaskInfo> = {}): TaskInfo => ({
  id, planId: 'p', planTitle: 'Plan', bucketId: 'b1', title: id, notes: '', priority: 'medium', progress: 'not_started',
  startDate: null, dueDate: null, labels: [], important: false, position: 1024, completedAt: null, completedBy: null, assignees: [],
  checklist: { total: 0, done: 0 }, commentCount: 0, attachmentCount: 0, myDay: false, source: null, createdBy: null,
  createdAt: '', updatedAt: '', ...extra,
});
const plan = {
  buckets: [{ id: 'b2', name: 'Doing', position: 2048 }, { id: 'b1', name: 'To do', position: 1024 }],
  people: [{ id: 'u1', displayName: 'Alex', avatarUrl: null }, { id: 'u2', displayName: 'Priya', avatarUrl: null }],
  labels: { red: 'Blocked' },
};
const TODAY = '2026-11-03';

describe('dates', () => {
  it('formats today in the chosen zone', () => {
    // 23:30 UTC is already the next day in Tokyo.
    expect(localDay(new Date('2026-11-03T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-11-04');
    expect(localDay(new Date('2026-11-03T23:30:00Z'), 'UTC')).toBe('2026-11-03');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('classifies due dates and never marks completed tasks late', () => {
    expect(dueState({ dueDate: '2026-11-01', progress: 'in_progress' }, TODAY)).toBe('overdue');
    expect(dueState({ dueDate: '2026-11-01', progress: 'completed' }, TODAY)).toBe('later');
    expect(dueState({ dueDate: TODAY, progress: 'not_started' }, TODAY)).toBe('today');
    expect(dueState({ dueDate: '2026-11-08', progress: 'not_started' }, TODAY)).toBe('soon');
    expect(dueState({ dueDate: null, progress: 'not_started' }, TODAY)).toBe('none');
  });

  it('labels nearby days in words', () => {
    expect(dueLabel(TODAY, TODAY)).toBe('Today');
    expect(dueLabel('2026-11-04', TODAY)).toBe('Tomorrow');
    expect(dueLabel('2026-11-02', TODAY)).toBe('Yesterday');
  });
});

describe('board grouping', () => {
  it('orders bucket columns by position and tasks inside them', () => {
    const groups = groupTasks([task('a', { position: 2000 }), task('b', { position: 10 }), task('c', { bucketId: 'b2' })], 'bucket', plan, TODAY);
    expect(groups.map((g) => g.name)).toEqual(['To do', 'Doing']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('collects tasks without a known bucket', () => {
    const groups = groupTasks([task('a', { bucketId: null })], 'bucket', plan, TODAY);
    expect(groups.at(-1)).toMatchObject({ id: '', name: 'No bucket' });
  });

  it('shows a task in every assignee column', () => {
    const t = task('a', { assignees: plan.people });
    const groups = groupTasks([t, task('b')], 'assignee', plan, TODAY);
    expect(groups.map((g) => [g.name, g.tasks.length])).toEqual([['Unassigned', 1], ['Alex', 1], ['Priya', 1]]);
  });

  it('turns a drop into the matching change', () => {
    const t = task('a');
    expect(dropPatch('bucket', 'b2', t, TODAY)).toEqual({ bucketId: 'b2' });
    expect(dropPatch('bucket', 'b1', t, TODAY)).toBeNull();
    expect(dropPatch('progress', 'completed', t, TODAY)).toEqual({ progress: 'completed' });
    expect(dropPatch('due', 'today', t, TODAY)).toEqual({ dueDate: TODAY });
    expect(dropPatch('due', 'none', t, TODAY)).toEqual({ dueDate: null });
    expect(dropPatch('assignee', 'u2', t, TODAY)).toEqual({ assigneeIds: ['u2'] });
  });

  it('computes a position between neighbours', () => {
    const column = [task('a', { position: 100 }), task('b', { position: 200 }), task('c', { position: 300 })];
    expect(positionAt(column, 0, 'x')).toBe(-924);
    expect(positionAt(column, 1, 'x')).toBe(150);
    expect(positionAt(column, 3, 'x')).toBe(1324);
    // Moving 'a' below 'b': 'a' itself is ignored.
    expect(positionAt(column, 1, 'a')).toBe(250);
  });
});
