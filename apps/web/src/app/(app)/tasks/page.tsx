'use client';

import clsx from 'clsx';
import { CalendarDays, CheckSquare, Hash, LayoutGrid, Plus, Star, Sun, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { TODO_LISTS, type TodoList } from '@teamsphere/shared';
import { NewPlanDialog } from '@/components/planner/dialogs';
import { PlanView } from '@/components/planner/plan-view';
import { TaskDetailDialog } from '@/components/planner/task-detail';
import { TODO_INFO, TodoView } from '@/components/planner/todo-view';
import { usePlans } from '@/lib/planner';

const LIST_ICONS: Record<TodoList, typeof Sun> = { myday: Sun, important: Star, planned: CalendarDays, assigned: User, tasks: CheckSquare };

export default function TasksPage() {
  return (
    <Suspense>
      <Planner />
    </Suspense>
  );
}

/** Planner app: To Do lists on top, plans below. `?list=`, `?plan=` and `?task=` (opens a task, e.g. from Activity). */
function Planner() {
  const params = useSearchParams();
  const router = useRouter();
  const planId = params.get('plan');
  const list = (TODO_LISTS as readonly string[]).includes(params.get('list') ?? '') ? (params.get('list') as TodoList) : 'myday';
  const taskId = params.get('task');
  const { data: plans } = usePlans();
  const [newPlan, setNewPlan] = useState(false);

  const go = useCallback((next: { list?: TodoList; plan?: string; task?: string | null }) => {
    const sp = new URLSearchParams();
    if (next.plan) sp.set('plan', next.plan);
    else if (next.list) sp.set('list', next.list);
    else if (planId) sp.set('plan', planId);
    else sp.set('list', list);
    if (next.task) sp.set('task', next.task);
    router.push(`/tasks?${sp}`);
  }, [router, planId, list]);

  const navItem = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm';
  return (
    <>
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface max-md:hidden">
        <h1 className="px-5 pt-4 pb-3 text-xl font-semibold">Planner</h1>
        <nav aria-label="Task lists" className="space-y-0.5 px-2">
          {TODO_LISTS.map((l) => {
            const Icon = LIST_ICONS[l];
            const active = !planId && list === l;
            return (
              <button key={l} onClick={() => go({ list: l })} aria-current={active ? 'page' : undefined} className={clsx(navItem, active ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover')}>
                <Icon size={17} /> {TODO_INFO[l].label}
              </button>
            );
          })}
        </nav>
        <div className="mt-4 flex items-center px-5 pb-1">
          <h2 className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">Plans</h2>
          <button onClick={() => setNewPlan(true)} aria-label="New plan" title="New plan" className="rounded p-1 text-muted hover:bg-surface-hover">
            <Plus size={16} />
          </button>
        </div>
        <nav aria-label="Plans" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {plans?.map((p) => {
            const active = planId === p.id;
            return (
              <button key={p.id} onClick={() => go({ plan: p.id })} aria-current={active ? 'page' : undefined} className={clsx(navItem, active ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover')}>
                {p.channel ? <Hash size={16} className="shrink-0" /> : <LayoutGrid size={16} className="shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.title}</span>
                  {p.channel && <span className="block truncate text-[11px] font-normal text-muted">{p.channel.teamName} › {p.channel.name}</span>}
                </span>
                {p.openTasks > 0 && <span className="text-xs font-normal text-muted">{p.openTasks}</span>}
              </button>
            );
          })}
          {plans && !plans.length && <p className="px-3 py-2 text-xs text-muted">No plans yet. Create one to organize work with buckets and boards.</p>}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        {/* Small screens: pick a list or plan from a select instead of the side pane. */}
        <div className="border-b border-border bg-surface px-4 py-2 md:hidden">
          <select
            aria-label="List or plan"
            value={planId ? `plan:${planId}` : `list:${list}`}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              go(kind === 'plan' ? { plan: id } : { list: id as TodoList });
            }}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {TODO_LISTS.map((l) => <option key={l} value={`list:${l}`}>{TODO_INFO[l].label}</option>)}
            {plans?.map((p) => <option key={p.id} value={`plan:${p.id}`}>{p.title}</option>)}
          </select>
        </div>
        {planId ? (
          <PlanView key={planId} planId={planId} onDeleted={() => go({ list: 'myday' })} />
        ) : (
          <TodoView list={list} onOpen={(id) => go({ task: id })} />
        )}
      </section>
      {taskId && <TaskDetailDialog taskId={taskId} onClose={() => go({ task: null })} />}
      {newPlan && <NewPlanDialog onClose={() => setNewPlan(false)} onCreated={(id) => (setNewPlan(false), go({ plan: id }))} />}
    </>
  );
}
