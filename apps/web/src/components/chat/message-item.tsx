'use client';

import clsx from 'clsx';
import { AlertCircle, Copy, CornerUpLeft, FileText, Loader2, MoreHorizontal, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { MessageInfo, QUICK_REACTIONS, toPlainText } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { formatBytes, useDeleteMessage, useToggleReaction } from '@/lib/chat';
import { useDismiss } from '@/lib/use-dismiss';
import { EmojiGrid } from './emoji-grid';
import { RichText } from './rich-text';

export type LocalMessage = MessageInfo & { pending?: boolean; failed?: boolean };

interface Props {
  message: LocalMessage;
  meId: string;
  /** First message in a run from the same author: shows avatar, name and time. */
  showHeader: boolean;
  seenLabel?: string | null;
  highlighted?: boolean;
  onReply: (m: MessageInfo) => void;
  onEdit: (m: MessageInfo) => void;
  onJumpTo: (id: string) => void;
  nameOf: (userId: string) => string;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function MessageItemImpl({ message: m, meId, showHeader, seenLabel, highlighted, onReply, onEdit, onJumpTo, nameOf }: Props) {
  const mine = m.author?.id === meId;
  const react = useToggleReaction();
  const del = useDeleteMessage();
  const [menu, setMenu] = useState<'none' | 'more' | 'emoji'>('none');
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menu !== 'none', () => setMenu('none'));

  if (m.type === 'system') {
    return (
      <div id={`msg-${m.id}`} className="my-3 flex items-center gap-3 px-6 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        <span className="text-center">{m.body}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const toggle = (emoji: string) => {
    const existing = m.reactions.find((r) => r.emoji === emoji);
    react.mutate({ message: m, emoji, add: !existing?.userIds.includes(meId) });
    setMenu('none');
  };
  const deleted = !!m.deletedAt;
  const canAct = !deleted && !m.pending && !m.failed;

  return (
    <div
      id={`msg-${m.id}`}
      className={clsx(
        'group relative flex gap-2 px-4 md:px-6',
        mine ? 'flex-row-reverse' : 'flex-row',
        showHeader ? 'mt-3' : 'mt-0.5',
        highlighted && 'animate-pulse',
      )}
    >
      {!mine && (
        <div className="w-8 shrink-0">
          {showHeader && m.author && <Avatar name={m.author.displayName} src={m.author.avatarUrl} size={32} />}
        </div>
      )}

      <div className={clsx('flex max-w-[min(680px,80%)] min-w-0 flex-col', mine ? 'items-end' : 'items-start')}>
        {showHeader && (
          <div className={clsx('mb-0.5 flex items-baseline gap-2 text-xs text-muted', mine && 'flex-row-reverse')}>
            {!mine && <span className="font-semibold text-text">{m.author?.displayName ?? 'Unknown'}</span>}
            <span>{time(m.createdAt)}</span>
          </div>
        )}

        <div
          className={clsx(
            'relative rounded-lg px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
            mine ? 'bg-brand-soft' : 'bg-surface',
            !mine && 'border border-border',
            m.importance === 'urgent' && 'border-l-4 !border-l-danger',
            m.importance === 'important' && 'border-l-4 !border-l-amber-500',
            deleted && 'italic text-muted',
            m.pending && 'opacity-70',
          )}
        >
          {m.importance !== 'normal' && !deleted && (
            <p className={clsx('mb-1 text-[11px] font-bold tracking-wide uppercase', m.importance === 'urgent' ? 'text-danger' : 'text-amber-600')}>
              {m.importance === 'urgent' ? 'Urgent!' : 'Important!'}
            </p>
          )}

          {m.parent && (
            <button
              onClick={() => onJumpTo(m.parent!.id)}
              className="mb-1.5 block w-full rounded border-l-4 border-brand bg-surface-2 px-2 py-1 text-left text-xs"
            >
              <span className="block font-semibold">{m.parent.authorName}</span>
              <span className="line-clamp-2 text-muted">{m.parent.preview}</span>
            </button>
          )}

          {deleted ? 'This message has been deleted.' : m.body && <RichText body={m.body} meId={meId} />}

          {m.attachments.length > 0 && (
            <div className={clsx('flex flex-col gap-1.5', m.body && 'mt-2')}>
              {m.attachments.map((a) =>
                a.mimeType.startsWith('image/') ? (
                  <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.fileName} className="max-h-72 max-w-full rounded-md border border-border object-contain" />
                  </a>
                ) : a.mimeType.startsWith('video/') ? (
                  <video key={a.id} src={a.url} controls className="max-h-72 max-w-full rounded-md" />
                ) : (
                  <a
                    key={a.id}
                    href={`${a.url}&download=1`}
                    className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 not-italic hover:bg-surface-hover"
                  >
                    <FileText size={22} className="shrink-0 text-brand" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.fileName}</span>
                      <span className="block text-xs text-muted">{formatBytes(a.size)}</span>
                    </span>
                  </a>
                ),
              )}
            </div>
          )}

          {m.editedAt && !deleted && <span className="ml-2 text-[11px] text-muted">Edited</span>}
        </div>

        {m.reactions.length > 0 && (
          <div className={clsx('mt-1 flex flex-wrap gap-1', mine && 'justify-end')}>
            {m.reactions.map((r) => {
              const reacted = r.userIds.includes(meId);
              return (
                <button
                  key={r.emoji}
                  onClick={() => toggle(r.emoji)}
                  title={r.userIds.map(nameOf).join(', ')}
                  className={clsx(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                    reacted ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-hover',
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="font-semibold">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {m.failed && (
          <p className="mt-1 flex items-center gap-1 text-xs text-danger">
            <AlertCircle size={12} /> Not sent. Check your connection and try again.
          </p>
        )}
        {m.pending && <Loader2 size={12} className="mt-1 animate-spin text-muted" aria-label="Sending" />}
        {seenLabel && <p className="mt-0.5 text-[11px] text-muted">{seenLabel}</p>}
      </div>

      {canAct && (
        <div
          ref={menuRef}
          className={clsx(
            'absolute -top-4 z-10 items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-md',
            mine ? 'right-6' : 'left-14',
            menu === 'none' ? 'hidden group-hover:flex group-focus-within:flex' : 'flex',
          )}
        >
          {QUICK_REACTIONS.map((e) => (
            <button key={e} onClick={() => toggle(e)} aria-label={`React ${e}`} className="rounded px-1 py-0.5 text-base hover:bg-surface-hover">
              {e}
            </button>
          ))}
          <button onClick={() => setMenu(menu === 'emoji' ? 'none' : 'emoji')} aria-label="More reactions" className="rounded p-1.5 hover:bg-surface-hover">
            <SmilePlus size={15} />
          </button>
          <button onClick={() => onReply(m)} aria-label="Reply" className="rounded p-1.5 hover:bg-surface-hover">
            <CornerUpLeft size={15} />
          </button>
          <button onClick={() => setMenu(menu === 'more' ? 'none' : 'more')} aria-label="More options" className="rounded p-1.5 hover:bg-surface-hover">
            <MoreHorizontal size={15} />
          </button>

          {menu === 'emoji' && (
            <div className={clsx('absolute top-9 z-20', mine ? 'right-0' : 'left-0')}>
              <EmojiGrid onPick={toggle} />
            </div>
          )}
          {menu === 'more' && (
            <div className={clsx('absolute top-9 z-20 w-44 rounded-md border border-border bg-surface py-1 text-sm shadow-lg', mine ? 'right-0' : 'left-0')}>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(toPlainText(m.body));
                  setMenu('none');
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-surface-hover"
              >
                <Copy size={14} /> Copy text
              </button>
              {mine && (
                <>
                  <button
                    onClick={() => {
                      onEdit(m);
                      setMenu('none');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-surface-hover"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this message?')) del.mutate(m.id);
                      setMenu('none');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-danger hover:bg-surface-hover"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
