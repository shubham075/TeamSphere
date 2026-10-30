'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronUp, Loader2, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  BreakoutActionInput, MeetingLiveState, MeetingPollInfo, MeetingPollInput, MeetingQuestionInfo, MeetingUser,
} from '@teamsphere/shared';
import { api } from '@/lib/api';
import { fmtBytes, mk5, useMeetingPolls, useMeetingQuestions, useRecordings } from '@/lib/meetings';
import { formatCallDuration } from '@/lib/calls';

// Meeting panels for Phase 5b. They use currentColor-based styling so they read well both on the dark meeting
// stage and on the (themed) meeting details pane.

const input = 'w-full rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-brand';
const small = 'rounded px-2 py-0.5 text-xs hover:bg-current/10';

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

// ------------------------------------------------------------------ polls

export function PollsPanel({ meetingId, manage }: { meetingId: string; manage: boolean }) {
  const qc = useQueryClient();
  const { data: polls, isLoading } = useMeetingPolls(meetingId);
  const [creating, setCreating] = useState(false);
  const { error, run } = useRun();
  const set = (p: MeetingPollInfo[]) => qc.setQueryData(mk5.polls(meetingId), p);
  const act = (id: string, action: 'launch' | 'close' | 'delete') => run(async () => set(await api(`/meetings/polls/${id}`, { method: 'POST', json: { action } })));

  return (
    <div className="space-y-3 text-sm">
      {manage && (creating ? (
        <PollForm onCancel={() => setCreating(false)} onSave={(p) => run(async () => { set(await api(`/meetings/${meetingId}/polls`, { method: 'POST', json: p })); setCreating(false); })} />
      ) : (
        <button onClick={() => setCreating(true)} className="flex items-center gap-1 text-brand hover:underline"><Plus size={14} /> New poll</button>
      ))}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {isLoading && <Loader2 size={16} className="animate-spin" />}
      {polls && !polls.length && <p className="opacity-60">{manage ? 'No polls yet. Create one now or before the meeting.' : 'No polls yet.'}</p>}
      {[...(polls ?? [])].reverse().map((p) => (
        <PollCard key={p.id} poll={p} manage={manage} onAct={(a) => void act(p.id, a)} onVote={(o) => run(async () => set(await api(`/meetings/polls/${p.id}/vote`, { method: 'POST', json: { options: o } })))} />
      ))}
    </div>
  );
}

function PollForm({ onSave, onCancel }: { onSave: (p: MeetingPollInput) => void; onCancel: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;
  const save = (launch: boolean) => onSave({ question, options: options.map((o) => o.trim()).filter(Boolean), multiple, anonymous, launch });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="space-y-2 rounded-md border border-current/20 p-2">
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" aria-label="Poll question" maxLength={300} className={input} />
      {options.map((o, i) => (
        <input key={i} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} maxLength={100} className={input} />
      ))}
      {options.length < 10 && <button type="button" onClick={() => setOptions([...options, ''])} className={small}>+ Add option</button>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Multiple answers</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Anonymous responses</label>
      <div className="flex gap-2">
        <button type="submit" disabled={!valid} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Launch</button>
        <button type="button" disabled={!valid} onClick={() => save(false)} className="rounded border border-current/30 px-2 py-1 text-xs disabled:opacity-50">Save draft</button>
        <button type="button" onClick={onCancel} className={small}>Cancel</button>
      </div>
    </form>
  );
}

export function PollCard({ poll, manage, onAct, onVote }: {
  poll: MeetingPollInfo; manage: boolean; onAct: (a: 'launch' | 'close' | 'delete') => void; onVote: (options: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>(poll.myVotes);
  const canVote = poll.status === 'live';
  const total = poll.counts.reduce((a, b) => a + b, 0);
  const toggle = (i: number) => setPicked((p) => (poll.multiple ? (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]) : [i]));
  return (
    <section aria-label={`Poll: ${poll.question}`} className="rounded-md border border-current/20 p-2">
      <p className="mb-1 flex items-start gap-2 font-medium">
        <span className="flex-1">{poll.question}</span>
        <span className={clsx('rounded px-1.5 text-[10px] uppercase', poll.status === 'live' ? 'bg-brand text-white' : 'bg-current/10')}>{poll.status}</span>
      </p>
      <p className="mb-2 text-xs opacity-60">{poll.voters} {poll.voters === 1 ? 'response' : 'responses'}{poll.anonymous && ' · anonymous'}{poll.multiple && ' · multiple answers'}</p>
      <ul className="space-y-1">
        {poll.options.map((o, i) => {
          const pct = poll.counts.length && total ? Math.round((poll.counts[i] / total) * 100) : null;
          return (
            <li key={i}>
              <label className="relative flex cursor-pointer items-center gap-2 overflow-hidden rounded px-2 py-1 ring-1 ring-current/15">
                {pct !== null && <span aria-hidden className="absolute inset-y-0 left-0 bg-brand/25" style={{ width: `${pct}%` }} />}
                <input type={poll.multiple ? 'checkbox' : 'radio'} name={`poll-${poll.id}`} aria-label={o} disabled={!canVote} checked={picked.includes(i)} onChange={() => toggle(i)} className="relative" />
                <span className="relative flex-1">{o}</span>
                {pct !== null && <span className="relative text-xs tabular-nums">{poll.counts[i]} · {pct}%</span>}
              </label>
              {poll.votesByOption?.[i]?.length ? <p className="pl-7 text-[11px] opacity-60">{poll.votesByOption[i].map((u) => u.displayName).join(', ')}</p> : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        {canVote && (
          <button onClick={() => onVote(picked)} disabled={!picked.length} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">
            {poll.myVotes.length ? 'Change vote' : 'Vote'}
          </button>
        )}
        {manage && poll.status === 'draft' && <button onClick={() => onAct('launch')} className={clsx(small, 'flex items-center gap-1')}><Play size={12} /> Launch</button>}
        {manage && poll.status === 'live' && <button onClick={() => onAct('close')} className={clsx(small, 'flex items-center gap-1')}><Square size={12} /> Close</button>}
        {manage && <button onClick={() => confirm('Delete this poll?') && onAct('delete')} aria-label="Delete poll" className={clsx(small, 'text-red-400')}><Trash2 size={12} /></button>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Q&A

export function QnaPanel({ meetingId, moderator, moderated }: { meetingId: string; moderator: boolean; moderated: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useMeetingQuestions(meetingId);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const { error, busy, run } = useRun();
  const set = (q: MeetingQuestionInfo[]) => qc.setQueryData(mk5.questions(meetingId), q);
  const act = (id: string, action: string) => run(async () => set(await api(`/meetings/questions/${id}`, { method: 'POST', json: { action } })));
  const pending = data?.filter((q) => q.status === 'pending') ?? [];
  const open = data?.filter((q) => q.status === 'published') ?? [];
  const done = data?.filter((q) => q.status === 'answered' || q.status === 'dismissed') ?? [];

  const item = (q: MeetingQuestionInfo) => (
    <li key={q.id} className="rounded-md border border-current/15 p-2">
      <p className="text-xs opacity-60">{q.author ? q.author.displayName : 'Anonymous'}{q.mine && ' (you)'}{q.status === 'answered' && ' · answered'}{q.status === 'dismissed' && ' · dismissed'}</p>
      <p className="break-words">{q.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button
          onClick={() => void act(q.id, q.upvotedByMe ? 'unvote' : 'upvote')}
          disabled={q.mine || q.status !== 'published'}
          aria-pressed={q.upvotedByMe}
          aria-label={`Upvote (${q.upvotes})`}
          className={clsx('flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs ring-1 ring-current/20 disabled:opacity-50', q.upvotedByMe && 'bg-brand text-white')}
        >
          <ChevronUp size={12} /> {q.upvotes}
        </button>
        {moderator && q.status === 'pending' && <button onClick={() => void act(q.id, 'publish')} className={small}>Publish</button>}
        {moderator && q.status === 'published' && <button onClick={() => void act(q.id, 'answer')} className={clsx(small, 'flex items-center gap-0.5')}><Check size={12} /> Answered</button>}
        {moderator && (q.status === 'pending' || q.status === 'published') && <button onClick={() => void act(q.id, 'dismiss')} className={small}>Dismiss</button>}
        {(moderator || q.mine) && <button onClick={() => void act(q.id, 'delete')} aria-label="Delete question" className={clsx(small, 'text-red-400')}><Trash2 size={12} /></button>}
      </div>
    </li>
  );

  return (
    <div className="space-y-3 text-sm">
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(async () => { set(await api(`/meetings/${meetingId}/questions`, { method: 'POST', json: { text, anonymous } })); setText(''); }); }} className="space-y-1.5">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} placeholder="Ask a question" aria-label="Your question" className={input} />
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-1.5 text-xs"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Ask anonymously</label>
          <button type="submit" disabled={busy || !text.trim()} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Post</button>
        </div>
        {moderated && !moderator && <p className="text-[11px] opacity-60">Questions appear after a moderator publishes them.</p>}
      </form>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {isLoading && <Loader2 size={16} className="animate-spin" />}
      {moderator && pending.length > 0 && (
        <section><h3 className="mb-1 text-xs font-semibold uppercase opacity-60">Waiting for review ({pending.length})</h3><ul className="space-y-1.5">{pending.map(item)}</ul></section>
      )}
      {!moderator && pending.length > 0 && (
        <section><h3 className="mb-1 text-xs font-semibold uppercase opacity-60">Your pending questions</h3><ul className="space-y-1.5">{pending.map(item)}</ul></section>
      )}
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase opacity-60">Questions ({open.length})</h3>
        {open.length ? <ul className="space-y-1.5">{open.map(item)}</ul> : <p className="opacity-60">No questions yet.</p>}
      </section>
      {done.length > 0 && <section><h3 className="mb-1 text-xs font-semibold uppercase opacity-60">Answered</h3><ul className="space-y-1.5">{done.map(item)}</ul></section>}
    </div>
  );
}

// ------------------------------------------------------------------ breakout rooms (organizers)

export function BreakoutsPanel({ state, meId, organizerIds, onState, onVisit, currentRoomId }: {
  state: MeetingLiveState; meId: string; organizerIds: Set<string>; onState: (s: MeetingLiveState) => void;
  onVisit: (roomId: string | 'main') => void; currentRoomId: string | null;
}) {
  const b = state.breakouts;
  const [count, setCount] = useState(2);
  const [assign, setAssign] = useState<'auto' | 'manual'>('auto');
  const [minutes, setMinutes] = useState<string>('');
  const [message, setMessage] = useState('');
  const { error, busy, run } = useRun();
  const act = (body: BreakoutActionInput) => run(async () => onState(await api(`/meetings/sessions/${state.sessionId}/breakouts`, { method: 'POST', json: body })));
  const people: MeetingUser[] = state.participants.filter((p) => !organizerIds.has(p.id));
  const roomOf = (uid: string) => b?.rooms.find((r) => r.userIds.includes(uid))?.id ?? '';
  const name = (uid: string) => state.participants.find((p) => p.id === uid)?.displayName ?? 'Someone';

  return (
    <div className="space-y-3 text-sm">
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (!b || confirm('Recreate rooms? Current rooms and assignments are replaced.')) void act({ action: 'create', count, assign }); }} className="space-y-1.5 rounded-md border border-current/20 p-2">
        <label className="flex items-center gap-2">Rooms <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className={clsx(input, 'w-16')} /></label>
        <fieldset className="flex gap-3 text-xs">
          <legend className="sr-only">Assignment</legend>
          <label className="flex items-center gap-1"><input type="radio" checked={assign === 'auto'} onChange={() => setAssign('auto')} /> Automatically</label>
          <label className="flex items-center gap-1"><input type="radio" checked={assign === 'manual'} onChange={() => setAssign('manual')} /> Manually</label>
        </fieldset>
        <button type="submit" disabled={busy} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white">{b ? 'Recreate rooms' : 'Create rooms'}</button>
      </form>

      {b && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {b.open ? (
              <button onClick={() => void act({ action: 'close' })} className="rounded bg-danger px-2 py-1 text-xs font-semibold text-white">Close rooms</button>
            ) : (
              <>
                <label className="flex items-center gap-1 text-xs">Timer <input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} placeholder="min" aria-label="Timer in minutes" className={clsx(input, 'w-14')} /></label>
                <button onClick={() => void act({ action: 'open', minutes: minutes ? Math.min(240, Number(minutes)) : null })} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white">Open rooms</button>
              </>
            )}
            <button onClick={() => confirm('Delete all breakout rooms?') && void act({ action: 'delete' })} className={clsx(small, 'text-red-400')}>Delete rooms</button>
          </div>
          {b.open && b.endsAt && <p className="text-xs opacity-70">Rooms close at {new Date(b.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
          {b.open && (
            <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) void act({ action: 'broadcast', text: message }).then(() => setMessage('')); }} className="flex gap-1.5">
              <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Message to all rooms" aria-label="Message to all rooms" className={input} />
              <button type="submit" className="rounded bg-brand px-2 text-xs font-semibold text-white">Send</button>
            </form>
          )}
          <ul className="space-y-2">
            {b.rooms.map((r) => (
              <li key={r.id} className={clsx('rounded-md border p-2', currentRoomId === r.id ? 'border-brand' : 'border-current/20')}>
                <div className="flex items-center gap-2">
                  <RoomName name={r.name} onRename={(n) => void act({ action: 'rename', roomId: r.id, name: n })} />
                  {b.open && (currentRoomId === r.id
                    ? <button onClick={() => onVisit('main')} className={small}>Leave room</button>
                    : <button onClick={() => onVisit(r.id)} className={small}>Join room</button>)}
                </div>
                <p className="text-xs opacity-70">{r.userIds.length ? r.userIds.map((u) => `${name(u)}${b.open && !r.presentIds.includes(u) ? ' (not joined)' : ''}`).join(', ') : 'Nobody assigned'}</p>
              </li>
            ))}
          </ul>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase opacity-60">Assign people</h3>
            <ul className="space-y-1">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{p.displayName}{p.id === meId && ' (You)'}</span>
                  <select
                    value={roomOf(p.id)}
                    onChange={(e) => void act({ action: 'assign', userIds: [p.id], roomId: e.target.value || null })}
                    aria-label={`Room for ${p.displayName}`}
                    className="rounded border border-current/20 bg-transparent px-1 py-0.5 text-xs [&>option]:text-black"
                  >
                    <option value="">Main meeting</option>
                    {b.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </li>
              ))}
              {!people.length && <li className="opacity-60">Nobody to assign yet.</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function RoomName({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) return <button onClick={() => { setValue(name); setEditing(true); }} title="Rename" className="min-w-0 flex-1 truncate text-left font-medium hover:underline">{name}</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onRename(value.trim()); setEditing(false); }} className="flex-1">
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} autoFocus maxLength={60} aria-label="Room name" className={input} />
    </form>
  );
}

// ------------------------------------------------------------------ recordings (meeting details)

export function RecordingsList({ meetingId }: { meetingId: string }) {
  const { data, isLoading } = useRecordings(meetingId);
  if (isLoading) return <Loader2 size={16} className="animate-spin" />;
  if (!data?.length) return <p className="text-muted">No recordings.</p>;
  return (
    <ul className="space-y-3">
      {data.map((r) => (
        <li key={r.id}>
          <p className="text-xs text-muted">
            {new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {r.startedBy.displayName}
            {r.durationSec !== null && ` · ${formatCallDuration(r.durationSec)}`}{r.size !== null && ` · ${fmtBytes(r.size)}`}
            {' · '}expires {new Date(r.expiresAt).toLocaleDateString()}
          </p>
          {r.url ? (
            <video src={r.url} controls preload="metadata" className="mt-1 w-full rounded-md bg-black" aria-label="Meeting recording" />
          ) : (
            <p className={clsx('text-sm', r.status === 'failed' && 'text-danger')}>
              {r.status === 'recording' ? 'Recording in progress…' : r.status === 'processing' ? 'Processing…' : 'Recording failed.'}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
