'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EffectivePolicies, OrgInfo, SearchResults, SearchScope } from '@teamsphere/shared';
import { api } from './api';
import { useAuth } from './auth-store';

export interface SearchParams {
  q: string;
  scope?: SearchScope;
  from?: string;
  in?: string;
  after?: string;
  before?: string;
  hasAttachment?: boolean;
  limit?: number;
}

export function searchUrl(p: SearchParams) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v === true ? 1 : v === false ? 0 : v));
  return `/search?${qs}`;
}

/** Debounced by the caller; previous results stay visible while the next query loads. */
export function useSearch(p: SearchParams, enabled = true) {
  const has = !!(p.q.trim() || p.from || p.in || p.after || p.before || p.hasAttachment !== undefined);
  return useQuery({
    queryKey: ['search', p],
    queryFn: () => api<SearchResults>(searchUrl(p)),
    enabled: enabled && has,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** Org branding and limits (public endpoint, refreshed on org:updated). */
export function useOrg() {
  return useQuery({ queryKey: ['org'], queryFn: () => api<OrgInfo>('/org'), staleTime: 5 * 60_000 });
}

/** The signed-in user's effective policies, so the UI can hide what the server would refuse. */
export function useMyPolicies() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  return useQuery({ queryKey: ['my-policies'], queryFn: () => api<EffectivePolicies>('/org/my-policies'), enabled: signedIn, staleTime: 5 * 60_000 });
}

/** Splits a «highlighted» snippet into text and match parts for rendering with <mark>. */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  return snippet
    .split(/(«[^»]*»)/)
    .filter(Boolean)
    .map((part) => (part.startsWith('«') ? { text: part.slice(1, -1), hit: true } : { text: part, hit: false }));
}
