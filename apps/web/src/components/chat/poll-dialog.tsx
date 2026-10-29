'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { MAX_POLL_OPTIONS, PollInput } from '@teamsphere/shared';

export function PollDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (poll: PollInput) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Create a poll"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCreate({ question: question.trim(), options: filled, multiple });
        }}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">Create a poll</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Question</span>
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              placeholder="What would you like to ask?"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-brand"
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Options</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={o}
                  onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={120}
                  placeholder={`Option ${i + 1}`}
                  aria-label={`Option ${i + 1}`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
                    aria-label={`Remove option ${i + 1}`}
                    className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_POLL_OPTIONS && (
              <button type="button" onClick={() => setOptions((list) => [...list, ''])} className="flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                <Plus size={15} /> Add option
              </button>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="accent-brand" />
            Allow multiple answers
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover">
            Cancel
          </button>
          <button type="submit" disabled={!valid} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50">
            Send poll
          </button>
        </div>
      </form>
    </div>
  );
}
