'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Plus, Settings, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { PlanDetail, TaskInfo } from '@teamsphere/shared';
import { errorText, inputClass } from '@/components/teams/ui';
import { useDismiss } from '@/lib/use-dismiss';
import {
  addDays, dropPatch, dueState, GroupBy, groupTasks, localDay, plannerApi, positionAt, PRIORITY_LABEL, PROGRESS_LABEL, TaskGroup,
  usePlan, usePlannerMutation, useUpdateTask,
} from '@/lib/planner';
import { PlanSettingsDialog } from './dialogs';
import { TaskDetailDialog } from './task-detail';
import { Assignees, DueBadge, LabelChip, PriorityBadge, ProgressIcon, selectClass, TaskMeta } from './ui';

type View = 'board' | 'grid' | 'schedule' | 'charts';
const VIEWS: { id: View; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'grid', label: 'Grid' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'charts', label: 'Charts' },
];
const GROUPS: { id: GroupBy; label: string }[] = [
  { id: 'bucket', label: 'Bucket' },
  { id: 'progress', label: 'Progress' },
  { id: 'assignee', label: 'Assigned to' },
  { id: 'due', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
  { id: 'label', label: 'Labels' },
];

/** A plan with its four views. Used by the Planner app and by the channel tab (`compact` hides the plan title). */
export function PlanView({ planId, compact, onDeleted }: { planId: string; compact?: boolean; onDeleted?: () => void }) {
  const { data, isLoading, error } = usePlan(planId);
  const [view, setView] = useState<View>('board');
  const [groupBy, setGroupBy] = useState<GroupBy>('bucket');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState('');

  if (isLoading) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (!data) return <p className="p-6 text-sm text-muted">{errorText(error) ?? 'This plan is not available.'}</p>;
  const { plan } = data;
  const q = filter.trim().toLowerCase();
  const tasks = q ? data.tasks.filter((t) => t.title.toLowerCase().includes(q) || t.assignees.some((a) => a.displayName.toLowerCase().includes(q))) : data.tasks;
  const canEdit = plan.role !== 'view';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-5 py-2">
        {!compact && (
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{plan.title}</h1>
            <p className="truncate text-xs text-muted">{plan.channel ? `${plan.channel.teamName} › ${plan.channel.name}` : plan.members.length ? `Shared with ${plan.members.length} ${plan.members.length === 1 ? 'person' : 'people'}` : 'Only you'}</p>
          </div>
        )}
        <div role="tablist" aria-label="Plan views" className="flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={clsx('rounded-md px-3 py-1.5 text-sm', view === v.id ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-surface-hover')}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tasks" aria-label="Filter tasks" className={clsx(selectClass, 'w-44')} />
        {view === 'board' && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={selectClass}>
              {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
        )}
        <button onClick={() => setSettings(true)} aria-label="Plan settings" title="Plan settings" className="rounded p-2 text-muted hover:bg-surface-hover">
          <Settings size={17} />
        </button>
      </header>

      {view === 'board' && <Board plan={plan} tasks={tasks} groupBy={groupBy} canEdit={canEdit} onOpen={setOpenTask} />}
      {view === 'grid' && <Grid plan={plan} tasks={tasks} canEdit={canEdit} onOpen={setOpenTask} />}
      {view === 'schedule' && <Schedule tasks={tasks} onOpen={setOpenTask} />}
      {view === 'charts' && <Charts plan={plan} tasks={tasks} />}

      {openTask && <TaskDetailDialog taskId={openTask} onClose={() => setOpenTask(null)} />}
      {settings && <PlanSettingsDialog plan={plan} onClose={() => setSettings(false)} onDeleted={onDeleted} />}
    </div>
  );
}

// ------------------------------------------------------------------ board

function Board({ plan, tasks, groupBy, canEdit, onOpen }: { plan: PlanDetail; tasks: TaskInfo[]; groupBy: GroupBy; canEdit: boolean; onOpen: (id: string) => void }) {
  const today = localDay();
  const groups = useMemo(() => groupTasks(tasks, groupBy, plan, today), [tasks, groupBy, plan, today]);
  const update = useUpdateTask();
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const [dragging, setDragging] = useState<string | null>(null);
  const [newBucket, setNewBucket] = useState('');

  /** Moves a task into a column at an index: one PATCH with the new position and whatever the column implies. */
  const move = (task: TaskInfo, group: TaskGroup, index: number) => {
    const patch = { ...(dropPatch(groupBy, group.id, task, today) ?? {}), position: positionAt(group.tasks, index, task.id) };
    update.mutate({ id: task.id, patch });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(update.error || mutate.error) && <p className="mx-5 mt-2 text-sm text-danger">{errorText(update.error ?? mutate.error)}</p>}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {groups.map((g, gi) => (
          <section
            key={g.id || 'none'}
            aria-label={g.name}
            onDragOver={(e) => canEdit && dragging && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const task = tasks.find((t) => t.id === dragging);
              if (task) move(task, g, dropIndex(e, g.tasks));
              setDragging(null);
            }}
            className="flex w-72 shrink-0 flex-col rounded-lg bg-surface-2"
          >
            <ColumnHeader plan={plan} group={g} groupBy={groupBy} canEdit={canEdit} />
            {canEdit && <QuickAdd plan={plan} group={g} groupBy={groupBy} today={today} />}
            <ul className="min-h-12 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {g.tasks.map((t, ti) => (
                <li
                  key={t.id}
                  data-task
                  draggable={canEdit}
                  onDragStart={(e) => {
                    setDragging(t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={clsx(dragging === t.id && 'opacity-50')}
                >
                  <TaskCard
                    task={t}
                    plan={plan}
                    today={today}
                    onOpen={() => onOpen(t.id)}
                    onToggle={canEdit ? () => update.mutate({ id: t.id, patch: { progress: t.progress === 'completed' ? 'not_started' : 'completed' } }) : undefined}
                    // Keyboard alternative to drag and drop: Alt+arrows move within / across columns.
                    onKeyMove={canEdit ? (dx, dy) => {
                      if (dy) move(t, g, Math.max(0, Math.min(g.tasks.length - 1, ti + dy)) + (dy > 0 ? 1 : 0));
                      const target = groups[gi + dx];
                      if (dx && target) move(t, target, 0);
                    } : undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groupBy === 'bucket' && canEdit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newBucket.trim()) mutate.mutate(() => plannerApi.createBucket(plan.id, newBucket.trim()), { onSuccess: () => setNewBucket('') });
            }}
            className="w-64 shrink-0"
          >
            <input value={newBucket} onChange={(e) => setNewBucket(e.target.value)} placeholder="+ Add new bucket" aria-label="New bucket name" className={inputClass} />
          </form>
        )}
      </div>
    </div>
  );
}

/** Index among a column's cards where the pointer is (cards are measured from the DOM). */
function dropIndex(e: React.DragEvent, tasks: TaskInfo[]): number {
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-task]')];
  const i = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
  return i === -1 ? tasks.length : i;
}

function ColumnHeader({ plan, group, groupBy, canEdit }: { plan: PlanDetail; group: TaskGroup; groupBy: GroupBy; canEdit: boolean }) {
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, menu, () => setMenu(false));
  const bucket = groupBy === 'bucket' && group.id ? plan.buckets.find((b) => b.id === group.id) : undefined;
  const sorted = [...plan.buckets].sort((a, b) => a.position - b.position);
  const idx = bucket ? sorted.findIndex((b) => b.id === bucket.id) : -1;
  const shift = (dir: -1 | 1) => {
    const a = sorted[idx + dir];
    const b = sorted[idx + dir * 2];
    if (!bucket || !a) return;
    const position = b ? (a.position + b.position) / 2 : a.position + dir * 1024;
    mutate.mutate(() => plannerApi.updateBucket(bucket.id, { position }));
  };

  return (
    <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
      {renaming && bucket ? (
        <input
          autoFocus
          defaultValue={bucket.name}
          aria-label="Bucket name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== bucket.name) mutate.mutate(() => plannerApi.updateBucket(bucket.id, { name }));
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className={clsx(selectClass, 'flex-1 py-0.5')}
        />
      ) : (
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</h2>
      )}
      <span className="text-xs text-muted">{group.tasks.length}</span>
      {bucket && canEdit && (
        <div ref={ref} className="relative">
          <button onClick={() => setMenu((m) => !m)} aria-label={`${bucket.name} options`} aria-expanded={menu} className="rounded p-1 text-muted hover:bg-surface-hover">
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <div className="absolute top-7 right-0 z-20 w-40 rounded-md border border-border bg-surface py-1 text-sm shadow-lg">
              <button onClick={() => (setRenaming(true), setMenu(false))} className="block w-full px-3 py-1.5 text-left hover:bg-surface-hover">Rename</button>
              {idx > 0 && <button onClick={() => (shift(-1), setMenu(false))} className="block w-full px-3 py-1.5 text-left hover:bg-surface-hover">Move left</button>}
              {idx < sorted.length - 1 && <button onClick={() => (shift(1), setMenu(false))} className="block w-full px-3 py-1.5 text-left hover:bg-surface-hover">Move right</button>}
              <button
                onClick={() => {
                  setMenu(false);
                  if (confirm(`Delete “${bucket.name}” and its ${group.tasks.length} task(s)?`)) mutate.mutate(() => plannerApi.deleteBucket(bucket.id));
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-surface-hover"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuickAdd({ plan, group, groupBy, today }: { plan: PlanDetail; group: TaskGroup; groupBy: GroupBy; today: string }) {
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mx-2 mb-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-hover">
        <Plus size={15} /> Add task
      </button>
    );
  }
  const submit = () => {
    if (!title.trim()) return setOpen(false);
    // The new task lands in the column it was added to.
    const blank = { assignees: [], labels: [], progress: 'not_started', priority: 'medium', bucketId: null, dueDate: null } as unknown as TaskInfo;
    const patch = dropPatch(groupBy, group.id, blank, today) ?? {};
    mutate.mutate(
      () => plannerApi.createTask({
        planId: plan.id,
        title: title.trim(),
        bucketId: groupBy === 'bucket' && group.id ? group.id : undefined,
        priority: patch.priority,
        progress: patch.progress,
        dueDate: patch.dueDate,
        assigneeIds: patch.assigneeIds,
        labels: patch.labels,
      }),
      { onSuccess: () => setTitle('') },
    );
  };
  return (
    <form onSubmit={(e) => (e.preventDefault(), submit())} className="mx-2 mb-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder="Enter a task name"
        aria-label="New task name"
        className={inputClass}
      />
      {mutate.error && <p className="mt-1 text-xs text-danger">{errorText(mutate.error)}</p>}
    </form>
  );
}

function TaskCard({ task, plan, today, onOpen, onToggle, onKeyMove }: {
  task: TaskInfo;
  plan: PlanDetail;
  today: string;
  onOpen: () => void;
  onToggle?: () => void;
  onKeyMove?: (dx: number, dy: number) => void;
}) {
  const done = task.progress === 'completed';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        } else if (e.altKey && onKeyMove && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          onKeyMove(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
        }
      }}
      aria-label={`${task.title}. ${PROGRESS_LABEL[task.progress]}. Alt plus arrow keys to move.`}
      className="cursor-pointer rounded-md border border-border bg-surface p-2.5 shadow-sm hover:border-brand focus:border-brand focus:outline-none"
    >
      {task.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.labels.map((l) => <LabelChip key={l} color={l} name={plan.labels[l]} />)}
        </div>
      )}
      <div className="flex items-start gap-2">
        <button
          onClick={(e) => (e.stopPropagation(), onToggle?.())}
          disabled={!onToggle}
          aria-label={done ? 'Mark as not completed' : 'Mark as completed'}
          className="mt-0.5 shrink-0"
        >
          <ProgressIcon progress={task.progress} />
        </button>
        <span className={clsx('min-w-0 flex-1 text-sm break-words', done && 'text-muted line-through')}>{task.title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 empty:hidden">
        <PriorityBadge priority={task.priority} />
        <DueBadge task={task} today={today} />
        <TaskMeta task={task} />
        <span className="ml-auto">
          <Assignees people={task.assignees} />
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ grid

function Grid({ plan, tasks, canEdit, onOpen }: { plan: PlanDetail; tasks: TaskInfo[]; canEdit: boolean; onOpen: (id: string) => void }) {
  const today = localDay();
  const update = useUpdateTask();
  const [sort, setSort] = useState<'title' | 'due' | 'priority' | 'progress' | 'bucket'>('bucket');
  const bucketName = (id: string | null) => plan.buckets.find((b) => b.id === id)?.name ?? '—';
  const rank = { urgent: 0, important: 1, medium: 2, low: 3, not_started: 0, in_progress: 1, completed: 2 } as const;
  const bucketPos = new Map(plan.buckets.map((b) => [b.id, b.position]));
  const rows = [...tasks].sort((a, b) => {
    switch (sort) {
      case 'title': return a.title.localeCompare(b.title);
      case 'due': return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
      case 'priority': return rank[a.priority] - rank[b.priority];
      case 'progress': return rank[a.progress] - rank[b.progress];
      case 'bucket': return (bucketPos.get(a.bucketId ?? '') ?? 1e12) - (bucketPos.get(b.bucketId ?? '') ?? 1e12) || a.position - b.position;
    }
  });
  const th = (key: typeof sort, label: string, className = '') => (
    <th className={clsx('px-3 py-2 font-medium', className)} aria-sort={sort === key ? 'ascending' : 'none'}>
      <button onClick={() => setSort(key)} className={clsx('hover:text-text', sort === key && 'text-text')}>{label}</button>
    </th>
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <table className="w-full min-w-[720px] border-collapse rounded-lg bg-surface text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-border">
            <th className="w-8 px-3 py-2"><span className="sr-only">Done</span></th>
            {th('title', 'Task name')}
            <th className="px-3 py-2 font-medium">Assigned to</th>
            {th('progress', 'Progress', 'w-32')}
            {th('due', 'Due', 'w-28')}
            {th('priority', 'Priority', 'w-28')}
            {th('bucket', 'Bucket', 'w-36')}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-border hover:bg-surface-hover">
              <td className="px-3 py-2">
                <button
                  disabled={!canEdit}
                  onClick={() => update.mutate({ id: t.id, patch: { progress: t.progress === 'completed' ? 'not_started' : 'completed' } })}
                  aria-label={t.progress === 'completed' ? `Mark ${t.title} as not completed` : `Mark ${t.title} as completed`}
                >
                  <ProgressIcon progress={t.progress} />
                </button>
              </td>
              <td className="px-3 py-2">
                <button onClick={() => onOpen(t.id)} className={clsx('text-left hover:underline', t.progress === 'completed' && 'text-muted line-through')}>{t.title}</button>
              </td>
              <td className="px-3 py-2"><Assignees people={t.assignees} max={4} /></td>
              <td className="px-3 py-2 text-muted">{PROGRESS_LABEL[t.progress]}</td>
              <td className="px-3 py-2">{t.dueDate ? <DueBadge task={t} today={today} /> : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2 text-muted">{PRIORITY_LABEL[t.priority]}</td>
              <td className="truncate px-3 py-2 text-muted">{bucketName(t.bucketId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="p-6 text-center text-sm text-muted">No tasks yet.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ schedule

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Schedule({ tasks, onOpen }: { tasks: TaskInfo[]; onOpen: (id: string) => void }) {
  const today = localDay();
  const [month, setMonth] = useState(today.slice(0, 7));
  const first = `${month}-01`;
  // Grid starts on the Monday on or before the 1st and covers 6 weeks.
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekday);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, TaskInfo[]>();
  for (const t of tasks) if (t.dueDate) byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]);
  const unscheduled = tasks.filter((t) => !t.dueDate && t.progress !== 'completed');
  const shiftMonth = (n: number) => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const title = new Date(`${first}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4 max-lg:flex-col max-lg:overflow-y-auto">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded p-1.5 hover:bg-surface-hover"><ChevronLeft size={18} /></button>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded p-1.5 hover:bg-surface-hover"><ChevronRight size={18} /></button>
          <h2 className="font-semibold">{title}</h2>
          <button onClick={() => setMonth(today.slice(0, 7))} className="ml-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-hover">Today</button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(5rem,1fr))] overflow-hidden rounded-lg border border-border bg-border gap-px">
          {WEEKDAYS.map((d) => <div key={d} className="bg-surface-2 px-2 py-1 text-xs font-medium text-muted">{d}</div>)}
          {days.map((d) => (
            <div key={d} className={clsx('min-h-0 overflow-hidden bg-surface p-1', d.slice(0, 7) !== month && 'bg-surface-2/60')}>
              <div className={clsx('mb-0.5 text-right text-xs', d === today ? 'font-bold text-brand' : 'text-muted')}>{Number(d.slice(8))}</div>
              <ul className="space-y-0.5">
                {(byDay.get(d) ?? []).slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => onOpen(t.id)}
                      className={clsx(
                        'block w-full truncate rounded px-1.5 py-0.5 text-left text-xs',
                        t.progress === 'completed' ? 'bg-surface-2 text-muted line-through' : dueState(t, today) === 'overdue' ? 'bg-danger/15 text-danger' : 'bg-brand-soft text-brand',
                      )}
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
                {(byDay.get(d)?.length ?? 0) > 3 && <li className="px-1 text-[11px] text-muted">+{byDay.get(d)!.length - 3} more</li>}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <aside className="w-64 shrink-0 max-lg:w-full">
        <h2 className="mb-2 text-sm font-semibold">Unscheduled tasks</h2>
        {!unscheduled.length && <p className="text-xs text-muted">Every open task has a due date.</p>}
        <ul className="space-y-1">
          {unscheduled.map((t) => (
            <li key={t.id}>
              <button onClick={() => onOpen(t.id)} className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-sm hover:border-brand">
                <ProgressIcon progress={t.progress} size={14} /> <span className="truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ charts

function Charts({ plan, tasks }: { plan: PlanDetail; tasks: TaskInfo[] }) {
  const today = localDay();
  const open = tasks.filter((t) => t.progress !== 'completed');
  const late = open.filter((t) => dueState(t, today) === 'overdue').length;
  const tiles = [
    { label: 'Not started', value: tasks.filter((t) => t.progress === 'not_started').length },
    { label: 'In progress', value: tasks.filter((t) => t.progress === 'in_progress').length },
    { label: 'Completed', value: tasks.filter((t) => t.progress === 'completed').length },
    { label: 'Late', value: late, alert: late > 0 },
  ];
  const byBucket = [...plan.buckets].sort((a, b) => a.position - b.position).map((b) => ({ label: b.name, value: open.filter((t) => t.bucketId === b.id).length }));
  const byPriority = (['urgent', 'important', 'medium', 'low'] as const).map((p) => ({ label: PRIORITY_LABEL[p], value: open.filter((t) => t.priority === p).length }));
  const byMember = [
    { label: 'Unassigned', value: open.filter((t) => !t.assignees.length).length },
    ...plan.people.map((p) => ({ label: p.displayName, value: open.filter((t) => t.assignees.some((a) => a.id === p.id)).length })).filter((r) => r.value > 0),
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-6 grid max-w-4xl grid-cols-4 gap-3 max-md:grid-cols-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-surface p-4">
            <p className={clsx('text-3xl font-semibold tabular-nums', t.alert && 'text-danger')}>{t.value}</p>
            <p className="text-sm text-muted">{t.label}</p>
          </div>
        ))}
      </div>
      <div className="grid max-w-5xl grid-cols-3 gap-5 max-lg:grid-cols-1">
        <BarList title="Open tasks by bucket" rows={byBucket} />
        <BarList title="Open tasks by priority" rows={byPriority} />
        <BarList title="Open tasks by member" rows={byMember} />
      </div>
    </div>
  );
}

/** Horizontal single-series bars with direct value labels; the hover title repeats the exact count. */
function BarList({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
      {!rows.length && <p className="text-xs text-muted">Nothing to show.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} title={`${r.label}: ${r.value} task${r.value === 1 ? '' : 's'}`} className="text-xs">
            <div className="mb-0.5 flex justify-between gap-2">
              <span className="truncate">{r.label}</span>
              <span className="tabular-nums text-muted">{r.value}</span>
            </div>
            <div className="h-2 rounded bg-surface-2" aria-hidden>
              <div className="h-2 rounded bg-brand" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
