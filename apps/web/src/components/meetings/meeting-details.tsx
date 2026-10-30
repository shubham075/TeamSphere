'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CalendarClock, Check, ChevronDown, ChevronRight, CircleHelp, Copy, Hash, Loader2, MapPin, MessageSquare, Repeat, Settings,
  Trash2, Users, Video, X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MeetingInfo, MeetingOccurrence, RsvpInput, RsvpState } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { errorText, inputClass, primaryButton, secondaryButton } from '@/components/teams/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { formatCallDuration } from '@/lib/calls';
import {
  canJoinNow, countdown, fmtRange, fmtTime, mk, recurrenceLabel, ROLE_LABEL, RSVP_LABEL, toLocalInput, useAttendance, useMeeting,
} from '@/lib/meetings';
import { MeetingForm } from './meeting-form';

/** Side panel for one meeting occurrence: details, RSVP, join, and organizer actions. */
export function MeetingDetails({ occurrence, meetingId, onClose }: { occurrence: MeetingOccurrence | null; meetingId: string; onClose: () => void }) {
  const { data: meeting, isLoading } = useMeeting(meetingId);
  return (
    <aside aria-label="Meeting details" className="flex w-full max-w-md shrink-0 flex-col border-l border-border bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="truncate text-lg font-semibold">{meeting?.title ?? occurrence?.title ?? 'Meeting'}</h2>
        <button onClick={onClose} aria-label="Close details" className="rounded p-1 hover:bg-surface-hover"><X size={18} /></button>
      </div>
      {isLoading || !meeting ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin" /></div>
      ) : (
        <DetailsBody meeting={meeting} occurrence={occurrence} onClose={onClose} />
      )}
    </aside>
  );
}

function DetailsBody({ meeting, occurrence, onClose }: { meeting: MeetingInfo; occurrence: MeetingOccurrence | null; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState<'series' | 'occurrence' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOrganizer = meeting.myRole === 'organizer' || meeting.myRole === 'coorganizer';
  const recurring = !!meeting.recurrence;
  const startAt = occurrence?.startAt ?? meeting.startAt;
  const endAt = occurrence?.endAt ?? meeting.endAt;
  const live = !!meeting.liveSessionId;
  const joinable = canJoinNow({ startAt, endAt, live }) && !meeting.cancelledAt && !occurrence?.cancelled;
  const soon = countdown(startAt);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: mk.all });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const cancel = (scope: 'occurrence' | 'series') =>
    run(async () => {
      if (!confirm(scope === 'series' ? `Cancel "${meeting.title}" for everyone?` : 'Cancel this occurrence for everyone?')) return;
      const q = scope === 'occurrence' && occurrence ? `?occurrence=${encodeURIComponent(occurrence.occurrence)}` : '';
      await api(`/meetings/${meeting.id}${q}`, { method: 'DELETE' });
      onClose();
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
      {meeting.cancelledAt && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-danger">This meeting was cancelled.</p>}
      {occurrence?.cancelled && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-danger">This occurrence was cancelled.</p>}
      <div className="mb-3 space-y-1.5">
        <p className="flex items-center gap-2"><CalendarClock size={16} className="text-muted" /> {fmtRange(startAt, endAt)}</p>
        {recurring && <p className="flex items-center gap-2"><Repeat size={16} className="text-muted" /> {recurrenceLabel(meeting.recurrence)} ({meeting.timeZone})</p>}
        {meeting.channelName && <p className="flex items-center gap-2"><Hash size={16} className="text-muted" /> {meeting.channelName}</p>}
        {meeting.location && <p className="flex items-center gap-2"><MapPin size={16} className="text-muted" /> {meeting.location}</p>}
        <p className="flex items-center gap-2 text-muted">
          Meeting ID <span className="font-mono text-text">{meeting.joinCode.replace(/^(\d{4})(\d{3})(\d+)$/, '$1 $2 $3')}</span>
          <button
            onClick={() => void navigator.clipboard?.writeText(`${location.origin}/meetings/${meeting.id}`)}
            aria-label="Copy join link"
            title="Copy join link"
            className="rounded p-1 hover:bg-surface-hover"
          >
            <Copy size={14} />
          </button>
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {joinable && (
          <button onClick={() => router.push(`/meetings/${meeting.id}${occurrence ? `?occurrence=${encodeURIComponent(occurrence.occurrence)}` : ''}`)} className={clsx(primaryButton, 'flex items-center gap-1.5')}>
            <Video size={16} /> Join{live ? ' (in progress)' : ''}
          </button>
        )}
        {!joinable && soon && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">Starts {soon}</span>}
        <Link href={`/chat/${meeting.conversationId}`} className={clsx(secondaryButton, 'flex items-center gap-1.5')}>
          <MessageSquare size={16} /> Chat
        </Link>
        {isOrganizer && (
          <Link href={`/meetings/${meeting.id}/options`} className={clsx(secondaryButton, 'flex items-center gap-1.5')}>
            <Settings size={16} /> Options
          </Link>
        )}
      </div>

      {meeting.myRole && meeting.myRole !== 'organizer' && !meeting.cancelledAt && (
        <Rsvp meeting={meeting} occurrence={occurrence} busy={busy} run={run} />
      )}

      {isOrganizer && !meeting.cancelledAt && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={() => setEditing('series')} className={secondaryButton}>{recurring ? 'Edit series' : 'Edit'}</button>
          {recurring && occurrence && <button onClick={() => setEditing('occurrence')} className={secondaryButton}>Move this occurrence</button>}
          {recurring && occurrence && !occurrence.cancelled && (
            <button onClick={() => void cancel('occurrence')} disabled={busy} className={clsx(secondaryButton, 'text-danger')}>Cancel occurrence</button>
          )}
          <button onClick={() => void cancel('series')} disabled={busy} className={clsx(secondaryButton, 'flex items-center gap-1.5 text-danger')}>
            <Trash2 size={14} /> {recurring ? 'Cancel series' : 'Cancel meeting'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}

      {meeting.description && <p className="mb-4 whitespace-pre-wrap">{meeting.description}</p>}

      <h3 className="mb-2 flex items-center gap-2 font-semibold"><Users size={16} /> People ({meeting.attendees.length})</h3>
      <ul className="mb-4 space-y-1.5">
        {meeting.attendees.map((a) => {
          const rsvp: RsvpState = (occurrence && meeting.exceptions[occurrence.occurrence]?.rsvp?.[a.user.id]) || a.rsvp;
          return (
            <li key={a.user.id} className="flex items-center gap-2">
              <Avatar name={a.user.displayName} src={a.user.avatarUrl} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.user.displayName}</span>
                <span className="block text-xs text-muted">
                  {ROLE_LABEL[a.role]}{!a.required && ' · Optional'}
                  {a.proposedStartAt && ` · Proposed ${fmtRange(a.proposedStartAt, a.proposedEndAt!)}`}
                </span>
              </span>
              <RsvpBadge rsvp={rsvp} />
            </li>
          );
        })}
      </ul>

      {isOrganizer && <Attendance meetingId={meeting.id} />}

      {editing && (
        <MeetingForm
          meeting={meeting}
          occurrence={editing === 'occurrence' && occurrence ? occurrence : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RsvpBadge({ rsvp }: { rsvp: RsvpState }) {
  const Icon = rsvp === 'accepted' ? Check : rsvp === 'declined' ? X : CircleHelp;
  return (
    <span
      title={RSVP_LABEL[rsvp]}
      aria-label={RSVP_LABEL[rsvp]}
      role="img"
      className={clsx('flex h-5 w-5 items-center justify-center rounded-full', rsvp === 'accepted' ? 'bg-success text-white' : rsvp === 'declined' ? 'bg-danger text-white' : 'bg-surface-2 text-muted')}
    >
      <Icon size={12} />
    </span>
  );
}

function Rsvp({ meeting, occurrence, busy, run }: { meeting: MeetingInfo; occurrence: MeetingOccurrence | null; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const recurring = !!meeting.recurrence;
  const [scope, setScope] = useState<'series' | 'occurrence'>('series');
  const [proposing, setProposing] = useState(false);
  const base = occurrence ?? { startAt: meeting.startAt, endAt: meeting.endAt };
  const [pStart, setPStart] = useState(toLocalInput(new Date(base.startAt)));
  const [pEnd, setPEnd] = useState(toLocalInput(new Date(base.endAt)));
  const meId = useAuth((s) => s.user?.id);
  // Read from the (refetched) meeting, not the calendar snapshot the panel was opened with.
  const perOccurrence = occurrence && meId ? meeting.exceptions[occurrence.occurrence]?.rsvp?.[meId] : undefined;
  const current: RsvpState = perOccurrence ?? meeting.attendees.find((a) => a.user.id === meId)?.rsvp ?? 'none';

  const answer = (rsvp: RsvpInput['rsvp'], propose = false) =>
    run(() =>
      api(`/meetings/${meeting.id}/rsvp`, {
        method: 'POST',
        json: {
          rsvp,
          occurrence: recurring && scope === 'occurrence' && occurrence ? occurrence.occurrence : undefined,
          ...(propose ? { proposedStartAt: new Date(pStart).toISOString(), proposedEndAt: new Date(pEnd).toISOString() } : {}),
        } satisfies RsvpInput,
      }).then(() => setProposing(false)),
    );

  return (
    <div className="mb-4 rounded-lg border border-border p-3">
      <p className="mb-2 text-xs text-muted">Your response: <strong className="text-text">{RSVP_LABEL[current]}</strong></p>
      {recurring && occurrence && (
        <div role="radiogroup" aria-label="Respond to" className="mb-2 flex gap-3 text-xs">
          {(['series', 'occurrence'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="radio" name="rsvp-scope" checked={scope === s} onChange={() => setScope(s)} /> {s === 'series' ? 'All occurrences' : 'This occurrence'}
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {(['accepted', 'tentative', 'declined'] as const).map((r) => (
          <button key={r} onClick={() => void answer(r)} disabled={busy} aria-pressed={current === r} className={clsx(secondaryButton, current === r && 'border-brand text-brand')}>
            {{ accepted: 'Accept', tentative: 'Tentative', declined: 'Decline' }[r]}
          </button>
        ))}
        <button onClick={() => setProposing((v) => !v)} aria-expanded={proposing} className="flex items-center gap-1 text-xs text-brand hover:underline">
          {proposing ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Propose new time
        </button>
      </div>
      {proposing && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" aria-label="Proposed start" value={pStart} onChange={(e) => setPStart(e.target.value)} className={inputClass} />
            <input type="datetime-local" aria-label="Proposed end" value={pEnd} onChange={(e) => setPEnd(e.target.value)} className={inputClass} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => void answer('tentative', true)} disabled={busy} className={secondaryButton}>Tentative & propose</button>
            <button onClick={() => void answer('declined', true)} disabled={busy} className={secondaryButton}>Decline & propose</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Attendance({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useAttendance(meetingId, open);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mb-2 flex items-center gap-1 font-semibold">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Attendance
      </button>
      {open && (isLoading ? <Loader2 size={16} className="animate-spin" /> : !data?.length ? (
        <p className="text-muted">Nobody has joined yet.</p>
      ) : (
        data.map((s) => (
          <div key={s.sessionId} className="mb-3">
            <p className="mb-1 text-xs text-muted">
              {new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              {s.endedAt ? ` – ${fmtTime(s.endedAt)}` : ' · in progress'}
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr><th className="py-1 font-medium">Name</th><th className="font-medium">Role</th><th className="font-medium">Joined</th><th className="font-medium">Left</th><th className="font-medium">Duration</th></tr>
              </thead>
              <tbody>
                {s.records.map((r) => (
                  <tr key={r.user.id} className="border-t border-border/50">
                    <td className="py-1">{r.user.displayName}</td>
                    <td>{ROLE_LABEL[r.role]}</td>
                    <td>{fmtTime(r.firstJoinAt)}</td>
                    <td>{r.lastLeaveAt ? fmtTime(r.lastLeaveAt) : '—'}</td>
                    <td className="tabular-nums">{formatCallDuration(r.durationSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      ))}
    </div>
  );
}
