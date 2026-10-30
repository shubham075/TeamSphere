'use client';

import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { GuestJoinResult } from '@teamsphere/shared';
import { Logo } from '@/components/logo';
import { MeetingJoin } from '@/components/meetings/meeting-join';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

/** Kept per tab so a reload doesn't create a second guest (the token is scoped to one meeting and expires). */
const STORE_KEY = 'teamsphere-guest';

/**
 * Anonymous join from a meeting link: name only → guest session for this one meeting → lobby.
 * People with an account can sign in instead and use the normal meeting page.
 */
export default function GuestJoinPage() {
  const { code } = useParams<{ code: string }>();
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null') as (GuestJoinResult & { code: string }) | null;
      if (saved?.code === code) {
        useAuth.getState().setSession(saved.accessToken, saved.user);
        setMeetingId(saved.meetingId);
        return;
      }
    } catch { /* storage unavailable: ask for a name */ }
    useAuth.getState().clear();
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<GuestJoinResult>('/meetings/guest-join', { method: 'POST', json: { code, name } });
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...r, code }));
      } catch { /* fine without it */ }
      useAuth.getState().setSession(r.accessToken, r.user);
      setMeetingId(r.meetingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  }

  if (meetingId) {
    return (
      <div className="flex h-full flex-col">
        <MeetingJoin id={meetingId} guest />
      </div>
    );
  }
  return (
    <main className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Logo size={32} />
          <h1 className="text-lg font-semibold">Join the meeting</h1>
        </div>
        <p className="text-sm text-muted">Enter your name. Someone in the meeting will let you in.</p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoFocus
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || !name.trim()} className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50">
          {busy && <Loader2 size={16} className="animate-spin" />} Join as a guest
        </button>
        <a href="/login" className="block text-center text-sm text-brand hover:underline">Have an account? Sign in</a>
      </form>
    </main>
  );
}
