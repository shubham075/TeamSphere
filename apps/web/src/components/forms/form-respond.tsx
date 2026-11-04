'use client';

import clsx from 'clsx';
import { CheckCircle2, Loader2, Star } from 'lucide-react';
import { useState } from 'react';
import type { FormDetail, FormQuestion } from '@teamsphere/shared';
import { errorText, inputClass, primaryButton } from '@/components/teams/ui';
import { formsApi, useListsMutation } from '@/lib/lists';

type Answers = Record<string, string | string[] | number>;

/** Filling in a form. `preview` renders it for authors without submitting. */
export function FormRespond({ form, preview }: { form: FormDetail; preview?: boolean }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const submit = useListsMutation(() => formsApi.submit(form.id, answers));

  if (done || (!preview && form.onePerPerson && form.responded)) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <CheckCircle2 size={36} className="text-success" />
        <p className="text-lg font-semibold">{done ? 'Thanks, your response was recorded.' : 'You’ve already responded.'}</p>
        {!form.onePerPerson && done && <button onClick={() => (setAnswers({}), setDone(false))} className="text-sm text-brand hover:underline">Submit another response</button>}
      </div>
    );
  }
  if (!preview && !form.accepting) {
    return <p className="py-10 text-center text-muted">{form.status === 'closed' || form.closesAt ? 'This form is closed and no longer accepts responses.' : 'This form isn’t open yet.'}</p>;
  }

  const set = (q: FormQuestion, v: Answers[string] | undefined) => {
    setAnswers((a) => {
      const next = { ...a };
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete next[q.id];
      else next[q.id] = v;
      return next;
    });
    setMissing((m) => { const n = new Set(m); n.delete(q.id); return n; });
  };
  const onSubmit = () => {
    const empty = new Set(form.questions.filter((q) => q.required && answers[q.id] === undefined).map((q) => q.id));
    setMissing(empty);
    if (empty.size) return document.getElementById(`q-${[...empty][0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!preview) submit.mutate(undefined, { onSuccess: () => setDone(true) });
  };

  return (
    <form onSubmit={(e) => (e.preventDefault(), onSubmit())} noValidate className="space-y-4">
      {form.anonymous && <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">Responses are anonymous: your name isn’t recorded with your answers.</p>}
      {form.questions.map((q, i) => (
        <fieldset key={q.id} id={`q-${q.id}`} className={clsx('rounded-lg border bg-surface p-4', missing.has(q.id) ? 'border-danger' : 'border-border')} aria-describedby={missing.has(q.id) ? `q-${q.id}-err` : undefined}>
          <legend className="sr-only">{q.title}</legend>
          <p className="font-medium">{i + 1}. {q.title}{q.required && <span className="text-danger" aria-label="required"> *</span>}</p>
          {q.description && <p className="mt-0.5 text-sm text-muted">{q.description}</p>}
          <div className="mt-3">
            <QuestionInput q={q} value={answers[q.id]} onChange={(v) => set(q, v)} />
          </div>
          {missing.has(q.id) && <p id={`q-${q.id}-err`} className="mt-2 text-xs text-danger">This question needs an answer.</p>}
        </fieldset>
      ))}
      {submit.error && <p className="text-sm text-danger">{errorText(submit.error)}</p>}
      <button type="submit" disabled={submit.isPending || preview} className={primaryButton}>
        {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : preview ? 'Submit (preview)' : 'Submit'}
      </button>
    </form>
  );
}

function QuestionInput({ q, value, onChange }: { q: FormQuestion; value: Answers[string] | undefined; onChange: (v: Answers[string] | undefined) => void }) {
  switch (q.type) {
    case 'text':
      return <input aria-label={q.title} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} maxLength={1000} className={inputClass} />;
    case 'longtext':
      return <textarea aria-label={q.title} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={4} maxLength={10000} className={inputClass} />;
    case 'number':
      return <input aria-label={q.title} type="number" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className={clsx(inputClass, 'w-48')} />;
    case 'date':
      return <input aria-label={q.title} type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={clsx(inputClass, 'w-48')} />;
    case 'choice':
      return (
        <div role="radiogroup" aria-label={q.title} className="space-y-1.5">
          {q.options?.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} className="accent-[var(--brand)]" /> {o}
            </label>
          ))}
        </div>
      );
    case 'multichoice': {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div role="group" aria-label={q.title} className="space-y-1.5">
          {q.options?.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.includes(o)} onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))} className="accent-[var(--brand)]" /> {o}
            </label>
          ))}
        </div>
      );
    }
    case 'rating': {
      const scale = q.scale ?? 5;
      return (
        <div role="radiogroup" aria-label={q.title} className="flex gap-1">
          {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of ${scale}`}
              onClick={() => onChange(value === n ? undefined : n)}
              className={clsx('rounded p-1', typeof value === 'number' && n <= value ? 'text-brand' : 'text-muted hover:text-text')}
            >
              <Star size={24} fill={typeof value === 'number' && n <= value ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
      );
    }
  }
}
