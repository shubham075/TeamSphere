'use client';

import clsx from 'clsx';
import { AlertTriangle, ArrowDown, Calendar, CheckCircle2, Circle, CircleDot, Paperclip, MessageSquare, ListChecks, ChevronsUp } from 'lucide-react';
import type { PlanPerson, TaskInfo, TaskLabelColor, TaskPriority, TaskProgress } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { dueLabel, dueState, LABEL_COLORS, PRIORITY_LABEL, PROGRESS_LABEL } from '@/lib/planner';

export function ProgressIcon({ progress, size = 16 }: { progress: TaskProgress; size?: number }) {
  const label = PROGRESS_LABEL[progress];
  if (progress === 'completed') return <CheckCircle2 size={size} className="text-success" aria-label={label} />;
  if (progress === 'in_progress') return <CircleDot size={size} className="text-brand" aria-label={label} />;
  return <Circle size={size} className="text-muted" aria-label={label} />;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === 'medium') return null;
  const Icon = priority === 'low' ? ArrowDown : priority === 'urgent' ? AlertTriangle : ChevronsUp;
  return (
    <span className={clsx('flex items-center gap-0.5 text-xs', priority === 'low' ? 'text-muted' : 'text-danger')} title={PRIORITY_LABEL[priority]}>
      <Icon size={13} aria-hidden /> {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function LabelChip({ color, name }: { color: TaskLabelColor; name?: string }) {
  return (
    <span className="inline-flex max-w-32 items-center gap-1 truncate rounded-full border border-border px-1.5 py-px text-[11px]">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_COLORS[color] }} />
      <span className="truncate">{name || color}</span>
    </span>
  );
}

export function DueBadge({ task, today }: { task: Pick<TaskInfo, 'dueDate' | 'progress'>; today: string }) {
  if (!task.dueDate) return null;
  const state = dueState(task, today);
  return (
    <span className={clsx('flex items-center gap-1 text-xs', state === 'overdue' ? 'font-semibold text-danger' : state === 'today' ? 'text-brand' : 'text-muted')}>
      <Calendar size={12} aria-hidden />
      {state === 'overdue' && <span className="sr-only">Late:</span>}
      {dueLabel(task.dueDate, today)}
    </span>
  );
}

export function Assignees({ people, max = 3 }: { people: PlanPerson[]; max?: number }) {
  if (!people.length) return null;
  return (
    <span className="flex -space-x-1.5" aria-label={`Assigned to ${people.map((p) => p.displayName).join(', ')}`}>
      {people.slice(0, max).map((p) => (
        <span key={p.id} className="rounded-full ring-2 ring-surface" title={p.displayName}>
          <Avatar name={p.displayName} src={p.avatarUrl} size={22} />
        </span>
      ))}
      {people.length > max && <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface-2 text-[10px] ring-2 ring-surface">+{people.length - max}</span>}
    </span>
  );
}

/** Checklist / comment / attachment counters shown on cards and rows. */
export function TaskMeta({ task }: { task: TaskInfo }) {
  return (
    <>
      {task.checklist.total > 0 && (
        <span className="flex items-center gap-0.5 text-xs text-muted" title="Checklist">
          <ListChecks size={13} aria-hidden /> {task.checklist.done}/{task.checklist.total}
        </span>
      )}
      {task.commentCount > 0 && (
        <span className="flex items-center gap-0.5 text-xs text-muted" title="Comments">
          <MessageSquare size={13} aria-hidden /> {task.commentCount}
        </span>
      )}
      {task.attachmentCount > 0 && (
        <span className="flex items-center gap-0.5 text-xs text-muted" title="Attachments">
          <Paperclip size={13} aria-hidden /> {task.attachmentCount}
        </span>
      )}
    </>
  );
}

export const selectClass = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand';
