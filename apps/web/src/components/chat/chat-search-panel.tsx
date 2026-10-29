'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toPlainText } from '@teamsphere/shared';
import { searchMessages } from '@/lib/chat';

/** Highlights each occurrence of `term` in `text` (case-insensitive). */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-brand-soft text-text">{p}</mark> : p))}</>;
}

export function ChatSearchPanel({ conversationId, meId, onClose, onPick }: { conversationId: string; meId: string; onClose: () => void; onPick: (messageId: string) => void }) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching } = useQuery({
    queryKey: ['chat-search', conversationId, term],
    queryFn: () => searchMessages(conversationId, term),
    enabled: term.length >= 2,
  });

  return (
    <aside aria-label="Search this chat" className="flex w-80 shrink-0 flex-col border-l border-border bg-surface max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-full">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search size={16} className="text-muted" aria-hidden />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Search in this chat"
          aria-label="Search in this chat"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
        />
        {isFetching && <Loader2 size={14} className="animate-spin text-muted" />}
        <button onClick={onClose} aria-label="Close search" className="rounded p-1 hover:bg-surface-hover">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {term.length < 2 ? (
          <p className="p-4 text-center text-xs text-muted">Type at least 2 characters.</p>
        ) : data && !data.length ? (
          <p className="p-4 text-center text-xs text-muted">No messages match "{term}".</p>
        ) : (
          <ul>
            {data?.map((m) => (
              <li key={m.id}>
                <button onClick={() => onPick(m.id)} className="block w-full border-b border-border px-4 py-2.5 text-left hover:bg-surface-hover">
                  <span className="flex items-baseline gap-2 text-xs">
                    <span className="flex-1 truncate font-semibold">{m.author?.id === meId ? 'You' : (m.author?.displayName ?? 'Unknown')}</span>
                    <span className="shrink-0 text-muted">{new Date(m.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-3 block text-sm">
                    <Highlight
                      text={toPlainText(m.body) || m.poll?.question || m.attachments.map((a) => a.fileName).join(', ')}
                      term={term}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
