'use client';

import clsx from 'clsx';
import { BellOff, Filter, Pin, SquarePen } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toPlainText, type ConversationInfo } from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { conversationTitle, formatListTime, useConversations } from '@/lib/chat';
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

  const list = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (!c.hidden || c.id === activeId) &&
        (!unreadOnly || c.unread > 0) &&
        (!term || conversationTitle(c, meId).toLowerCase().includes(term)),
    );
  }, [data, filter, unreadOnly, meId, activeId]);

  const pinned = list.filter((c) => c.pinned);
  const recent = list.filter((c) => !c.pinned);

  const row = (c: ConversationInfo) => {
    const active = c.id === activeId;
    const someoneTyping = typing[c.id]?.length;
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
              <span className={clsx('flex-1 truncate text-sm', c.unread ? 'font-bold' : 'font-medium')}>{conversationTitle(c, meId)}</span>
              <span className="shrink-0 text-[11px] text-muted">{formatListTime(c.lastMessageAt)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={clsx('flex-1 truncate text-xs', c.unread ? 'font-semibold text-text' : 'text-muted', someoneTyping && 'text-brand italic')}>
                {someoneTyping ? 'Typing…' : preview(c, meId)}
              </span>
              {c.muted && <BellOff size={12} className="shrink-0 text-muted" aria-label="Muted" />}
              {c.unread > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-text">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
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
        {pinned.length > 0 && (
          <>
            <p className="flex items-center gap-1 px-2 pt-1 pb-1 text-xs font-semibold text-muted">
              <Pin size={12} /> Pinned
            </p>
            <ul>{pinned.map(row)}</ul>
          </>
        )}
        {pinned.length > 0 && recent.length > 0 && <p className="px-2 pt-3 pb-1 text-xs font-semibold text-muted">Recent</p>}
        <ul>{recent.map(row)}</ul>
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
