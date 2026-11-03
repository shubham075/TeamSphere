'use client';

import clsx from 'clsx';
import { ChevronDown, ChevronRight, Loader2, Plus, Star, Sun } from 'lucide-react';
import { useState } from 'react';
import type { TaskInfo, TodoList } from '@teamsphere/shared';
import { errorText } from '@/components/teams/ui';
import { formatDateTime } from '@/lib/i18n';
import { localDay, plannerApi, usePlannerMutation, useTodo, useUpdateTask } from '@/lib/planner';
import { DueBadge, PriorityBadge, ProgressIcon, TaskMeta } from './ui';

export const TODO_INFO: Record<TodoList, { label: string; empty: string }> = {
  myday: { label: 'My Day', empty: 'Focus on today: add tasks to My Day from any list. It starts fresh every morning.' },
  important: { label: 'Important', empty: 'Starred tasks and urgent or important plan tasks assigned to you show up here.' },
  planned: { label: 'Planned', empty: 'Tasks with a due date show up here.' },
  assigned: { label: 'Assigned to me', empty: 'Plan tasks assigned to you show up here.' },
  tasks: { label: 'Tasks', empty: 'Personal tasks only you can see. Add one above.' },
};

/** A To Do list. Personal tasks can be added straight from here; plan tasks open in their plan. */
export function TodoView({ list, onOpen }: { list: TodoList; onOpen: (id: string) => void }) {
  const { data, isLoading, error } = useTodo(list);
  const [title, setTitle] = useState('');
  const [showDone, setShowDone] = useState(false);
  const create = usePlannerMutation(() =>
    plannerApi.createTask({
      planId: null,
      title: title.trim(),
      important: list === 'important' || undefined,
      myDay: list === 'myday' ? localDay() : undefined,
      dueDate: list === 'planned' ? localDay() : undefined,
    }),
  );
  const open = (data ?? []).filter((t) => t.progress !== 'completed');
  const done = (data ?? []).filter((t) => t.progress === 'completed');
  const canAdd = list !== 'assigned';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border bg-surface px-6 py-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          {list === 'myday' && <Sun size={20} className="text-brand" />}
          {TODO_INFO[list].label}
        </h1>
        {list === 'myday' && <p className="text-xs text-muted">{formatDateTime(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })}</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {canAdd && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate(undefined, { onSuccess: () => setTitle('') });
            }}
            className="mb-4 flex items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-brand"
          >
            <Plus size={18} className="text-brand" aria-hidden />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" aria-label="Add a task" className="flex-1 bg-transparent py-2.5 text-sm outline-none" />
          </form>
        )}
        {create.error && <p className="mb-3 text-sm text-danger">{errorText(create.error)}</p>}
        {isLoading && <Loader2 className="animate-spin text-muted" />}
        {error && <p className="text-sm text-danger">{errorText(error)}</p>}
        {!isLoading && !data?.length && <p className="py-10 text-center text-sm text-muted">{TODO_INFO[list].empty}</p>}
        <ul className="space-y-1.5">
          {open.map((t) => <TodoRow key={t.id} task={t} onOpen={() => onOpen(t.id)} />)}
        </ul>
        {done.length > 0 && (
          <>
            <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="mt-4 mb-2 flex items-center gap-1 text-sm font-medium text-muted hover:text-text">
              {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Completed {done.length}
            </button>
            {showDone && <ul className="space-y-1.5">{done.map((t) => <TodoRow key={t.id} task={t} onOpen={() => onOpen(t.id)} />)}</ul>}
          </>
        )}
      </div>
    </div>
  );
}

function TodoRow({ task, onOpen }: { task: TaskInfo; onOpen: () => void }) {
  const update = useUpdateTask();
  const today = localDay();
  const done = task.progress === 'completed';
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 hover:bg-surface-hover">
      <button
        onClick={() => update.mutate({ id: task.id, patch: { progress: done ? 'not_started' : 'completed' } })}
        aria-label={done ? `Mark ${task.title} as not completed` : `Mark ${task.title} as completed`}
      >
        <ProgressIcon progress={task.progress} size={18} />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={clsx('block truncate text-sm', done && 'text-muted line-through')}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-x-2.5 text-xs text-muted">
          {task.planTitle ?? 'Tasks'}
          {task.myDay && <span className="flex items-center gap-0.5"><Sun size={12} aria-hidden /> My Day</span>}
          <DueBadge task={task} today={today} />
          {task.planId && <PriorityBadge priority={task.priority} />}
          <TaskMeta task={task} />
        </span>
      </button>
      {!task.planId && (
        <button
          onClick={() => update.mutate({ id: task.id, patch: { important: !task.important } })}
          aria-pressed={task.important}
          aria-label={task.important ? 'Remove importance' : 'Mark as important'}
          className={clsx('rounded p-1', task.important ? 'text-brand' : 'text-muted hover:text-text')}
        >
          <Star size={16} fill={task.important ? 'currentColor' : 'none'} />
        </button>
      )}
    </li>
  );
}
