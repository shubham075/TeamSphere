'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TASK_LABEL_COLORS, toPlainText, type MessageInfo, type PlanDetail, type PublicUser, type TaskLabelColor } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { errorText, Field, inputClass, Modal, PeoplePicker, primaryButton, secondaryButton } from '@/components/teams/ui';
import { useAuth } from '@/lib/auth-store';
import { LABEL_COLORS, localDay, plannerApi, usePlan, usePlannerMutation, usePlans } from '@/lib/planner';
import { useTeams } from '@/lib/teams';

/** Channels the signed-in user can add a plan to (not archived). */
function useWritableChannels() {
  const { data: teams } = useTeams();
  return (teams ?? [])
    .filter((t) => !t.archivedAt)
    .flatMap((t) => t.channels.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: `${t.name} › ${c.name}` })));
}

export function NewPlanDialog({ onClose, onCreated, channelId }: { onClose: () => void; onCreated: (planId: string) => void; channelId?: string }) {
  const channels = useWritableChannels();
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState<string>(channelId ?? '');
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [addTab, setAddTab] = useState(true);
  const meId = useAuth((s) => s.user?.id);
  const create = usePlannerMutation(() =>
    plannerApi.createPlan({ title: title.trim(), channelId: where || null, memberIds: where ? [] : members.map((m) => m.id), addTab: !!where && addTab }),
  );
  return (
    <Modal
      title="New plan"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button disabled={!title.trim() || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (p) => onCreated(p.id) })} className={primaryButton}>
            Create
          </button>
        </>
      }
    >
      {create.error && <p className="mb-3 text-sm text-danger">{errorText(create.error)}</p>}
      <Field label="Plan name">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} className={inputClass} />
      </Field>
      {!channelId && (
        <Field label="Where" hint={where ? 'Everyone in the channel can see and edit the plan.' : 'Only you and the people you add can see the plan.'}>
          <select value={where} onChange={(e) => setWhere(e.target.value)} className={inputClass}>
            <option value="">Personal plan</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      )}
      {where ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={addTab} onChange={(e) => setAddTab(e.target.checked)} className="accent-[var(--brand)]" />
          Add as a tab in the channel
        </label>
      ) : (
        <Field label="Share with (optional)">
          <PeoplePicker picked={members} onChange={setMembers} exclude={meId ? [meId] : []} />
        </Field>
      )}
    </Modal>
  );
}

export function PlanSettingsDialog({ plan, onClose, onDeleted }: { plan: PlanDetail; onClose: () => void; onDeleted?: () => void }) {
  const meId = useAuth((s) => s.user?.id);
  const [title, setTitle] = useState(plan.title);
  const [labels, setLabels] = useState<Partial<Record<TaskLabelColor, string>>>(plan.labels);
  const [adding, setAdding] = useState<PublicUser[]>([]);
  const save = usePlannerMutation(() => plannerApi.updatePlan(plan.id, { title: title.trim(), labels: Object.fromEntries(TASK_LABEL_COLORS.map((c) => [c, labels[c] ?? ''])) }));
  const members = usePlannerMutation((fn: () => Promise<unknown>) => fn());
  const del = usePlannerMutation(() => plannerApi.deletePlan(plan.id));
  const tab = usePlannerMutation(() => plannerApi.addTab(plan.channel!.id, plan.id));
  const canEdit = plan.role !== 'view';
  const isOwner = plan.role === 'owner';
  const err = errorText(save.error ?? members.error ?? del.error ?? tab.error);

  return (
    <Modal
      title="Plan settings"
      onClose={onClose}
      wide
      footer={
        canEdit && (
          <>
            <button onClick={onClose} className={secondaryButton}>Close</button>
            <button disabled={!title.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })} className={primaryButton}>Save</button>
          </>
        )
      }
    >
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      <Field label="Plan name">
        <input value={title} readOnly={!canEdit} onChange={(e) => setTitle(e.target.value)} maxLength={255} className={inputClass} />
      </Field>
      <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium">Labels</legend>
        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          {TASK_LABEL_COLORS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: LABEL_COLORS[c] }} />
              <span className="sr-only">{c} label name</span>
              <input value={labels[c] ?? ''} readOnly={!canEdit} onChange={(e) => setLabels({ ...labels, [c]: e.target.value })} placeholder={c} maxLength={40} className={inputClass} />
            </label>
          ))}
        </div>
      </fieldset>

      {plan.ownerType === 'user' ? (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-medium">People</h3>
          <ul className="mb-2 space-y-1">
            {[plan.owner, ...plan.members].filter((p) => !!p).map((p) => (
              <li key={p!.id} className="flex items-center gap-2 text-sm">
                <Avatar name={p!.displayName} src={p!.avatarUrl} size={24} />
                <span className="flex-1">{p!.displayName}{p!.id === plan.owner?.id && <span className="text-muted"> · Owner</span>}</span>
                {p!.id !== plan.owner?.id && (isOwner || p!.id === meId) && (
                  <button
                    onClick={() => members.mutate(() => plannerApi.removeMember(plan.id, p!.id), { onSuccess: () => p!.id === meId && (onClose(), onDeleted?.()) })}
                    className="text-xs text-danger hover:underline"
                  >
                    {p!.id === meId ? 'Leave' : 'Remove'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <>
              <PeoplePicker picked={adding} onChange={setAdding} exclude={[plan.owner?.id ?? '', ...plan.members.map((m) => m.id)]} />
              <button
                disabled={!adding.length || members.isPending}
                onClick={() => members.mutate(() => plannerApi.addMembers(plan.id, adding.map((a) => a.id)), { onSuccess: () => setAdding([]) })}
                className={`${secondaryButton} mt-2`}
              >
                Add {adding.length || ''} {adding.length === 1 ? 'person' : 'people'}
              </button>
            </>
          )}
        </section>
      ) : (
        <section className="mb-4 text-sm">
          <h3 className="mb-1 font-medium">Channel</h3>
          <p className="text-muted">Everyone in {plan.channel?.teamName} › {plan.channel?.name} can open this plan.</p>
          {canEdit && (
            <button disabled={tab.isPending || tab.isSuccess} onClick={() => tab.mutate()} className={`${secondaryButton} mt-2`}>
              {tab.isSuccess ? 'Tab added' : 'Add as a channel tab'}
            </button>
          )}
        </section>
      )}

      {isOwner && (
        <section className="border-t border-border pt-3">
          <button
            onClick={() => confirm(`Delete “${plan.title}” and all its tasks? This can’t be undone.`) && del.mutate(undefined, { onSuccess: () => (onClose(), onDeleted?.()) })}
            className="text-sm text-danger hover:underline"
          >
            Delete plan
          </button>
        </section>
      )}
    </Modal>
  );
}

/** "Create task" on a chat message or channel post: personal To Do or a plan the user can edit. */
export function CreateTaskFromMessageDialog({ message, onClose }: { message: MessageInfo; onClose: () => void }) {
  const router = useRouter();
  const { data: plans } = usePlans();
  const editable = (plans ?? []).filter((p) => p.role !== 'view');
  const [title, setTitle] = useState(() => toPlainText(message.body).replace(/\s+/g, ' ').trim().slice(0, 255));
  const [planId, setPlanId] = useState('');
  const [bucketId, setBucketId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const { data: plan } = usePlan(planId || null);
  const create = usePlannerMutation(() =>
      plannerApi.createTask({
        planId: planId || null,
        bucketId: planId ? bucketId || undefined : undefined,
        title: title.trim(),
        dueDate: dueDate || null,
        notes: message.author ? `From ${message.author.displayName}: ${toPlainText(message.body)}`.slice(0, 10_000) : undefined,
        source: { conversationId: message.conversationId, messageId: message.id },
      }),
  );
  return (
    <Modal
      title="Create task"
      onClose={onClose}
      footer={
        create.isSuccess ? (
          <>
            <button onClick={onClose} className={secondaryButton}>Close</button>
            <button onClick={() => router.push(planId ? `/tasks?plan=${planId}` : '/tasks?list=tasks')} className={primaryButton}>Open in Planner</button>
          </>
        ) : (
          <>
            <button onClick={onClose} className={secondaryButton}>Cancel</button>
            <button disabled={!title.trim() || create.isPending} onClick={() => create.mutate(undefined)} className={primaryButton}>Create</button>
          </>
        )
      }
    >
      {create.isSuccess ? (
        <p className="text-sm">Task created{planId && plan ? ` in ${plan.plan.title}` : ' in your tasks'}.</p>
      ) : (
        <>
          {create.error && <p className="mb-3 text-sm text-danger">{errorText(create.error)}</p>}
          <Field label="Task name">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} className={inputClass} />
          </Field>
          <Field label="Add to">
            <select value={planId} onChange={(e) => (setPlanId(e.target.value), setBucketId(''))} className={inputClass}>
              <option value="">My tasks (personal)</option>
              {editable.map((p) => <option key={p.id} value={p.id}>{p.title}{p.channel ? ` · ${p.channel.name}` : ''}</option>)}
            </select>
          </Field>
          {planId && plan && (
            <Field label="Bucket">
              <select value={bucketId} onChange={(e) => setBucketId(e.target.value)} className={inputClass}>
                {plan.plan.buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Due date (optional)">
            <input type="date" min={localDay()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </Field>
        </>
      )}
    </Modal>
  );
}
