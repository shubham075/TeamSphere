'use client';

import clsx from 'clsx';
import { BellOff, Bookmark, ChevronDown, Filter, FolderPlus, Pencil, Pin, SquarePen, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toPlainText, type ChatSectionInfo, type ConversationInfo } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { conversationTitle, formatListTime, useConversations, useSectionMutations, useSections } from '@/lib/chat';
import { useChatUi } from '@/lib/chat-store';
import { ConversationAvatar } from './conversation-avatar';
import { NewChatDialog } from './new-chat-dialog';

function preview(c: ConversationInfo, meId?: string) {
  const m = c.lastMessage;
  if (!m) return c.type === 'group' ? 'New group chat' : 'Start the conversation';
  if (m.deletedAt) return 'This message has been deleted.';
  const text = toPlainText(m.body) || (m.attachments.length ? `📎 ${m.attachments[0].fileName}` : '');
  if (m.type === 'system') return text;
  const who = m.author?.id === meId ? 'You' : c.type === 'group' ? m.author?.displayName.split(' ')[0] : null;
  return who ? `${who}: ${text}` : text;
}

export function ConversationList() {
  const { data, isLoading } = useConversations();
  const meId = useAuth((s) => s.user?.id);
  const { id: activeId } = useParams<{ id?: string }>();
  const typing = useChatUi((s) => s.typing);
  const [filter, setFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [composing, setComposing] = useState(false);
  const { data: sections } = useSections();
  const sectionOps = useSectionMutations();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const pathname = usePathname();

  const list = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (!c.hidden || c.id === activeId) &&
        (!unreadOnly || c.unread > 0 || c.markedUnread) &&
        (!term || conversationTitle(c, meId).toLowerCase().includes(term)),
    );
  }, [data, filter, unreadOnly, meId, activeId]);

  // Pinned wins over a custom section; chats in a deleted/unknown section fall back to Recent.
  const sectionIds = new Set(sections?.map((s) => s.id));
  const pinned = list.filter((c) => c.pinned);
  const inSection = (s: ChatSectionInfo) => list.filter((c) => !c.pinned && c.sectionId === s.id);
  const recent = list.filter((c) => !c.pinned && !(c.sectionId && sectionIds.has(c.sectionId)));

  const newSection = () => {
    const name = prompt('Name the new section')?.trim();
    if (name) sectionOps.create.mutate(name.slice(0, 64));
  };

  const group = (key: string, label: React.ReactNode, items: ConversationInfo[], section?: ChatSectionInfo) => (
    <div key={key}>
      <div className="group/section flex items-center gap-1 px-1 pt-3 pb-1">
        <button
          onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
          aria-expanded={!collapsed[key]}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-muted hover:text-text"
        >
          <ChevronDown size={12} className={clsx('shrink-0 transition-transform', collapsed[key] && '-rotate-90')} />
          <span className="flex min-w-0 items-center gap-1 truncate">{label}</span>
        </button>
        {section && (
          <span className="hidden gap-0.5 group-hover/section:flex group-focus-within/section:flex">
            <button
              onClick={() => {
                const name = prompt('Rename section', section.name)?.trim();
                if (name) sectionOps.rename.mutate({ id: section.id, name: name.slice(0, 64) });
              }}
              aria-label={`Rename ${section.name}`}
              className="rounded p-0.5 text-muted hover:text-text"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => confirm(`Delete the section "${section.name}"? Its chats move back to Recent.`) && sectionOps.remove.mutate(section.id)}
              aria-label={`Delete ${section.name}`}
              className="rounded p-0.5 text-muted hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </span>
        )}
      </div>
      {!collapsed[key] &&
        (items.length ? <ul>{items.map(row)}</ul> : section && <p className="px-6 py-1 text-xs text-muted">Move chats here from the chat's ⋯ menu.</p>)}
    </div>
  );

  const row = (c: ConversationInfo) => {
    const active = c.id === activeId;
    const someoneTyping = typing[c.id]?.length;
    const unreadish = c.unread > 0 || c.markedUnread;
    return (
      <li key={c.id}>
        <Link
          href={`/chat/${c.id}`}
          className={clsx(
            'flex items-center gap-3 rounded-md px-2 py-2',
            active ? 'bg-brand-soft' : 'hover:bg-surface-hover',
          )}
        >
          <ConversationAvatar conversation={c} meId={meId} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className={clsx('flex-1 truncate text-sm', unreadish ? 'font-bold' : 'font-medium')}>{conversationTitle(c, meId)}</span>
              <span className="shrink-0 text-[11px] text-muted">{formatListTime(c.lastMessageAt)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={clsx('flex-1 truncate text-xs', unreadish ? 'font-semibold text-text' : 'text-muted', someoneTyping && 'text-brand italic')}>
                {someoneTyping ? 'Typing…' : preview(c, meId)}
              </span>
              {c.muted && <BellOff size={12} className="shrink-0 text-muted" aria-label="Muted" />}
              {c.unread > 0 ? (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-text">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              ) : (
                c.markedUnread && <span className="h-2.5 w-2.5 rounded-full bg-brand" aria-label="Marked as unread" />
              )}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    // On phones the list and the open chat take turns filling the screen.
    <aside className={clsx('flex w-80 shrink-0 flex-col border-r border-border bg-surface', activeId ? 'max-md:hidden' : 'max-md:w-full')}>
      <div className="flex items-center gap-1 px-4 pt-3 pb-2">
        <h1 className="flex-1 text-xl font-semibold">Chat</h1>
        <button
          onClick={() => setUnreadOnly((u) => !u)}
          aria-pressed={unreadOnly}
          title="Show unread only"
          className={clsx('rounded p-2 hover:bg-surface-hover', unreadOnly && 'bg-brand-soft text-brand')}
        >
          <Filter size={18} />
        </button>
        <button onClick={newSection} title="New section" aria-label="New section" className="rounded p-2 hover:bg-surface-hover">
          <FolderPlus size={18} />
        </button>
        <button onClick={() => setComposing(true)} title="New chat" aria-label="New chat" className="rounded p-2 hover:bg-surface-hover">
          <SquarePen size={18} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name"
          aria-label="Filter chats"
          className="w-full rounded-md bg-surface-2 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <span className="h-9 w-9 rounded-full bg-surface-2" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-2/3 rounded bg-surface-2" />
                <span className="block h-2 w-1/2 rounded bg-surface-2" />
              </span>
            </div>
          ))}
        <Link
          href="/chat/saved"
          className={clsx('flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium', pathname === '/chat/saved' ? 'bg-brand-soft' : 'hover:bg-surface-hover')}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-brand">
            <Bookmark size={16} />
          </span>
          Saved messages
        </Link>
        {pinned.length > 0 &&
          group(
            'pinned',
            <>
              <Pin size={12} /> Pinned
            </>,
            pinned,
          )}
        {sections?.map((s) => group(s.id, s.name, inSection(s), s))}
        {(pinned.length > 0 || !!sections?.length) ? group('recent', 'Recent', recent) : <ul>{recent.map(row)}</ul>}
        {!isLoading && list.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted">
            {filter || unreadOnly ? 'No chats match.' : 'No chats yet.'}
            {!filter && !unreadOnly && (
              <button onClick={() => setComposing(true)} className="mt-3 block w-full rounded-md bg-brand px-3 py-2 font-semibold text-brand-text hover:bg-brand-hover">
                Start a new chat
              </button>
            )}
          </div>
        )}
      </div>
      {composing && <NewChatDialog onClose={() => setComposing(false)} />}
    </aside>
  );
}
