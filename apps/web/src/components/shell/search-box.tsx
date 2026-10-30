'use client';

import clsx from 'clsx';
import { CalendarDays, FileText, Hash, MessageSquare, Search, Slash, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { forwardRef, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MessageHit, PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { useCallStore } from '@/lib/call-store';
import { parseCommand, STATUS_COMMANDS } from '@/lib/commands';
import { useCreateConversation } from '@/lib/chat';
import { useT } from '@/lib/i18n';
import { useMe, useSetPresence } from '@/lib/presence';
import { snippetParts, useSearch } from '@/lib/search';
import { useDismiss } from '@/lib/use-dismiss';

interface Item {
  key: string;
  section: string;
  icon: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  run: () => void | Promise<void>;
  /** Keep the box open (e.g. picking a command that still needs an argument). */
  keepOpen?: boolean;
}

export const SHOW_SHORTCUTS_EVENT = 'ts:shortcuts';

export function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export function messageHref(m: MessageHit) {
  return m.channelId ? `/teams/c/${m.channelId}` : `/chat/${m.conversationId}`;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Title-bar search & command box (Ctrl+E / Ctrl+K). Plain text shows typeahead results (Enter opens the results
 * page); text starting with "/" runs commands such as /busy, /call, /chat and /goto.
 */
export const SearchBox = forwardRef<HTMLInputElement>(function SearchBox(_, ref) {
  const t = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const setPresence = useSetPresence();
  const createChat = useCreateConversation();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDismiss(boxRef, open, () => setOpen(false));

  const parsed = parseCommand(value, { isAdmin: me?.role === 'admin' });
  const debounced = useDebounced(value, 180);
  const dParsed = parseCommand(debounced, { isAdmin: me?.role === 'admin' });
  const searchQ = dParsed.kind === 'search' ? dParsed.q : dParsed.kind === 'command' ? dParsed.arg : '';
  const scope =
    dParsed.kind === 'command' ? (dParsed.command.name === 'goto' ? 'all' : dParsed.command.arg ? 'people' : null) : dParsed.kind === 'search' ? 'all' : null;
  const { data: results } = useSearch({ q: searchQ, scope: scope ?? 'all', limit: 4 }, open && !!scope && searchQ.length >= 2);

  const close = () => {
    setOpen(false);
    setValue('');
    setError(null);
    (ref as React.RefObject<HTMLInputElement | null>)?.current?.blur();
  };
  const go = (href: string) => {
    router.push(href);
    close();
  };
  const openChatWith = async (user: PublicUser) => {
    const c = await createChat.mutateAsync({ type: 'direct', userId: user.id });
    go(`/chat/${c.id}`);
  };

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    if (parsed.kind === 'partial') {
      for (const c of parsed.matches) {
        list.push({
          key: `cmd-${c.name}`,
          section: t('search.commands'),
          icon: <Slash size={16} />,
          label: (
            <span>
              /{c.name} {c.arg && <span className="text-muted">[{c.arg}]</span>}
            </span>
          ),
          hint: c.description,
          keepOpen: !!c.arg,
          run: () => (c.arg ? setValue(`/${c.name} `) : setValue(`/${c.name}`)),
        });
      }
      return list;
    }
    if (parsed.kind === 'command') {
      const { command, arg } = parsed;
      const status = STATUS_COMMANDS[command.name];
      const simple: Record<string, () => void> = {
        files: () => go('/files'),
        saved: () => go('/chat/saved'),
        activity: () => go('/activity'),
        settings: () => go('/settings'),
        admin: () => go('/admin'),
        keys: () => {
          window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT));
          close();
        },
      };
      if (status) {
        list.push({
          key: 'status',
          section: t('search.commands'),
          icon: <Slash size={16} />,
          label: command.description,
          run: async () => {
            await setPresence.mutateAsync({ status });
            close();
          },
        });
      } else if (simple[command.name]) {
        list.push({ key: command.name, section: t('search.commands'), icon: <Slash size={16} />, label: command.description, run: simple[command.name] });
      } else if (command.name === 'call' || command.name === 'chat') {
        for (const u of results?.people ?? []) {
          if (u.id === me?.id) continue;
          list.push({
            key: `p-${u.id}`,
            section: command.name === 'call' ? 'Call' : 'Chat with',
            icon: <Avatar name={u.displayName} src={u.avatarUrl} size={24} />,
            label: u.displayName,
            hint: u.jobTitle ?? u.email ?? undefined,
            run:
              command.name === 'call'
                ? async () => {
                    close();
                    await useCallStore.getState().start({ userId: u.id, kind: 'audio' });
                  }
                : () => openChatWith(u),
          });
        }
      } else if (command.name === 'goto') {
        for (const team of results?.teams ?? []) {
          list.push({ key: `t-${team.id}`, section: t('search.teams'), icon: <Users size={16} />, label: team.name, run: () => go(team.isMember ? `/teams/t/${team.id}` : '/teams/discover') });
        }
        for (const ch of results?.channels ?? []) {
          list.push({ key: `c-${ch.id}`, section: t('search.channels'), icon: <Hash size={16} />, label: ch.name, hint: ch.teamName, run: () => go(`/teams/c/${ch.id}`) });
        }
      }
      if (!list.length && arg) list.push({ key: 'none', section: '', icon: null, label: <span className="text-muted">{t('search.noResults', { q: arg })}</span>, run: () => {} });
      return list;
    }
    // Plain search: typeahead.
    if (!parsed.q) {
      list.push({ key: 'hint', section: '', icon: <Slash size={16} />, label: <span className="text-muted">Type / to see commands</span>, keepOpen: true, run: () => setValue('/') });
      return list;
    }
    for (const u of results?.people ?? []) {
      list.push({
        key: `p-${u.id}`,
        section: t('search.people'),
        icon: <Avatar name={u.displayName} src={u.avatarUrl} size={24} />,
        label: u.displayName,
        hint: u.jobTitle ?? undefined,
        run: () => (u.id === me?.id ? go('/settings') : openChatWith(u)),
      });
    }
    for (const m of results?.messages ?? []) {
      list.push({
        key: `m-${m.id}`,
        section: t('search.messages'),
        icon: <MessageSquare size={16} />,
        label: (
          <span className="line-clamp-1">
            <Snippet text={m.snippet} />
          </span>
        ),
        hint: `${m.author?.displayName ?? ''} · ${m.location}`,
        run: () => go(messageHref(m)),
      });
    }
    for (const f of results?.files ?? []) {
      list.push({ key: `f-${f.id}`, section: t('search.files'), icon: <FileText size={16} />, label: f.name, hint: f.location, run: () => go(`/files/item/${f.id}`) });
    }
    for (const team of results?.teams ?? []) {
      list.push({ key: `t-${team.id}`, section: t('search.teams'), icon: <Users size={16} />, label: team.name, run: () => go(team.isMember ? `/teams/t/${team.id}` : '/teams/discover') });
    }
    for (const ch of results?.channels ?? []) {
      list.push({ key: `c-${ch.id}`, section: t('search.channels'), icon: <Hash size={16} />, label: ch.name, hint: ch.teamName, run: () => go(`/teams/c/${ch.id}`) });
    }
    for (const mt of results?.meetings ?? []) {
      list.push({ key: `mt-${mt.id}`, section: t('search.meetings'), icon: <CalendarDays size={16} />, label: mt.title, run: () => go(`/meetings/${mt.id}`) });
    }
    list.push({ key: 'all', section: '', icon: <Search size={16} />, label: t('search.seeAll', { q: parsed.q }), run: () => go(`/search?q=${encodeURIComponent(parsed.q)}`) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, results, me?.id]);

  useEffect(() => setActive(0), [value]);

  const run = async (item: Item | undefined) => {
    if (!item) return;
    setError(null);
    try {
      await item.run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter on plain text with nothing highlighted goes to the full results page.
      if (parsed.kind === 'search' && active === 0 && parsed.q) void run(items.find((i) => i.key === 'all'));
      else void run(items[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  let lastSection = '';
  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-xl">
      <div className="flex items-center gap-2 rounded-md bg-white/15 px-3 py-1.5 focus-within:bg-white focus-within:text-[#1f1f2b]">
        <Search size={16} className="shrink-0 opacity-80" />
        <input
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('search.placeholder')}
          aria-label="Search and commands"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          className="w-full bg-transparent text-sm outline-none placeholder:text-current placeholder:opacity-75"
        />
      </div>
      {open && (items.length > 0 || error) && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface py-1 text-text shadow-xl">
          {error && <p role="alert" className="px-3 py-2 text-sm text-danger">{error}</p>}
          <ul id={listId} role="listbox" aria-label="Suggestions">
            {items.map((item, i) => {
              const header = item.section && item.section !== lastSection ? item.section : null;
              lastSection = item.section || lastSection;
              return (
                <li key={item.key} role="presentation">
                  {header && <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted uppercase">{header}</p>}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void run(item)}
                    className={clsx('flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm', i === active && 'bg-surface-hover')}
                  >
                    <span className="flex w-6 shrink-0 justify-center text-muted">{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.hint && <span className="block truncate text-xs text-muted">{item.hint}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
});

