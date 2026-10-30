'use client';

import clsx from 'clsx';
import { CalendarDays, FileText, Hash, Paperclip, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { PublicUser, SearchScope } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { messageHref, Snippet } from '@/components/shell/search-box';
import { useConversations, useCreateConversation } from '@/lib/chat';
import { formatDateTime, useT } from '@/lib/i18n';
import { SearchParams, useSearch } from '@/lib/search';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const TABS: { id: SearchScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'people', label: 'People' },
  { id: 'files', label: 'Files' },
  { id: 'teams', label: 'Teams' },
  { id: 'channels', label: 'Channels' },
  { id: 'meetings', label: 'Meetings' },
];

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResultsPage />
    </Suspense>
  );
}

/** Day string (yyyy-mm-dd from a date input) → ISO at local midnight. */
const dayIso = (d: string, endOfDay = false) => (d ? new Date(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString() : undefined);

function SearchResultsPage() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const scope = (get('scope') || 'all') as SearchScope;
  const filters: SearchParams = {
    q: get('q'),
    scope,
    from: get('from') || undefined,
    in: get('in') || undefined,
    after: dayIso(get('after')),
    before: dayIso(get('before'), true),
    hasAttachment: get('att') === '1' ? true : undefined,
    limit: 50,
  };
  const { data, isFetching } = useSearch(filters);
  const { data: conversations } = useConversations();
  const messageFilters = !!(filters.from || filters.in || filters.after || filters.before || filters.hasAttachment);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    router.replace(`/search?${next}`);
  };

  const show = (s: SearchScope) => scope === 'all' || scope === s;
  const empty = data && Object.values(data).every((list) => list.length === 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="border-b border-border bg-surface px-6 pt-4">
        <h1 className="text-xl font-semibold">
          Results{filters.q ? <> for “{filters.q}”</> : null}
        </h1>
        <nav role="tablist" aria-label="Result types" className="mt-3 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={scope === tab.id}
              onClick={() => update({ scope: tab.id === 'all' ? undefined : tab.id })}
              className={clsx('border-b-2 px-3 pb-2 text-sm', scope === tab.id ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted hover:text-text')}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        {(scope === 'all' || scope === 'messages') && (
          <aside aria-label="Filters" className="w-64 shrink-0 space-y-4 overflow-y-auto border-r border-border bg-surface p-4 text-sm">
            <h2 className="font-semibold">Message filters</h2>
            <PersonFilter value={get('from')} onChange={(id) => update({ from: id })} />
            <label className="block">
              <span className="mb-1 block text-muted">In</span>
              <select value={get('in')} onChange={(e) => update({ in: e.target.value || undefined })} className="w-full rounded border border-border bg-surface px-2 py-1.5">
                <option value="">Any chat or channel</option>
                {conversations?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ?? c.members.map((m) => m.user.displayName).join(', ')}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-muted">From date</span>
                <input type="date" value={get('after')} onChange={(e) => update({ after: e.target.value || undefined })} className="w-full rounded border border-border bg-surface px-1.5 py-1" />
              </label>
              <label className="block">
                <span className="mb-1 block text-muted">To date</span>
                <input type="date" value={get('before')} onChange={(e) => update({ before: e.target.value || undefined })} className="w-full rounded border border-border bg-surface px-1.5 py-1" />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={get('att') === '1'} onChange={(e) => update({ att: e.target.checked ? '1' : undefined })} />
              Has attachment
            </label>
            {messageFilters && (
              <button onClick={() => update({ from: undefined, in: undefined, after: undefined, before: undefined, att: undefined })} className="text-brand hover:underline">
                Clear filters
              </button>
            )}
          </aside>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto p-6" aria-busy={isFetching}>
          <div className="mx-auto max-w-3xl space-y-8">
            {!filters.q && !messageFilters && <p className="text-muted">Type in the search box at the top, then press Enter.</p>}
            {empty && <p className="text-muted">{t('search.noResults', { q: filters.q })}</p>}

            {show('people') && !!data?.people.length && (
              <Section title={t('search.people')}>
                {data.people.map((u) => (
                  <PersonRow key={u.id} user={u} />
                ))}
              </Section>
            )}

            {show('messages') && !!data?.messages.length && (
              <Section title={t('search.messages')}>
                {data.messages.map((m) => (
                  <Link key={m.id} href={messageHref(m)} className="block rounded-md border border-border bg-surface p-3 hover:bg-surface-hover">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="font-semibold text-text">{m.author?.displayName ?? 'Unknown'}</span>
                      <span>in {m.location}</span>
                      {m.hasAttachment && <Paperclip size={12} aria-label="Has attachment" />}
                      <span className="ml-auto">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">
                      <Snippet text={m.snippet} />
                    </p>
                  </Link>
                ))}
              </Section>
            )}

            {show('files') && !!data?.files.length && (
              <Section title={t('search.files')}>
                {data.files.map((f) => (
                  <Row key={f.id} href={`/files/item/${f.id}`} icon={<FileText size={20} />} title={f.name} sub={`${f.location} · modified ${formatDateTime(f.modifiedAt, { dateStyle: 'medium' })}`} />
                ))}
              </Section>
            )}

            {show('teams') && !!data?.teams.length && (
              <Section title={t('search.teams')}>
                {data.teams.map((tm) => (
                  <Row key={tm.id} href={tm.isMember ? `/teams/t/${tm.id}` : '/teams/discover'} icon={<Users size={20} />} title={tm.name} sub={tm.isMember ? (tm.description ?? 'Member') : 'Public team · join from Discover'} />
                ))}
              </Section>
            )}

            {show('channels') && !!data?.channels.length && (
              <Section title={t('search.channels')}>
                {data.channels.map((c) => (
                  <Row key={c.id} href={`/teams/c/${c.id}`} icon={<Hash size={20} />} title={c.name} sub={`${c.teamName}${c.type !== 'standard' ? ` · ${c.type}` : ''}`} />
                ))}
              </Section>
            )}

            {show('meetings') && !!data?.meetings.length && (
              <Section title={t('search.meetings')}>
                {data.meetings.map((m) => (
                  <Row key={m.id} href={`/meetings/${m.id}`} icon={<CalendarDays size={20} />} title={m.title} sub={formatDateTime(m.startAt)} />
                ))}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted uppercase">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3 hover:bg-surface-hover">
      <span className="flex w-8 justify-center text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
    </Link>
  );
}

/** Opens (or starts) the 1:1 chat with the person. */
function PersonRow({ user: u }: { user: PublicUser }) {
  const router = useRouter();
  const createChat = useCreateConversation();
  return (
    <button
      onClick={async () => router.push(`/chat/${(await createChat.mutateAsync({ type: 'direct', userId: u.id })).id}`)}
      className="flex w-full items-center gap-3 rounded-md border border-border bg-surface p-3 text-left hover:bg-surface-hover"
    >
      <Avatar name={u.displayName} src={u.avatarUrl} size={32} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{u.displayName}</span>
        <span className="block truncate text-xs text-muted">{[u.jobTitle, u.department, u.email].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
}

/** "From" filter: type a name, pick a person. */
function PersonFilter({ value, onChange }: { value: string; onChange: (id: string | undefined) => void }) {
  const [term, setTerm] = useState('');
  const { data: people } = useQuery({
    queryKey: ['users', term],
    queryFn: () => api<PublicUser[]>(`/users?q=${encodeURIComponent(term)}&take=8`),
    enabled: term.length >= 2,
  });
  const { data: selected } = useQuery({ queryKey: ['user', value], queryFn: () => api<PublicUser>(`/users/${value}`), enabled: !!value });
  return (
    <div>
      <span className="mb-1 block text-muted">From</span>
      {value && selected ? (
        <div className="flex items-center gap-2 rounded border border-border px-2 py-1">
          <Avatar name={selected.displayName} src={selected.avatarUrl} size={20} />
          <span className="flex-1 truncate">{selected.displayName}</span>
          <button onClick={() => onChange(undefined)} aria-label="Clear person filter" className="text-muted hover:text-text">×</button>
        </div>
      ) : (
        <>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type a name" aria-label="From person" className="w-full rounded border border-border bg-surface px-2 py-1.5" />
          {term.length >= 2 && (
            <ul className="mt-1 rounded border border-border">
              {people?.map((p) => (
                <li key={p.id}>
                  <button onClick={() => { onChange(p.id); setTerm(''); }} className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-surface-hover">
                    <Avatar name={p.displayName} src={p.avatarUrl} size={20} />
                    {p.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
