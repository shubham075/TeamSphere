'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MeetingInfo, MeetingOptions, MeetingRole, UpdateMeetingOptionsInput } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { errorText, inputClass, primaryButton } from '@/components/teams/ui';
import { api } from '@/lib/api';
import { mk, ROLE_LABEL, useMeeting } from '@/lib/meetings';

/** Meeting options page (organizers): lobby, presenters, attendee mic/camera, chat & reactions, and roles. */
export default function MeetingOptionsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: meeting } = useMeeting(id);
  if (!meeting) return <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (meeting.myRole !== 'organizer' && meeting.myRole !== 'coorganizer') {
    return <p className="p-8 text-sm text-muted">Only organizers can change meeting options.</p>;
  }
  return <OptionsForm meeting={meeting} />;
}

function OptionsForm({ meeting }: { meeting: MeetingInfo }) {
  const qc = useQueryClient();
  const [options, setOptions] = useState<MeetingOptions>(meeting.options);
  const [roles, setRoles] = useState<Record<string, MeetingRole>>(() => Object.fromEntries(meeting.attendees.map((a) => [a.user.id, a.role])));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setOptions(meeting.options), [meeting.options]);
  const set = <K extends keyof MeetingOptions>(k: K, v: MeetingOptions[K]) => setOptions((o) => ({ ...o, [k]: v }));

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const changedRoles = meeting.attendees
        .filter((a) => a.role !== 'organizer' && roles[a.user.id] !== a.role)
        .map((a) => ({ userId: a.user.id, role: roles[a.user.id] as Exclude<MeetingRole, 'organizer'> }));
      await api(`/meetings/${meeting.id}/options`, { method: 'PUT', json: { options, roles: changedRoles } satisfies UpdateMeetingOptionsInput });
      await qc.invalidateQueries({ queryKey: mk.meeting(meeting.id) });
      setStatus('Saved');
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <Link href={`/calendar?meeting=${meeting.id}`} className="mb-3 flex items-center gap-1 text-sm text-brand hover:underline"><ArrowLeft size={14} /> Back</Link>
        <h1 className="text-2xl font-semibold">Meeting options</h1>
        <p className="mb-5 text-sm text-muted">{meeting.title}</p>

        <Row label="Who can bypass the lobby?">
          <select value={options.lobbyBypass} onChange={(e) => set('lobbyBypass', e.target.value as MeetingOptions['lobbyBypass'])} className={inputClass}>
            <option value="everyone">Everyone in the organization</option>
            <option value="invited">People I invited (and channel members)</option>
            <option value="organizers">Only organizers and co-organizers</option>
          </select>
        </Row>
        <Check label="Announce when people wait in the lobby" checked={options.announceLobby} onChange={(v) => set('announceLobby', v)} />
        <Row label="Who can present?">
          <select value={options.whoCanPresent} onChange={(e) => set('whoCanPresent', e.target.value as MeetingOptions['whoCanPresent'])} className={inputClass}>
            <option value="everyone">Everyone</option>
            <option value="organizers">Only organizers and co-organizers</option>
            <option value="specific">Specific people (set roles below)</option>
          </select>
        </Row>
        <Check label="Allow mic for attendees" checked={options.allowAttendeeMic} onChange={(v) => set('allowAttendeeMic', v)} />
        <Check label="Allow camera for attendees" checked={options.allowAttendeeCamera} onChange={(v) => set('allowAttendeeCamera', v)} />
        <Check label="Allow meeting chat" checked={options.allowChat} onChange={(v) => set('allowChat', v)} />
        <Check label="Allow reactions" checked={options.allowReactions} onChange={(v) => set('allowReactions', v)} />

        <h2 className="mt-6 mb-2 font-semibold">Roles</h2>
        <ul className="mb-5 space-y-2">
          {meeting.attendees.map((a) => (
            <li key={a.user.id} className="flex items-center gap-3">
              <Avatar name={a.user.displayName} src={a.user.avatarUrl} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm">{a.user.displayName}</span>
              {a.role === 'organizer' ? (
                <span className="text-sm text-muted">{ROLE_LABEL.organizer}</span>
              ) : (
                <select aria-label={`Role for ${a.user.displayName}`} value={roles[a.user.id]} onChange={(e) => setRoles((r) => ({ ...r, [a.user.id]: e.target.value as MeetingRole }))} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
                  <option value="coorganizer">Co-organizer</option>
                  <option value="presenter">Presenter</option>
                  <option value="attendee">Attendee</option>
                </select>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button onClick={() => void save()} disabled={saving} className={primaryButton}>{saving ? 'Saving…' : 'Save'}</button>
          {status && <span role="status" className="text-sm text-muted">{status}</span>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
