import type { AuthResponse } from '@teamsphere/shared';
import { useAuth } from './auth-store';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<AuthResponse | null> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one request.
 * Resolves null when the server rejects the session (signed out). Rejects when the server can't be
 * reached or errors (e.g. restarting), so callers can retry instead of signing the user out.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-teamsphere': '1' },
  })
    .then(async (r) => {
      if (r.status >= 500) throw new ApiError(r.status, 'Server unavailable');
      if (!r.ok) return null;
      const data = (await r.json()) as AuthResponse;
      useAuth.getState().setSession(data.accessToken, data.user);
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** JSON fetch against the API with bearer auth and one automatic refresh-and-retry on 401. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const send = (token: string | null) =>
    fetch(`/api${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-teamsphere': '1',
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await send(useAuth.getState().accessToken);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession().catch(() => {
      throw new ApiError(503, 'Cannot reach the server. Retrying…');
    });
    if (!refreshed) {
      useAuth.getState().clear();
      throw new ApiError(401, 'Your session has ended. Please sign in again.');
    }
    res = await send(refreshed.accessToken);
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (body as { message?: string | string[] })?.message;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : (message ?? res.statusText), body);
  }
  return body as T;
}
