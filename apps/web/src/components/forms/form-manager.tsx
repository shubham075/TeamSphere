'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowUp, Copy, Download, Eye, Loader2, Lock, Plus, Send, Share2, Trash2, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FORM_QUESTION_TYPES, type FormDetail, type FormQuestion, type FormResults, type QuestionSummary } from '@teamsphere/shared';
import { ShareDialog } from '@/components/pages/share-dialog';
import { errorText, inputClass, Modal, primaryButton, secondaryButton } from '@/components/teams/ui';
import { formatListTime } from '@/lib/chat';
import { downloadCsv, formsApi, newId, QUESTION_LABEL, useForm, useFormResults, useListsMutation } from '@/lib/lists';
import { FormRespond } from './form-respond';

const STATUS: Record<FormDetail['status'], { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-surface-2 text-muted' },
  open: { label: 'Collecting responses', className: 'bg-success/15 text-success' },
  closed: { label: 'Closed', className: 'bg-danger/15 text-danger' },
};

/** Authors' view of a form: questions builder, responses, settings. `compact` drops the title row (channel tabs). */
export function FormManager({ formId, compact, onDeleted }: { formId: string; compact?: boolean; onDeleted?: () => void }) {
  const { data: form, isLoading, error } = useForm(formId);
  if (isLoading) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (!form) return <p className="p-6 text-sm text-muted">{errorText(error) ?? 'This form is not available.'}</p>;
  // People who may only answer get the respond view (e.g. a channel tab opened by a read-only member).
  if (form.role === 'respondent') return <div className="mx-auto w-full max-w-2xl overflow-y-auto p-6"><h1 className="mb-4 text-2xl font-semibold">{form.title}</h1><FormRespond form={form} /></div>;
  return <Manager key={form.id} form={form} compact={compact} onDeleted={onDeleted} />;
}

function Manager({ form, compact, onDeleted }: { form: FormDetail; compact?: boolean; onDeleted?: () => void }) {
  const [tab, setTab] = useState<'questions' | 'responses'>(form.status === 'draft' ? 'questions' : 'responses');
  const [share, setShare] = useState(false);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const mutate = useListsMutation((fn: () => Promise<unknown>) => fn());
  const editable = form.role !== 'view';
  const link = typeof window !== 'undefined' ? `${location.origin}/forms/${form.id}` : '';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="border-b border-border bg-surface px-5 pt-3">
        {!compact && (
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{form.title}</h1>
            {form.ownerType === 'user' && <button onClick={() => setShare(true)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface-hover"><Share2 size={15} /> Co-authors</button>}
            {editable && (form.ownerType !== 'user' || form.role === 'owner') && (
              <button onClick={() => confirm(`Delete “${form.title}” and all its responses?`) && mutate.mutate(() => formsApi.remove(form.id), { onSuccess: () => onDeleted?.() })} aria-label="Delete form" title="Delete form" className="rounded p-2 text-muted hover:bg-surface-hover hover:text-danger"><Trash2 size={17} /></button>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS[form.status].className)}>{STATUS[form.status].label}</span>
          {form.closesAt && <span className="text-xs text-muted">Closes {new Date(form.closesAt).toLocaleString()}</span>}
          <span className="flex-1" />
          <button onClick={() => setPreview(true)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-surface-hover"><Eye size={14} /> Preview</button>
          {form.status !== 'draft' && (
            <button onClick={() => void navigator.clipboard.writeText(link).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-surface-hover">
              <Copy size={14} /> {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          {editable && form.status !== 'open' && (
            <button onClick={() => mutate.mutate(() => formsApi.update(form.id, { status: 'open' }), { onSuccess: () => setTab('responses') })} className={clsx(primaryButton, 'flex items-center gap-1.5 py-1')}>
              {form.status === 'draft' ? <Send size={14} /> : <Unlock size={14} />} {form.status === 'draft' ? 'Publish' : 'Reopen'}
            </button>
          )}
          {editable && form.status === 'open' && (
            <button onClick={() => mutate.mutate(() => formsApi.update(form.id, { status: 'closed' }))} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-surface-hover"><Lock size={14} /> Close</button>
          )}
        </div>
        {mutate.error && <p className="mt-1 text-sm text-danger">{errorText(mutate.error)}</p>}
        <div role="tablist" aria-label="Form" className="mt-2 flex gap-4">
          {(['questions', 'responses'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('border-b-2 pb-2 text-sm capitalize', tab === t ? 'border-brand font-semibold' : 'border-transparent text-muted hover:text-text')}>
              {t === 'responses' ? `Responses (${form.responseCount})` : 'Questions'}
            </button>
          ))}
        </div>
      </header>
      {tab === 'questions' ? <Builder form={form} editable={editable} /> : <Results form={form} />}
      {preview && (
        <Modal title={`Preview: ${form.title}`} onClose={() => setPreview(false)} wide>
          {form.description && <p className="mb-4 text-sm text-muted">{form.description}</p>}
          <FormRespond form={form} preview />
        </Modal>
      )}
      {share && (
        <ShareDialog
          what="form"
          owner={form.owner}
          members={form.members}
          isOwner={form.role === 'owner'}
          onAdd={(ids) => formsApi.addMembers(form.id, ids)}
          onRemove={(id) => formsApi.removeMember(form.id, id)}
          onClose={() => setShare(false)}
          onLeft={onDeleted}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ builder

function Builder({ form, editable }: { form: FormDetail; editable: boolean }) {
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description);
  const [questions, setQuestions] = useState<FormQuestion[]>(form.questions);
  const [settings, setSettings] = useState({ anonymous: form.anonymous, onePerPerson: form.onePerPerson, closesAt: form.closesAt ? toLocalInput(form.closesAt) : '' });
  const save = useListsMutation(() => formsApi.update(form.id, {
    title: title.trim(), description, questions,
    anonymous: settings.anonymous, onePerPerson: settings.onePerPerson, closesAt: settings.closesAt ? new Date(settings.closesAt).toISOString() : null,
  }));
  // Pick up others' saves when nothing is being edited here.
  const server = JSON.stringify([form.title, form.description, form.questions, form.anonymous, form.onePerPerson, form.closesAt]);
  const local = JSON.stringify([title, description, questions, settings.anonymous, settings.onePerPerson, settings.closesAt ? new Date(settings.closesAt).toISOString() : null]);
  const dirty = server !== local;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (i: number, patch: Partial<FormQuestion>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => setQuestions((qs) => { const n = [...qs]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const add = (type: FormQuestion['type']) => setQuestions((qs) => [...qs, { id: newId(), type, title: '', required: false, ...(type === 'choice' || type === 'multichoice' ? { options: ['Option 1', 'Option 2'] } : {}), ...(type === 'rating' ? { scale: 5 } : {}) }]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-4">
        {form.responseCount > 0 && editable && <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">This form has {form.responseCount} responses. Changing or removing questions affects how existing answers are summarized.</p>}
        <fieldset disabled={!editable} className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Form title" maxLength={200} className="w-full bg-transparent text-2xl font-semibold outline-none" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" placeholder="Description (optional)" rows={2} maxLength={2000} className="mt-2 w-full resize-y bg-transparent text-sm outline-none" />
          </div>
          {questions.map((q, i) => (
            <div key={q.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-2 text-sm text-muted">{i + 1}.</span>
                <input value={q.title} onChange={(e) => set(i, { title: e.target.value })} aria-label={`Question ${i + 1}`} placeholder="Question" maxLength={300} className={clsx(inputClass, 'min-w-48 flex-1')} />
                <select value={q.type} onChange={(e) => {
                  const type = e.target.value as FormQuestion['type'];
                  set(i, { type, options: type === 'choice' || type === 'multichoice' ? (q.options?.length ? q.options : ['Option 1', 'Option 2']) : undefined, scale: type === 'rating' ? (q.scale ?? 5) : undefined });
                }} aria-label="Question type" className={clsx(inputClass, 'w-44')}>
                  {FORM_QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_LABEL[t]}</option>)}
                </select>
              </div>
              <input value={q.description ?? ''} onChange={(e) => set(i, { description: e.target.value || undefined })} aria-label="Question help text" placeholder="Help text (optional)" maxLength={1000} className="mt-2 ml-5 w-[calc(100%-1.25rem)] bg-transparent text-xs text-muted outline-none" />
              {(q.type === 'choice' || q.type === 'multichoice') && (
                <ul className="mt-2 ml-5 space-y-1.5">
                  {q.options?.map((o, k) => (
                    <li key={k} className="flex items-center gap-2">
                      <span aria-hidden className={clsx('h-3.5 w-3.5 border border-border', q.type === 'choice' ? 'rounded-full' : 'rounded-sm')} />
                      <input value={o} onChange={(e) => set(i, { options: q.options!.map((x, m) => (m === k ? e.target.value : x)) })} aria-label={`Option ${k + 1}`} maxLength={200} className="flex-1 border-b border-transparent bg-transparent text-sm outline-none focus:border-brand" />
                      <button type="button" disabled={q.options!.length <= 1} onClick={() => set(i, { options: q.options!.filter((_, m) => m !== k) })} aria-label={`Remove option ${k + 1}`} className="rounded p-0.5 text-muted hover:text-danger disabled:opacity-30"><Trash2 size={13} /></button>
                    </li>
                  ))}
                  <li><button type="button" onClick={() => set(i, { options: [...(q.options ?? []), `Option ${(q.options?.length ?? 0) + 1}`] })} className="text-xs text-brand hover:underline">+ Add option</button></li>
                </ul>
              )}
              {q.type === 'rating' && (
                <label className="mt-2 ml-5 flex items-center gap-2 text-xs text-muted">
                  Scale
                  <select value={q.scale ?? 5} onChange={(e) => set(i, { scale: Number(e.target.value) })} className="rounded border border-border bg-surface px-1 py-0.5">
                    {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n} stars</option>)}
                  </select>
                </label>
              )}
              <div className="mt-3 flex items-center gap-1 border-t border-border pt-2">
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} className="accent-[var(--brand)]" /> Required</label>
                <span className="flex-1" />
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move question up" className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30"><ArrowUp size={15} /></button>
                <button type="button" disabled={i === questions.length - 1} onClick={() => move(i, 1)} aria-label="Move question down" className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30"><ArrowDown size={15} /></button>
                <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label="Delete question" className="rounded p-1 text-muted hover:text-danger"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
            <span className="flex items-center gap-1 text-sm text-muted"><Plus size={15} /> Add</span>
            {FORM_QUESTION_TYPES.map((t) => <button key={t} type="button" onClick={() => add(t)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-hover">{QUESTION_LABEL[t]}</button>)}
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
            <h2 className="font-semibold">Settings</h2>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.anonymous} disabled={form.responseCount > 0} onChange={(e) => setSettings({ ...settings, anonymous: e.target.checked })} className="accent-[var(--brand)]" /> Anonymous responses {form.responseCount > 0 && <span className="text-xs text-muted">(can’t change after responses)</span>}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.onePerPerson} onChange={(e) => setSettings({ ...settings, onePerPerson: e.target.checked })} className="accent-[var(--brand)]" /> One response per person</label>
            <label className="flex items-center gap-2">Close automatically at <input type="datetime-local" value={settings.closesAt} onChange={(e) => setSettings({ ...settings, closesAt: e.target.value })} className="rounded border border-border bg-surface px-2 py-1" /></label>
            <p className="text-xs text-muted">{form.ownerType === 'channel' ? 'People in the channel can respond.' : 'Anyone in your organization with the link can respond.'}</p>
          </div>
        </fieldset>
        {editable && (
          <div className="sticky bottom-0 flex items-center gap-3 bg-bg py-2">
            <button disabled={!dirty || !title.trim() || save.isPending || questions.some((q) => !q.title.trim())} onClick={() => save.mutate(undefined)} className={primaryButton}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
            {dirty && <span className="text-xs text-muted">Unsaved changes{questions.some((q) => !q.title.trim()) && ' · every question needs a title'}</span>}
            {save.error && <span className="text-sm text-danger">{errorText(save.error)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// ------------------------------------------------------------------ results

function Results({ form }: { form: FormDetail }) {
  const { data, isLoading } = useFormResults(form.id);
  const [mode, setMode] = useState<'summary' | 'individual'>('summary');
  const byId = useMemo(() => new Map(form.questions.map((q) => [q.id, q])), [form.questions]);
  if (isLoading || !data) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-3xl font-semibold tabular-nums">{data.responseCount} <span className="text-base font-normal text-muted">response{data.responseCount === 1 ? '' : 's'}</span></p>
          <div role="group" aria-label="Results view" className="flex rounded-md border border-border text-sm">
            {(['summary', 'individual'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx('px-3 py-1 capitalize', mode === m ? 'bg-brand-soft text-brand' : 'text-muted')}>{m}</button>)}
          </div>
          <button disabled={!data.responseCount} onClick={() => void downloadCsv(`/forms/${form.id}/export`, `${form.title}.csv`)} className={clsx(secondaryButton, 'flex items-center gap-1.5 py-1')}><Download size={14} /> Export CSV</button>
        </div>
        {!data.responseCount && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">{form.status === 'draft' ? 'Publish the form and share its link to collect responses.' : 'No responses yet.'}</p>}
        {data.responseCount > 0 && mode === 'summary' && data.questions.map((s, i) => byId.get(s.questionId) && <SummaryCard key={s.questionId} index={i + 1} q={byId.get(s.questionId)!} s={s} />)}
        {data.responseCount > 0 && mode === 'individual' && <Individual form={form} results={data} />}
      </div>
    </div>
  );
}

function SummaryCard({ index, q, s }: { index: number; q: FormQuestion; s: QuestionSummary }) {
  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="mb-3">
        <span className="font-medium">{index}. {q.title}</span>
        <span className="ml-2 text-xs text-muted">{s.answered} answered</span>
      </figcaption>
      {'counts' in s && <Bars rows={s.counts.map((c) => ({ label: c.option, value: c.count }))} total={s.answered} />}
      {'average' in s && (
        <>
          <p className="mb-2 text-sm"><span className="text-2xl font-semibold tabular-nums">{s.average ?? '—'}</span> <span className="text-muted">average{s.min !== null && ` · min ${s.min} · max ${s.max}`}</span></p>
          {s.distribution.length > 0 && <Bars rows={s.distribution.map((d) => ({ label: `${d.value} ★`, value: d.count }))} total={s.answered} />}
        </>
      )}
      {'latest' in s && (
        <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm">
          {s.latest.map((t, i) => <li key={i} className="rounded bg-surface-2 px-2.5 py-1.5 break-words whitespace-pre-wrap">{t}</li>)}
          {s.answered > s.latest.length && <li className="text-xs text-muted">Showing the latest {s.latest.length}. Export to see all.</li>}
        </ul>
      )}
    </figure>
  );
}

/** Single-series horizontal bars with direct count and share labels. */
function Bars({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value}`} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="text-muted tabular-nums">{r.value}{total > 0 && ` · ${Math.round((r.value / total) * 100)}%`}</span>
          </div>
          <div className="h-2 rounded bg-surface-2" aria-hidden><div className="h-2 rounded bg-brand" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Individual({ form, results }: { form: FormDetail; results: FormResults }) {
  const [i, setI] = useState(0);
  const r = results.responses[i];
  if (!r) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <button disabled={i === 0} onClick={() => setI(i - 1)} className={secondaryButton}>Newer</button>
        <span className="flex-1 text-center text-muted">{i + 1} of {results.responses.length} · {form.anonymous ? 'Anonymous' : (r.respondent?.displayName ?? 'Someone')} · {formatListTime(r.createdAt)}</span>
        <button disabled={i === results.responses.length - 1} onClick={() => setI(i + 1)} className={secondaryButton}>Older</button>
      </div>
      <dl className="space-y-3 text-sm">
        {form.questions.map((q) => (
          <div key={q.id}>
            <dt className="font-medium">{q.title}</dt>
            <dd className="text-muted">{r.answers[q.id] === undefined ? '—' : Array.isArray(r.answers[q.id]) ? (r.answers[q.id] as string[]).join(', ') : String(r.answers[q.id])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
