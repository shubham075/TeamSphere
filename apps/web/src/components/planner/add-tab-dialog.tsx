'use client';

import { LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import type { ChannelTabInfo } from '@teamsphere/shared';
import { errorText, Field, inputClass, Modal, primaryButton, secondaryButton } from '@/components/teams/ui';
import { plannerApi, usePlannerMutation, usePlans } from '@/lib/planner';

/** "+" in a channel's tab bar. Planner is the first app; later Phase 8 apps add their own choice here. */
export function AddTabDialog({ channelId, existing, onClose, onAdded }: {
  channelId: string;
  existing: ChannelTabInfo[];
  onClose: () => void;
  onAdded: (tabId: string) => void;
}) {
  const { data: plans } = usePlans();
  const tabbed = new Set(existing.filter((t) => t.app === 'planner').map((t) => t.refId));
  const available = (plans ?? []).filter((p) => p.channel?.id === channelId && !tabbed.has(p.id));
  const [choice, setChoice] = useState<string>('new');
  const [title, setTitle] = useState('');
  const add = usePlannerMutation(async () => {
    // Create first, then pin: the tab call returns the tab to switch to.
    const planId = choice === 'new' ? (await plannerApi.createPlan({ title: title.trim(), channelId })).id : choice;
    return plannerApi.addTab(channelId, planId);
  });
  const ready = choice !== 'new' || !!title.trim();

  return (
    <Modal
      title="Add a tab"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button disabled={!ready || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: (tab) => onAdded(tab.id) })} className={primaryButton}>Add</button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-3 rounded-md border border-brand bg-brand-soft p-3">
        <LayoutGrid className="text-brand" />
        <div>
          <p className="text-sm font-semibold">Planner</p>
          <p className="text-xs text-muted">Organize the channel’s work in buckets, with a board, grid, schedule and charts.</p>
        </div>
      </div>
      {add.error && <p className="mb-3 text-sm text-danger">{errorText(add.error)}</p>}
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 font-medium">Plan</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="plan" checked={choice === 'new'} onChange={() => setChoice('new')} className="accent-[var(--brand)]" />
          Create a new plan
        </label>
        {choice === 'new' && (
          <div className="pl-6">
            <Field label="Plan name">
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} className={inputClass} />
            </Field>
          </div>
        )}
        {available.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input type="radio" name="plan" checked={choice === p.id} onChange={() => setChoice(p.id)} className="accent-[var(--brand)]" />
            Use existing plan “{p.title}”
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
