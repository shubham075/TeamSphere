'use client';

import { ArrowDown, Loader2, Upload } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConversationInfo, MessageInfo } from '@teamsphere/shared';
import { ChatSearchPanel } from '@/components/chat/chat-search-panel';
import { Composer, ComposerHandle } from '@/components/chat/composer';
import { ConversationHeader } from '@/components/chat/conversation-header';
import { LocalMessage, MessageItem } from '@/components/chat/message-item';
import { pauseMarkRead, resumeMarkRead, scheduleMarkRead } from '@/components/realtime-provider';
import { useAuth } from '@/lib/auth-store';
import { conversationTitle, useConversation, useMessages, useSavedIds } from '@/lib/chat';
import { useChatUi } from '@/lib/chat-store';

const GROUP_GAP_MS = 5 * 60 * 1000;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const meId = useAuth((s) => s.user?.id);
  const { conversation, isLoading } = useConversation(id);

  if (!meId) return null;
  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        {isLoading ? <Loader2 className="animate-spin" /> : 'This chat is not available.'}
      </div>
    );
  }
  return <ConversationView key={id} conversation={conversation} meId={meId} />;
}

function ConversationView({ conversation, meId }: { conversation: ConversationInfo; meId: string }) {
  const id = conversation.id;
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useMessages(id);
  const typing = useChatUi((s) => s.typing[id]);
  const [replyTo, setReplyTo] = useState<MessageInfo | null>(null);
  const [editing, setEditing] = useState<MessageInfo | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const savedIds = useSavedIds();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const prevHeight = useRef<number | null>(null);

  const messages: LocalMessage[] = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.messages) : []), [data]);
  const lastId = messages[messages.length - 1]?.id;

  // Mark as active (suppresses notifications) and read while the chat is open and focused.
  useEffect(() => {
    useChatUi.getState().setActive(id);
    const markIfVisible = () => {
      if (document.visibilityState === 'visible') scheduleMarkRead(id);
    };
    markIfVisible();
    window.addEventListener('focus', markIfVisible);
    document.addEventListener('visibilitychange', markIfVisible);
    return () => {
      useChatUi.getState().setActive(null);
      resumeMarkRead(id);
      window.removeEventListener('focus', markIfVisible);
      document.removeEventListener('visibilitychange', markIfVisible);
    };
  }, [id]);

  useEffect(() => {
    if (conversation.unread > 0 && document.visibilityState === 'visible') scheduleMarkRead(id);
  }, [conversation.unread, id]);

  // Stick to the bottom when new messages arrive (if already there); keep position when older ones load.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastId, typing?.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (el.scrollTop < 200 && hasNextPage && !isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void fetchNextPage();
    }
  };

  const nameOf = useCallback(
    (userId: string) => conversation.members.find((m) => m.user.id === userId)?.user.displayName ?? 'Someone',
    [conversation.members],
  );

  const jumpTo = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlight(messageId);
      setTimeout(() => setHighlight(null), 1600);
    }
  }, []);

  /** Search results may be older than what's loaded: page back until the message is in the DOM (bounded). */
  const jumpToLoading = useCallback(
    async (messageId: string) => {
      for (let i = 0; i < 40 && !document.getElementById(`msg-${messageId}`); i++) {
        const res = await fetchNextPage();
        if (!res.hasNextPage) break;
      }
      requestAnimationFrame(() => jumpTo(messageId));
    },
    [fetchNextPage, jumpTo],
  );

  const onMarkedUnread = useCallback(() => pauseMarkRead(id), [id]);

  // "Seen" under my latest message, from other members' read positions.
  const seen = useMemo(() => {
    const lastMine = [...messages].reverse().find((m) => m.author?.id === meId && m.type === 'text' && !m.id.startsWith('temp-'));
    if (!lastMine) return null;
    const others = conversation.members.filter((m) => m.user.id !== meId);
    const readers = others.filter((m) => m.lastReadAt && m.lastReadAt >= lastMine.createdAt);
    if (!readers.length) return null;
    const label = conversation.type === 'direct' ? 'Seen' : readers.length === others.length ? 'Seen by everyone' : `Seen by ${readers.length}`;
    return { id: lastMine.id, label };
  }, [messages, conversation, meId]);

  const onReply = useCallback((m: MessageInfo) => {
    setEditing(null);
    setReplyTo(m);
  }, []);
  const onEdit = useCallback((m: MessageInfo) => {
    setReplyTo(null);
    setEditing(m);
  }, []);

  const typingNames = typing?.map((t) => t.displayName.split(' ')[0]) ?? [];

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-bg"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        composerRef.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      <ConversationHeader conversation={conversation} meId={meId} searching={searching} onToggleSearch={() => setSearching((s) => !s)} />

      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pt-4 pb-2" role="log" aria-live="polite">
        {isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Loader2 size={18} className="animate-spin text-muted" />
          </div>
        )}
        {!hasNextPage && !isLoading && (
          <p className="px-6 pb-4 text-center text-xs text-muted">
            {conversation.type === 'self'
              ? 'This is your personal space. Save notes, links and files here.'
              : `This is the beginning of your chat${conversation.type === 'group' ? ` "${conversationTitle(conversation, meId)}"` : ` with ${conversationTitle(conversation, meId)}`}.`}
          </p>
        )}
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-muted" />
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const showHeader =
            newDay ||
            !prev ||
            prev.type === 'system' ||
            prev.author?.id !== m.author?.id ||
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS ||
            m.importance !== 'normal';
          return (
            <Fragment key={m.clientId ?? m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3 px-6 text-xs font-semibold text-muted">
                  <span className="h-px flex-1 bg-border" />
                  {dayLabel(m.createdAt)}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <MessageItem
                message={m}
                meId={meId}
                showHeader={showHeader}
                seenLabel={seen?.id === m.id ? seen.label : null}
                highlighted={highlight === m.id}
                saved={savedIds.has(m.id)}
                onReply={onReply}
                onEdit={onEdit}
                onJumpTo={jumpTo}
                onMarkedUnread={onMarkedUnread}
                nameOf={nameOf}
              />
            </Fragment>
          );
        })}
      </div>

      <div className="h-5 px-6 text-xs text-muted" aria-live="polite">
        {typingNames.length > 0 &&
          `${typingNames.length > 2 ? `${typingNames.length} people are` : `${typingNames.join(' and ')} ${typingNames.length > 1 ? 'are' : 'is'}`} typing…`}
      </div>

      {!atBottom && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
          className="absolute right-6 bottom-36 flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold shadow-lg hover:bg-surface-hover"
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}

      <Composer
        ref={composerRef}
        conversation={conversation}
        meId={meId}
        replyTo={replyTo}
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onDoneEditing={() => setEditing(null)}
        placeholder={conversation.type === 'self' ? 'Write a note to yourself' : 'Type a message'}
      />
      </div>
      {searching && (
        <ChatSearchPanel conversationId={id} meId={meId} onClose={() => setSearching(false)} onPick={(mid) => void jumpToLoading(mid)} />
      )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-brand/10 ring-4 ring-brand ring-inset">
          <span className="flex items-center gap-2 rounded-lg bg-surface px-4 py-3 font-semibold shadow-xl">
            <Upload size={18} /> Drop files to attach
          </span>
        </div>
      )}
    </div>
  );
}
