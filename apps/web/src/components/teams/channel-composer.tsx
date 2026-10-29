'use client';

import clsx from 'clsx';
import { AlertCircle, ImagePlus, Loader2, Megaphone, Paperclip, Send, Share2, Users, X } from 'lucide-react';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentInfo, ChannelInfo, MAX_ATTACHMENT_BYTES, MENTION_PATTERN, MessageInfo, TeamInfo, WS_EVENTS } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { ApiError } from '@/lib/api';
import { formatBytes, uploadAttachment } from '@/lib/chat';
import { getSocket } from '@/lib/socket';
import { useChannelMembers, useCreatePost, useCreateReply, useTags, useTeams } from '@/lib/teams';
import { inputClass } from './ui';

export interface MentionToken {
  name: string;
  id: string;
}

/** Stored `@[Name](id)` tokens → readable `@Name` text plus the tokens, for editing. */
export function decodeMentions(body: string) {
  const mentions: MentionToken[] = [];
  const text = body.replace(MENTION_PATTERN, (_m, name: string, id: string) => {
    if (!mentions.some((x) => x.id === id)) mentions.push({ name, id });
    return `@${name}`;
  });
  return { text, mentions };
}

export function encodeMentions(text: string, mentions: MentionToken[]) {
  let out = text;
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) out = out.split(`@${m.name}`).join(`@[${m.name}](${m.id})`);
  return out;
}

interface Candidate extends MentionToken {
  kind: 'person' | 'team' | 'channel' | 'tag';
  avatarUrl?: string | null;
  hint?: string;
}

/** @mention candidates for a channel: its members, plus @team / @channel / tags when allowed. */
function useMentionCandidates(team: TeamInfo, channel: ChannelInfo, meId: string) {
  const { data: members } = useChannelMembers(channel.id);
  const { data: tags } = useTags(team.myRole ? channel.teamId : undefined);
  return useMemo(() => {
    const out: Candidate[] = [];
    if (channel.permissions.mentionGroups) {
      if (channel.type === 'standard' && team.settings.allowTeamMentions && !channel.sharedFrom) {
        out.push({ kind: 'team', id: team.id, name: team.name, hint: 'Notify everyone in the team' });
      }
      if (team.settings.allowChannelMentions) out.push({ kind: 'channel', id: channel.id, name: channel.name, hint: 'Notify everyone in this channel' });
      for (const t of tags ?? []) out.push({ kind: 'tag', id: t.id, name: t.name, hint: `Tag · ${t.memberIds.length} people` });
    }
    for (const m of members ?? []) if (m.user.id !== meId) out.push({ kind: 'person', id: m.user.id, name: m.user.displayName, avatarUrl: m.user.avatarUrl });
    return out;
  }, [members, tags, team, channel, meId]);
}

interface PendingFile {
  key: string;
  name: string;
  size: number;
  info?: AttachmentInfo;
  error?: string;
}

interface Props {
  team: TeamInfo;
  channel: ChannelInfo;
  meId: string;
  /** Reply to this post; otherwise the composer starts a new post. */
  root?: MessageInfo;
  onDone?: () => void;
  autoFocus?: boolean;
}

export function ChannelComposer({ team, channel, meId, root, onDone, autoFocus }: Props) {
  const isPost = !root;
  const createPost = useCreatePost(channel.id);
  const createReply = useCreateReply(channel.id, root?.id ?? '');
  const candidatesAll = useMentionCandidates(team, channel, meId);
  const { data: teams } = useTeams();

  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [mentions, setMentions] = useState<MentionToken[]>([]);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [importance, setImportance] = useState<MessageInfo['importance']>('normal');
  const [announcement, setAnnouncement] = useState(false);
  const [header, setHeader] = useState<PendingFile | null>(null);
  const [crossOpen, setCrossOpen] = useState(false);
  const [alsoIds, setAlsoIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return candidatesAll.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [candidatesAll, mentionQuery]);

  // Channels I could cross-post to.
  const crossTargets = useMemo(
    () =>
      (teams ?? []).flatMap((t) =>
        t.channels.filter((c) => c.id !== channel.id && c.permissions.post && !c.archivedAt).map((c) => ({ id: c.id, label: `${t.name} › ${c.name}` })),
      ),
    [teams, channel.id],
  );

  function upload(file: File, onDone: (f: PendingFile) => void, key = `${Date.now()}-${Math.random()}`) {
    if (file.size > MAX_ATTACHMENT_BYTES) return onDone({ key, name: file.name, size: file.size, error: `Larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}` });
    onDone({ key, name: file.name, size: file.size });
    uploadAttachment(channel.conversationId, file)
      .then((info) => onDone({ key, name: file.name, size: file.size, info }))
      .catch((e) => onDone({ key, name: file.name, size: file.size, error: e instanceof ApiError ? e.message : 'Upload failed' }));
  }

  function addFiles(list: File[]) {
    for (const file of list) upload(file, (f) => setFiles((all) => (all.some((x) => x.key === f.key) ? all.map((x) => (x.key === f.key ? f : x)) : [...all, f])));
  }

  function onChange(value: string) {
    setText(value);
    setError(null);
    const el = textRef.current;
    const caret = el?.selectionStart ?? value.length;
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setMentionQuery(match ? match[2] : null);
    setMentionIndex(0);
    const now = Date.now();
    if (now - lastTyping.current > 3000) {
      lastTyping.current = now;
      getSocket().emit(WS_EVENTS.typing, { conversationId: channel.conversationId });
    }
  }

  function pickMention(c: Candidate) {
    const el = textRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${c.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentions((m) => (m.some((x) => x.id === c.id) ? m : [...m, { name: c.name, id: c.id }]));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  const uploading = files.some((f) => !f.info && !f.error) || (header && !header.info && !header.error);
  const ready = files.filter((f) => f.info).map((f) => f.info!);
  const canSend = !uploading && (text.trim() || ready.length || (isPost && subject.trim()));
  const pending = createPost.isPending || createReply.isPending;

  async function submit() {
    if (!canSend || pending) return;
    const body = encodeMentions(text.trim(), mentions.filter((m) => text.includes(`@${m.name}`)));
    const clientId = crypto.randomUUID();
    try {
      if (isPost) {
        await createPost.mutateAsync({
          body,
          subject: subject.trim() || undefined,
          announcement,
          headerAttachmentId: announcement ? header?.info?.id : undefined,
          importance,
          attachmentIds: ready.map((a) => a.id),
          alsoChannelIds: alsoIds,
          clientId,
        });
      } else {
        await createReply.mutateAsync({ body, attachmentIds: ready.map((a) => a.id), clientId });
      }
      setText('');
      setSubject('');
      setMentions([]);
      setFiles([]);
      setHeader(null);
      setAnnouncement(false);
      setImportance('normal');
      setAlsoIds([]);
      setCrossOpen(false);
      onDone?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t send. Try again.');
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(candidates[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') return setMentionQuery(null);
    }
    // Replies send on Enter like chat; new posts are longer, so Enter adds a line and Ctrl+Enter sends.
    if (e.key === 'Enter' && !e.shiftKey && (!isPost || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape' && onDone) onDone();
  }

  return (
    <div className={clsx('relative rounded-lg border bg-surface', announcement ? 'border-brand' : 'border-border', isPost && 'shadow-sm')}>
      {candidates.length > 0 && (
        <ul role="listbox" aria-label="Mention suggestions" className="absolute bottom-full left-2 z-30 mb-1 w-72 rounded-md border border-border bg-surface py-1 shadow-lg">
          {candidates.map((c, i) => (
            <li key={`${c.kind}-${c.id}`} role="option" aria-selected={i === mentionIndex}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(c);
                }}
                className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === mentionIndex ? 'bg-brand-soft' : 'hover:bg-surface-hover')}
              >
                {c.kind === 'person' ? (
                  <Avatar name={c.name} src={c.avatarUrl} size={24} />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-brand">
                    <Users size={13} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  {c.hint && <span className="block truncate text-[11px] text-muted">{c.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isPost && announcement && (
        <div className="relative m-2 mb-0 flex h-28 items-end overflow-hidden rounded-md bg-gradient-to-r from-brand to-[#0f7b8a] p-3">
          {header?.info && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.info.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Type a headline"
            aria-label="Headline"
            maxLength={200}
            className="relative w-full bg-transparent text-xl font-bold text-white placeholder:text-white/70 outline-none [text-shadow:0_1px_3px_rgb(0_0_0/0.5)]"
          />
          <button
            onClick={() => headerRef.current?.click()}
            className="relative ml-2 flex shrink-0 items-center gap-1 rounded bg-black/40 px-2 py-1 text-xs text-white hover:bg-black/60"
          >
            {header && !header.info && !header.error ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Header image
          </button>
          <input
            ref={headerRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f, setHeader);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {isPost && !announcement && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Add a subject"
          aria-label="Subject"
          maxLength={200}
          className="w-full border-b border-border bg-transparent px-3 py-2 text-base font-semibold outline-none"
        />
      )}

      <textarea
        ref={textRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const pasted = [...e.clipboardData.files];
          if (pasted.length) {
            e.preventDefault();
            addFiles(pasted);
          }
        }}
        rows={isPost ? 3 : 1}
        placeholder={isPost ? 'Start a post. Type @ to mention someone, a tag, the channel or the team.' : 'Reply'}
        aria-label={isPost ? 'New post' : 'Reply'}
        className="block w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none"
      />

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-3 pb-2">
          {files.map((f) => (
            <li key={f.key} className={clsx('flex items-center gap-2 rounded border px-2 py-1 text-xs', f.error ? 'border-danger text-danger' : 'border-border')}>
              {!f.info && !f.error && <Loader2 size={12} className="animate-spin" />}
              {f.error && <AlertCircle size={12} />}
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="text-muted">{f.error ?? formatBytes(f.size)}</span>
              <button onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))} aria-label={`Remove ${f.name}`}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {isPost && crossOpen && (
        <div className="mx-3 mb-2 rounded-md border border-border p-2">
          <p className="mb-1 text-xs font-semibold text-muted">Also post in</p>
          {crossTargets.length === 0 && <p className="text-xs text-muted">No other channels you can post in.</p>}
          <div className="max-h-32 overflow-y-auto">
            {crossTargets.map((t) => (
              <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={alsoIds.includes(t.id)}
                  onChange={(e) => setAlsoIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-border px-2 py-1">
        <button onClick={() => fileRef.current?.click()} aria-label="Attach files" title="Attach files" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-text">
          <Paperclip size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        {isPost && (
          <>
            <button
              onClick={() => setAnnouncement((a) => !a)}
              aria-pressed={announcement}
              title="Announcement"
              className={clsx('flex items-center gap-1 rounded px-1.5 py-1 text-xs', announcement ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-hover')}
            >
              <Megaphone size={15} /> Announcement
            </button>
            <button
              onClick={() => setCrossOpen((o) => !o)}
              aria-pressed={crossOpen}
              title="Post in multiple channels"
              className={clsx('flex items-center gap-1 rounded px-1.5 py-1 text-xs', alsoIds.length ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-hover')}
            >
              <Share2 size={15} /> {alsoIds.length ? `+${alsoIds.length} channels` : 'Post in multiple channels'}
            </button>
            <select
              value={importance}
              onChange={(e) => setImportance(e.target.value as MessageInfo['importance'])}
              aria-label="Importance"
              className="rounded bg-transparent px-1 py-1 text-xs text-muted hover:bg-surface-hover"
            >
              <option value="normal">Standard</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
          </>
        )}
        {error && <span className="ml-2 truncate text-xs text-danger">{error}</span>}
        <span className="flex-1" />
        {onDone && (
          <button onClick={onDone} className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover">
            Cancel
          </button>
        )}
        <button
          onClick={() => void submit()}
          disabled={!canSend || pending}
          aria-label={isPost ? 'Post' : 'Send reply'}
          title={isPost ? 'Post (Ctrl+Enter)' : 'Send'}
          className="rounded p-1.5 text-brand hover:bg-surface-hover disabled:text-muted disabled:opacity-50"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
      {isPost && announcement && !subject.trim() && <span className="sr-only">Add a headline for the announcement</span>}
      {/* Hidden helper so the editor of an existing message can reuse the same input styling. */}
      <span hidden className={inputClass} />
    </div>
  );
}
