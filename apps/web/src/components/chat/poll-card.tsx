'use client';

import clsx from 'clsx';
import { BarChart3, Check, Lock } from 'lucide-react';
import type { MessageInfo, PollInfo } from '@teamsphere/shared';
import { useClosePoll, useVote } from '@/lib/chat';

interface Props {
  message: MessageInfo;
  poll: PollInfo;
  meId: string;
  nameOf: (userId: string) => string;
  disabled?: boolean;
}

export function PollCard({ message, poll, meId, nameOf, disabled }: Props) {
  const vote = useVote();
  const close = useClosePoll();
  const mine = poll.options.flatMap((o, i) => (o.voterIds.includes(meId) ? [i] : []));
  const voters = new Set(poll.options.flatMap((o) => o.voterIds));
  const closed = !!poll.closedAt;
  const canVote = !closed && !disabled;

  const pick = (i: number) => {
    if (!canVote) return;
    const next = poll.multiple ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : mine.includes(i) ? [] : [i];
    vote.mutate({ messageId: message.id, options: next });
  };

  return (
    <div className="mt-1 w-72 max-w-full rounded-md border border-border bg-surface-2 p-3 not-italic">
      <p className="mb-2 flex items-start gap-2 font-semibold">
        <BarChart3 size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <span>{poll.question}</span>
      </p>
      <ul role={poll.multiple ? 'group' : 'radiogroup'} aria-label={poll.question} className="space-y-1.5">
        {poll.options.map((o, i) => {
          const picked = mine.includes(i);
          const share = voters.size ? Math.round((o.voterIds.length / voters.size) * 100) : 0;
          return (
            <li key={i}>
              <button
                role={poll.multiple ? 'checkbox' : 'radio'}
                aria-checked={picked}
                disabled={!canVote || vote.isPending}
                onClick={() => pick(i)}
                title={o.voterIds.map(nameOf).join(', ') || undefined}
                className={clsx(
                  'relative flex w-full items-center gap-2 overflow-hidden rounded border px-2.5 py-1.5 text-left text-sm',
                  picked ? 'border-brand' : 'border-border',
                  canVote && 'hover:bg-surface-hover',
                )}
              >
                <span className="absolute inset-y-0 left-0 bg-brand-soft" style={{ width: `${share}%` }} aria-hidden />
                <span
                  className={clsx(
                    'relative flex h-4 w-4 shrink-0 items-center justify-center border',
                    poll.multiple ? 'rounded-sm' : 'rounded-full',
                    picked ? 'border-brand bg-brand text-brand-text' : 'border-muted',
                  )}
                  aria-hidden
                >
                  {picked && <Check size={11} />}
                </span>
                <span className="relative min-w-0 flex-1 truncate">{o.text}</span>
                <span className="relative shrink-0 text-xs text-muted">
                  {o.voterIds.length} · {share}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="flex-1">
          {voters.size} {voters.size === 1 ? 'response' : 'responses'}
          {poll.multiple && ' · multiple choice'}
        </span>
        {closed ? (
          <span className="flex items-center gap-1">
            <Lock size={12} /> Closed
          </span>
        ) : (
          message.author?.id === meId &&
          !disabled && (
            <button onClick={() => close.mutate(message.id)} className="font-semibold text-brand hover:underline">
              Close poll
            </button>
          )
        )}
      </div>
    </div>
  );
}
