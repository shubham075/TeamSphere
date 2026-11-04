'use client';

import clsx from 'clsx';
import { BookOpen, ClipboardList, LayoutGrid, ListChecks, PenTool } from 'lucide-react';
import { useState } from 'react';
import type { ChannelTabApp, ChannelTabInfo } from '@teamsphere/shared';
import { errorText, Field, inputClass, Modal, primaryButton, secondaryButton } from '@/components/teams/ui';
import { boardsApi, useBoards } from '@/lib/pages';
import { formsApi, listsApi, LIST_TEMPLATES, newId, useForms, useLists } from '@/lib/lists';
import { plannerApi, usePlannerMutation, usePlans } from '@/lib/planner';

const APPS: { id: ChannelTabApp; label: string; icon: typeof LayoutGrid; description: string }[] = [
  { id: 'planner', label: 'Planner', icon: LayoutGrid, description: 'Organize the channel’s work in buckets, with a board, grid, schedule and charts.' },
  { id: 'wiki', label: 'Wiki', icon: BookOpen, description: 'The channel’s co-edited pages: how-tos, decisions, onboarding.' },
  { id: 'whiteboard', label: 'Whiteboard', icon: PenTool, description: 'An infinite canvas everyone in the channel can draw on.' },
  { id: 'list', label: 'List', icon: ListChecks, description: 'A table with your own columns: issues, assets, events.' },
  { id: 'form', label: 'Form', icon: ClipboardList, description: 'A survey or sign-up form for the channel, with live results.' },
];

const NOUN: Record<ChannelTabApp, string> = { planner: 'plan', wiki: 'wiki', whiteboard: 'whiteboard', list: 'list', form: 'form' };

/** "+" in a channel's tab bar: pick an app, then a new or existing item that belongs to the channel. */
export function AddTabDialog({ channelId, existing, onClose, onAdded }: {
  channelId: string;
  existing: ChannelTabInfo[];
  onClose: () => void;
  onAdded: (tabId: string) => void;
}) {
  const { data: plans } = usePlans();
  const { data: boards } = useBoards();
  const { data: lists } = useLists();
  const { data: forms } = useForms();
  const [app, setApp] = useState<ChannelTabApp>('planner');
  const [choice, setChoice] = useState<string>('new');
  const [title, setTitle] = useState('');
  const tabbed = new Set(existing.filter((t) => t.app === app).map((t) => t.refId));
  const available =
    app === 'planner'
      ? (plans ?? []).filter((p) => p.channel?.id === channelId && !tabbed.has(p.id)).map((p) => ({ id: p.id, title: p.title }))
      : app === 'whiteboard'
        ? (boards ?? []).filter((b) => b.channel?.id === channelId && !tabbed.has(b.id)).map((b) => ({ id: b.id, title: b.title }))
        : app === 'list'
          ? (lists ?? []).filter((l) => l.channel?.id === channelId && !tabbed.has(l.id)).map((l) => ({ id: l.id, title: l.title }))
          : app === 'form'
            ? (forms ?? []).filter((f) => f.channel?.id === channelId && !tabbed.has(f.id)).map((f) => ({ id: f.id, title: f.title }))
            : [];
  const hasWiki = existing.some((t) => t.app === 'wiki');
  const add = usePlannerMutation(async () => {
    // Create first, then pin: the tab call returns the tab to switch to (and is a no-op for an existing tab).
    if (app === 'wiki') return plannerApi.addTab(channelId, channelId, 'wiki');
    const refId =
      choice !== 'new' ? choice
        : app === 'planner' ? (await plannerApi.createPlan({ title: title.trim(), channelId })).id
          : app === 'list' ? (await listsApi.create({ title: title.trim(), channelId, columns: LIST_TEMPLATES[0].columns })).id
            : app === 'form' ? (await formsApi.create({ title: title.trim(), channelId, questions: [{ id: newId(), type: 'text', title: 'Your answer', required: false }] })).id
              : (await boardsApi.create({ title: title.trim() || 'Untitled board', channelId })).id;
    return plannerApi.addTab(channelId, refId, app);
  });
  const ready = app === 'wiki' ? !hasWiki : choice !== 'new' || app === 'whiteboard' || !!title.trim();

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
      <div role="radiogroup" aria-label="App" className="mb-4 space-y-2">
        {APPS.map((a) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={app === a.id}
            onClick={() => (setApp(a.id), setChoice('new'), setTitle(''))}
            className={clsx('flex w-full items-center gap-3 rounded-md border p-3 text-left', app === a.id ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-hover')}
          >
            <a.icon className="shrink-0 text-brand" />
            <span>
              <span className="block text-sm font-semibold">{a.label}</span>
              <span className="block text-xs text-muted">{a.description}</span>
            </span>
          </button>
        ))}
      </div>
      {add.error && <p className="mb-3 text-sm text-danger">{errorText(add.error)}</p>}
      {app === 'wiki' ? (
        <p className="text-sm text-muted">{hasWiki ? 'This channel already has a Wiki tab.' : 'Adds the channel’s wiki. You can create pages from the tab.'}</p>
      ) : (
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium capitalize">{NOUN[app]}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="item" checked={choice === 'new'} onChange={() => setChoice('new')} className="accent-[var(--brand)]" />
            Create a new {NOUN[app]}
          </label>
          {choice === 'new' && (
            <div className="pl-6">
              <Field label="Name">
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={app === 'whiteboard' ? 'Untitled board' : ''} maxLength={200} className={inputClass} />
              </Field>
            </div>
          )}
          {available.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input type="radio" name="item" checked={choice === p.id} onChange={() => setChoice(p.id)} className="accent-[var(--brand)]" />
              Use existing “{p.title}”
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
