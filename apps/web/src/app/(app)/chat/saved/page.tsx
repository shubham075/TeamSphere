'use client';

import { ArrowLeft, Bookmark, BookmarkX, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { toPlainText } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/lib/auth-store';
import { conversationTitle, useConversations, useSaved, useSetSaved } from '@/lib/chat';

export default function SavedPage() {
  const meId = useAuth((s) => s.user?.id);
  const { data, isLoading } = useSaved();
  const { data: conversations } = useConversations();
  const unsave = useSetSaved();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 md:px-5">
        <Link href="/chat" aria-label="Back to chats" className="rounded p-1 hover:bg-surface-hover md:hidden">
          <ArrowLeft size={18} />
        </Link>
        <Bookmark size={20} className="text-brand" aria-hidden />
        <h2 className="text-base font-semibold">Saved messages</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:px-6">
        {isLoading && <Loader2 className="mx-auto mt-10 animate-spin text-muted" />}
        {data && !data.length && (
          <p className="mt-16 text-center text-sm text-muted">
            Nothing saved yet. Use <span className="font-semibold">⋯ → Save this message</span> on any message to keep it here.
          </p>
        )}
        <ul className="mx-auto max-w-3xl space-y-2">
          {data?.map(({ message: m, savedAt }) => {
            const conversation = conversations?.find((c) => c.id === m.conversationId);
            const where = conversation ? conversationTitle(conversation, meId) : 'Chat';
            const text = toPlainText(m.body) || (m.poll ? `Poll: ${m.poll.question}` : m.attachments.map((a) => a.fileName).join(', '));
            return (
              <li key={m.id} className="group flex gap-3 rounded-lg border border-border bg-surface p-3">
                {m.author && <Avatar name={m.author.displayName} src={m.author.avatarUrl} size={32} />}
                <Link href={`/chat/${m.conversationId}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                    <span className="font-semibold text-text">{m.author?.id === meId ? 'You' : (m.author?.displayName ?? 'Unknown')}</span>
                    <span>in {where}</span>
                    <span>· {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  <span className="mt-1 line-clamp-4 block text-sm whitespace-pre-wrap">{text}</span>
                  <span className="sr-only">Saved {new Date(savedAt).toLocaleString()}</span>
                </Link>
                <button
                  onClick={() => unsave.mutate({ message: m, saved: false })}
                  title="Unsave"
                  aria-label="Unsave message"
                  className="self-start rounded p-1.5 text-muted hover:bg-surface-hover hover:text-danger"
                >
                  <BookmarkX size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
