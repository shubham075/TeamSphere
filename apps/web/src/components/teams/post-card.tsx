'use client';

import clsx from 'clsx';
import { CornerDownRight, FileText, Megaphone, MoreHorizontal, Pencil, Share2, SmilePlus, Trash2 } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { ChannelInfo, ChannelPost, MessageInfo, QUICK_REACTIONS, TeamInfo } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { EmojiGrid } from '@/components/chat/emoji-grid';
import { RichText } from '@/components/chat/rich-text';
import { formatBytes, useEditMessage, useToggleReaction } from '@/lib/chat';
import { useModeratorDelete } from '@/lib/teams';
import { useDismiss } from '@/lib/use-dismiss';
import { ChannelComposer, decodeMentions, encodeMentions } from './channel-composer';

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** One message in a channel (a post or a reply): Teams-style left-aligned layout, rendered with the chat RichText. */
function ChannelMessage({ m, channel, meId, compact }: { m: MessageInfo; channel: ChannelInfo; meId: string; compact?: boolean }) {
  const mine = m.author?.id === meId;
  const react = useToggleReaction();
  const edit = useEditMessage();
  const del = useModeratorDelete(channel.id);
  const [menu, setMenu] = useState<'none' | 'more' | 'emoji'>('none');
  const [editing, setEditing] = useState<{ text: string; mentions: ReturnType<typeof decodeMentions>['mentions'] } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menu !== 'none', () => setMenu('none'));
  const deleted = !!m.deletedAt;

  if (m.type === 'system') return <p className="px-4 py-2 text-xs text-muted">{m.body}</p>;

  const toggle = (emoji: string) => {
    const existing = m.reactions.find((r) => r.emoji === emoji);
    react.mutate({ message: m, emoji, add: !existing?.userIds.includes(meId) });
    setMenu('none');
  };

  return (
    <div id={`msg-${m.id}`} className={clsx('group relative flex gap-3', compact ? 'px-4 py-2' : 'px-4 pt-3 pb-2')}>
      <Avatar name={m.author?.displayName ?? '?'} src={m.author?.avatarUrl} size={compact ? 28 : 32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs text-muted">
          <span className="font-semibold text-text">{m.author?.displayName ?? 'Unknown'}</span>
          <span>{when(m.createdAt)}</span>
          {m.editedAt && !deleted && <span>Edited</span>}
          {m.importance !== 'normal' && !deleted && (
            <span className={clsx('font-bold uppercase', m.importance === 'urgent' ? 'text-danger' : 'text-amber-600')}>
              {m.importance === 'urgent' ? 'Urgent!' : 'Important!'}
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(null);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (editing.text.trim()) edit.mutate({ id: m.id, body: encodeMentions(editing.text.trim(), editing.mentions) }, { onSuccess: () => setEditing(null) });
                }
              }}
              aria-label="Edit message"
              className="w-full rounded-md border border-brand bg-surface px-2 py-1 text-sm outline-none"
            />
            <p className="text-[11px] text-muted">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          <div className={clsx('text-sm leading-relaxed break-words whitespace-pre-wrap', deleted && 'text-muted italic')}>
            {deleted ? 'This message has been deleted.' : m.body && <RichText body={m.body} meId={meId} />}
          </div>
        )}
        {m.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.attachments.map((a) =>
              a.mimeType.startsWith('image/') ? (
                <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.fileName} className="max-h-60 max-w-full rounded-md border border-border object-contain" />
                </a>
              ) : (
                <a key={a.id} href={`${a.url}&download=1`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                  <FileText size={20} className="text-brand" />
                  <span className="min-w-0">
                    <span className="block max-w-56 truncate font-medium">{a.fileName}</span>
                    <span className="block text-xs text-muted">{formatBytes(a.size)}</span>
                  </span>
                </a>
              ),
            )}
          </div>
        )}
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => toggle(r.emoji)}
                aria-pressed={r.userIds.includes(meId)}
                className={clsx('flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', r.userIds.includes(meId) ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-hover')}
              >
                {r.emoji} <span className="font-semibold">{r.userIds.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!deleted && !editing && (
        <div
          ref={menuRef}
          className={clsx(
            'absolute -top-3 right-4 z-10 items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-md',
            menu === 'none' ? 'hidden group-hover:flex group-focus-within:flex' : 'flex',
          )}
        >
          {QUICK_REACTIONS.slice(0, 4).map((e) => (
            <button key={e} onClick={() => toggle(e)} aria-label={`React ${e}`} className="rounded px-1 py-0.5 hover:bg-surface-hover">
              {e}
            </button>
          ))}
          <button onClick={() => setMenu(menu === 'emoji' ? 'none' : 'emoji')} aria-label="More reactions" className="rounded p-1.5 hover:bg-surface-hover">
            <SmilePlus size={15} />
          </button>
          {(mine || channel.permissions.moderate) && (
            <button onClick={() => setMenu(menu === 'more' ? 'none' : 'more')} aria-label="More options" className="rounded p-1.5 hover:bg-surface-hover">
              <MoreHorizontal size={15} />
            </button>
          )}
          {menu === 'emoji' && (
            <div className="absolute top-9 right-0 z-20">
              <EmojiGrid onPick={toggle} />
            </div>
          )}
          {menu === 'more' && (
            <div className="absolute top-9 right-0 z-20 w-40 rounded-md border border-border bg-surface py-1 text-sm shadow-lg">
              {mine && (
                <button
                  onClick={() => {
                    setEditing(decodeMentions(m.body));
                    setMenu('none');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-surface-hover"
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm(mine ? 'Delete this message?' : 'Delete this message for everyone? This is logged.')) del.mutate(m.id);
                  setMenu('none');
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-danger hover:bg-surface-hover"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const COLLAPSED_REPLIES = 3;

function PostCardImpl({ post, team, channel, meId }: { post: ChannelPost; team: TeamInfo; channel: ChannelInfo; meId: string }) {
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { root, meta, replies } = post;
  const hidden = expanded ? 0 : Math.max(0, replies.length - COLLAPSED_REPLIES);
  const mentionedMe = root.mentionIds.includes(meId);

  if (root.type === 'system') {
    return (
      <div className="my-2 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        {root.body}
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <article
      aria-label={meta.subject ?? `Post by ${root.author?.displayName ?? 'unknown'}`}
      className={clsx('my-3 overflow-hidden rounded-lg border bg-surface', mentionedMe ? 'border-l-4 border-l-brand border-border' : 'border-border', root.importance === 'urgent' && 'border-l-4 !border-l-danger')}
    >
      {meta.announcement && (
        <div className="relative flex h-32 items-end bg-gradient-to-r from-brand to-[#0f7b8a] p-4">
          {meta.headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.headerImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <h3 className="relative flex items-center gap-2 text-2xl font-bold text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]">
            <Megaphone size={20} /> {meta.subject ?? 'Announcement'}
          </h3>
        </div>
      )}
      {!meta.announcement && meta.subject && <h3 className="px-4 pt-3 text-base font-semibold">{meta.subject}</h3>}
      <ChannelMessage m={root} channel={channel} meId={meId} />
      {meta.crossPostedTo.length > 0 && (
        <p className="flex items-center gap-1 px-4 pb-2 text-xs text-muted">
          <Share2 size={12} /> Also posted in {meta.crossPostedTo.map((c) => c.label).join(', ')}
        </p>
      )}

      {replies.length > 0 && (
        <div className="border-t border-border bg-surface-2/50">
          {hidden > 0 && (
            <button onClick={() => setExpanded(true)} className="px-4 pt-2 text-xs font-semibold text-brand hover:underline">
              See {hidden} more {hidden === 1 ? 'reply' : 'replies'}
            </button>
          )}
          {replies.slice(hidden).map((r) => (
            <ChannelMessage key={r.clientId ?? r.id} m={r} channel={channel} meId={meId} compact />
          ))}
        </div>
      )}

      <div className="border-t border-border px-4 py-2">
        {replying ? (
          <ChannelComposer team={team} channel={channel} meId={meId} root={root} autoFocus onDone={() => setReplying(false)} />
        ) : channel.permissions.reply && !root.deletedAt ? (
          <button onClick={() => setReplying(true)} className="flex items-center gap-1.5 text-sm text-brand hover:underline">
            <CornerDownRight size={14} /> Reply
          </button>
        ) : (
          <p className="text-xs text-muted">{root.deletedAt ? 'This post was deleted.' : 'Replies are limited to moderators in this channel.'}</p>
        )}
      </div>
    </article>
  );
}

export const PostCard = memo(PostCardImpl);
