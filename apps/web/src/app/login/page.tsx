'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import type { AuthProvidersInfo, AuthResponse } from '@teamsphere/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Logo } from '@/components/logo';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const status = useAuth((s) => s.status);
  const setSession = useAuth((s) => s.setSession);

  const { data: providers } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api<AuthProvidersInfo>('/auth/providers'),
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [provider, setProvider] = useState<'local' | 'ldap'>('local');
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'signed-in') router.replace(params.get('next') ?? '/');
  }, [status, router, params]);

  // Default to the company directory when it's available.
  useEffect(() => {
    if (providers?.ldap.enabled) setProvider('ldap');
  }, [providers?.ldap.enabled]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        json: { username, password, provider },
      });
      setSession(res.accessToken, res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-br from-indigo-50 via-bg to-violet-100 p-4 dark:from-[#16162a] dark:via-bg dark:to-[#1d1630]">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-xl shadow-indigo-900/5">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo size={48} />
          <h1 className="text-2xl font-semibold">Sign in to TeamSphere</h1>
          <p className="text-sm text-muted">Chat, meet, call and collaborate</p>
        </div>

        {providers?.entra.enabled && (
          <>
            <a
              href="/api/auth/entra/login"
              className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-hover"
            >
              <MicrosoftSquares />
              {providers.entra.label}
            </a>
            <div className="my-5 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {providers?.ldap.enabled && (
            <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1 text-sm">
              {(['ldap', 'local'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => setProvider(p)}
                  className={`rounded px-2 py-1.5 ${provider === p ? 'bg-surface font-medium shadow-sm' : 'text-muted hover:text-text'}`}
                >
                  {p === 'ldap' ? providers.ldap.label : 'TeamSphere account'}
                </button>
              ))}
            </div>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Username</span>
            <input
              autoFocus
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={provider === 'ldap' ? 'DOMAIN\\username or username' : 'username'}
              className="rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-brand"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}

/** Generic four-square glyph for the Microsoft sign-in button (identity-provider button, per Microsoft's sign-in guidelines). */
function MicrosoftSquares() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
