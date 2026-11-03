'use client';

import clsx from 'clsx';
import { Check, Loader2, MessageSquareText, Paperclip, Plus, Star, Sun, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TASK_LABEL_COLORS, TASK_PRIORITIES, TASK_PROGRESS, type PlanDetail, type TaskDetail, type UpdateTaskInput } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { errorText, Modal, inputClass, secondaryButton } from '@/components/teams/ui';
import { formatBytes, formatListTime, useConversations } from '@/lib/chat';
import { LABEL_COLORS, plannerApi, PRIORITY_LABEL, PROGRESS_LABEL, usePlan, usePlannerMutation, useTask, useUpdateTask } from '@/lib/planner';
import { selectClass } from './ui';

export function TaskDetailDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data: task, isLoading, error } = useTask(taskId);
  const { data: planData } = usePlan(task?.planId ?? null);
  return (
    <Modal title={task?.title ?? 'Task'} onClose={onClose} wide>
      {isLoading && <Loader2 className="animate-spin text-muted" />}
      {error && <p className="text-sm text-danger">{errorText(error) ?? 'This task is not available.'}</p>}
      {task && (!task.planId || planData) && <TaskBody task={task} plan={planData?.plan ?? null} onClose={onClose} />}
    </Modal>
  );
}

function TaskBody({ task, plan, onClose }: { task: TaskDetail; plan: PlanDetail | null; onClose: () => void }) {
  const update = useUpdateTask();
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const ro = !task.canEdit;
  const set = (patch: UpdateTaskInput) => update.mutate({ id: task.id, patch });
  const err = errorText(update.error ?? mutate.error);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.notes), [task.notes]);

  return (
    <div className="space-y-4 text-sm">
      {err && <p className="rounded border border-danger px-3 py-2 text-danger">{err}</p>}
      <div className="flex items-start gap-2">
        <input
          value={title}
          readOnly={ro}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== task.title && set({ title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Task name"
          className={clsx(inputClass, 'text-base font-semibold')}
        />
        <button
          onClick={() => mutate.mutate(() => plannerApi.setMyDay(task.id, !task.myDay))}
          aria-pressed={task.myDay}
          title={task.myDay ? 'Remove from My Day' : 'Add to My Day'}
          aria-label={task.myDay ? 'Remove from My Day' : 'Add to My Day'}
          className={clsx('rounded-md border border-border p-2', task.myDay ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-hover')}
        >
          <Sun size={16} />
        </button>
        {!task.planId && (
          <button
            onClick={() => set({ important: !task.important })}
            aria-pressed={task.important}
            aria-label={task.important ? 'Remove importance' : 'Mark as important'}
            title="Important"
            className={clsx('rounded-md border border-border p-2', task.important ? 'text-brand' : 'text-muted hover:bg-surface-hover')}
          >
            <Star size={16} fill={task.important ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {task.planTitle ? <>In plan <span className="font-medium text-text">{task.planTitle}</span></> : 'Personal task'}
        {task.createdBy && <> · created by {task.createdBy.displayName}</>}
        {task.completedBy && task.completedAt && <> · completed by {task.completedBy.displayName} {formatListTime(task.completedAt)}</>}
      </p>
      {task.source && <SourceLink conversationId={task.source.conversationId} />}

      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {plan && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Bucket</span>
            <select disabled={ro} value={task.bucketId ?? ''} onChange={(e) => set({ bucketId: e.target.value || null })} className={clsx(selectClass, 'w-full')}>
              <option value="">No bucket</option>
              {plan.buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Progress</span>
          <select disabled={ro} value={task.progress} onChange={(e) => set({ progress: e.target.value as TaskDetail['progress'] })} className={clsx(selectClass, 'w-full')}>
            {TASK_PROGRESS.map((p) => <option key={p} value={p}>{PROGRESS_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Priority</span>
          <select disabled={ro} value={task.priority} onChange={(e) => set({ priority: e.target.value as TaskDetail['priority'] })} className={clsx(selectClass, 'w-full')}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Start date</span>
          <input type="date" disabled={ro} value={task.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || null })} className={clsx(selectClass, 'w-full')} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Due date</span>
          <input type="date" disabled={ro} value={task.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} className={clsx(selectClass, 'w-full')} />
        </label>
      </div>

      {plan && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">Assigned to</legend>
          <div className="flex flex-wrap gap-1.5">
            {plan.people.map((p) => {
              const on = task.assignees.some((a) => a.id === p.id);
              const ids = task.assignees.map((a) => a.id);
              return (
                <button
                  key={p.id}
                  disabled={ro}
                  aria-pressed={on}
                  onClick={() => set({ assigneeIds: on ? ids.filter((id) => id !== p.id) : [...ids, p.id] })}
                  className={clsx('flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs', on ? 'border-brand bg-brand-soft text-brand' : 'border-border hover:bg-surface-hover')}
                >
                  <Avatar name={p.displayName} src={p.avatarUrl} size={20} /> {p.displayName}
                  {on && <Check size={12} aria-hidden />}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {plan && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">Labels</legend>
          <div className="flex flex-wrap gap-1.5">
            {TASK_LABEL_COLORS.map((c) => {
              const on = task.labels.includes(c);
              return (
                <button
                  key={c}
                  disabled={ro}
                  aria-pressed={on}
                  onClick={() => set({ labels: on ? task.labels.filter((l) => l !== c) : [...task.labels, c] })}
                  className={clsx('flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', on ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-hover')}
                >
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: LABEL_COLORS[c] }} />
                  {plan.labels[c] || c}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Notes</span>
        <textarea
          value={notes}
          readOnly={ro}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== task.notes && set({ notes })}
          placeholder={ro ? '' : 'Add a description'}
          className={inputClass}
        />
      </label>

      <Checklist task={task} ro={ro} />
      <Attachments task={task} ro={ro} />
      {task.planId && <Comments task={task} />}

      {!ro && (
        <div className="flex justify-end border-t border-border pt-3">
          <button
            onClick={() => confirm('Delete this task?') && mutate.mutate(() => plannerApi.deleteTask(task.id), { onSuccess: onClose })}
            className={clsx(secondaryButton, 'flex items-center gap-1.5 text-danger')}
          >
            <Trash2 size={14} /> Delete task
          </button>
        </div>
      )}
    </div>
  );
}

function SourceLink({ conversationId }: { conversationId: string }) {
  const { data: chats } = useConversations();
  // Conversations that aren't chats are team channels.
  const href = chats?.some((c) => c.id === conversationId) ? `/chat/${conversationId}` : `/teams?conversation=${conversationId}`;
  return (
    <Link href={href} className="flex w-fit items-center gap-1.5 text-xs text-brand hover:underline">
      <MessageSquareText size={14} /> Created from a message
    </Link>
  );
}

function Checklist({ task, ro }: { task: TaskDetail; ro: boolean }) {
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const [text, setText] = useState('');
  const done = task.checklistItems.filter((c) => c.done).length;
  return (
    <section aria-label="Checklist">
      <h3 className="mb-1 text-xs font-medium text-muted">Checklist {task.checklistItems.length > 0 && `· ${done}/${task.checklistItems.length}`}</h3>
      <ul className="space-y-0.5">
        {task.checklistItems.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-hover">
            <input
              type="checkbox"
              checked={c.done}
              disabled={ro}
              onChange={() => mutate.mutate(() => plannerApi.updateChecklistItem(c.id, { done: !c.done }))}
              aria-label={c.text}
              className="accent-[var(--brand)]"
            />
            <span className={clsx('flex-1', c.done && 'text-muted line-through')}>{c.text}</span>
            {!ro && (
              <button onClick={() => mutate.mutate(() => plannerApi.deleteChecklistItem(c.id))} aria-label={`Remove ${c.text}`} className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100">
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!ro && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) mutate.mutate(() => plannerApi.addChecklistItem(task.id, text.trim()), { onSuccess: () => setText('') });
          }}
          className="mt-1 flex items-center gap-2"
        >
          <Plus size={16} className="text-muted" aria-hidden />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item" aria-label="Add a checklist item" className="flex-1 bg-transparent py-1 outline-none" />
        </form>
      )}
    </section>
  );
}

function Attachments({ task, ro }: { task: TaskDetail; ro: boolean }) {
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-label="Attachments">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex-1 text-xs font-medium text-muted">Attachments</h3>
        {!ro && (
          <>
            <button onClick={() => input.current?.click()} disabled={mutate.isPending} className="flex items-center gap-1 text-xs text-brand hover:underline">
              {mutate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach file
            </button>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) mutate.mutate(() => plannerApi.addAttachment(task.id, file));
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
      {!task.attachments.length && <p className="text-xs text-muted">No attachments.</p>}
      <ul className="space-y-1">
        {task.attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <Paperclip size={14} className="text-muted" aria-hidden />
            <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{a.fileName}</a>
            <span className="text-xs text-muted">{formatBytes(a.size)}</span>
            {!ro && (
              <button onClick={() => mutate.mutate(() => plannerApi.deleteAttachment(a.id))} aria-label={`Remove ${a.fileName}`} className="rounded p-0.5 text-muted hover:text-danger">
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comments({ task }: { task: TaskDetail }) {
  const mutate = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const [body, setBody] = useState('');
  return (
    <section aria-label="Comments" className="border-t border-border pt-3">
      <h3 className="mb-2 text-xs font-medium text-muted">Comments</h3>
      <ul className="mb-2 space-y-3">
        {task.comments.map((c) => (
          <li key={c.id} className="group flex gap-2">
            <Avatar name={c.author?.displayName ?? '?'} src={c.author?.avatarUrl} size={28} />
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-semibold">{c.author?.displayName ?? 'Someone'}</span> <span className="text-muted">{formatListTime(c.createdAt)}</span>
              </p>
              <p className="break-words whitespace-pre-wrap">{c.body}</p>
            </div>
            <button onClick={() => mutate.mutate(() => plannerApi.deleteComment(c.id))} aria-label="Delete comment" className="self-start rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      {task.canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) mutate.mutate(() => plannerApi.addComment(task.id, body.trim()), { onSuccess: () => setBody('') });
          }}
          className="flex gap-2"
        >
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" aria-label="Write a comment" className={inputClass} />
          <button disabled={!body.trim() || mutate.isPending} className={secondaryButton}>Send</button>
        </form>
      )}
    </section>
  );
}
