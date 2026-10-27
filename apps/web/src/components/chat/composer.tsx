'use client';

import clsx from 'clsx';
import { AlertCircle, Bold, Code, Italic, Loader2, Paperclip, Send, Smile, X } from 'lucide-react';
import { forwardRef, KeyboardEvent, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AttachmentInfo, ConversationInfo, MAX_ATTACHMENT_BYTES, MENTION_PATTERN, MessageInfo, toPlainText, WS_EVENTS,
} from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { ApiError } from '@/lib/api';
import { formatBytes, uploadAttachment, useEditMessage, useSendMessage } from '@/lib/chat';
import { getSocket } from '@/lib/socket';
import { useDismiss } from '@/lib/use-dismiss';
import { EmojiGrid } from './emoji-grid';

interface PendingFile {
  key: string;
  name: string;
  size: number;
  info?: AttachmentInfo;
  error?: string;
}

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
  focus: () => void;
}

interface Props {
  conversation: ConversationInfo;
  meId: string;
  replyTo: MessageInfo | null;
  editing: MessageInfo | null;
  onCancelReply: () => void;
  onDoneEditing: () => void;
  placeholder: string;
}

type Importance = MessageInfo['importance'];

/** Turns stored `@[Name](id)` tokens into readable `@Name` text plus a name → id map. */
function decodeMentions(body: string) {
  const mentions: { name: string; id: string }[] = [];
  const text = body.replace(MENTION_PATTERN, (_m, name: string, id: string) => {
    if (!mentions.some((x) => x.id === id)) mentions.push({ name, id });
    return `@${name}`;
  });
  return { text, mentions };
}

function encodeMentions(text: string, mentions: { name: string; id: string }[]) {
  let out = text;
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${m.name}`).join(`@[${m.name}](${m.id})`);
  }
  return out;
}

const TYPING_THROTTLE = 3000;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { conversation, meId, replyTo, editing, onCancelReply, onDoneEditing, placeholder },
  ref,
) {
  const send = useSendMessage(conversation.id);
  const edit = useEditMessage();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<{ name: string; id: string }[]>([]);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [importance, setImportance] = useState<Importance>('normal');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  useDismiss(emojiRef, emojiOpen, () => setEmojiOpen(false));

  // Load the message being edited.
  useEffect(() => {
    if (editing) {
      const { text: t, mentions: m } = decodeMentions(editing.body);
      setText(t);
      setMentions(m);
      requestAnimationFrame(() => textRef.current?.focus());
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  // Auto-grow the textarea up to a limit.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const candidates = useMemo(() => {
    if (mentionQuery === null || conversation.type === 'direct' || conversation.type === 'self') return [];
    const q = mentionQuery.toLowerCase();
    return conversation.members
      .map((m) => m.user)
      .filter((u) => u.id !== meId && u.displayName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionQuery, conversation, meId]);

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textRef.current?.focus() }));

  function addFiles(list: File[]) {
    for (const file of list) {
      const key = `${Date.now()}-${Math.random()}`;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setFiles((f) => [...f, { key, name: file.name, size: file.size, error: `Larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}` }]);
        continue;
      }
      setFiles((f) => [...f, { key, name: file.name || 'pasted-image.png', size: file.size }]);
      uploadAttachment(conversation.id, file)
        .then((info) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, info } : x))))
        .catch((e) =>
          setFiles((f) => f.map((x) => (x.key === key ? { ...x, error: e instanceof ApiError ? e.message : 'Upload failed' } : x))),
        );
    }
  }

  function emitTyping() {
    const now = Date.now();
    if (now - lastTyping.current > TYPING_THROTTLE) {
      lastTyping.current = now;
      getSocket().emit(WS_EVENTS.typing, { conversationId: conversation.id });
    }
  }

  function onChange(value: string) {
    setText(value);
    setError(null);
    if (value) emitTyping();
    const caret = textRef.current?.selectionStart ?? value.length;
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setMentionQuery(match ? match[2] : null);
    setMentionIndex(0);
    // Forget mentions whose text was deleted.
    setMentions((ms) => ms.filter((m) => value.includes(`@${m.name}`)));
  }

  function pickMention(user: { id: string; displayName: string }) {
    const el = textRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${user.displayName} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentions((ms) => (ms.some((m) => m.id === user.id) ? ms : [...ms, { name: user.displayName, id: user.id }]));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function wrapSelection(marker: string) {
    const el = textRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const next = text.slice(0, s) + marker + text.slice(s, e) + marker + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + marker.length, e + marker.length);
    });
  }

  function insertAtCaret(value: string) {
    const el = textRef.current;
    const s = el?.selectionStart ?? text.length;
    const e = el?.selectionEnd ?? text.length;
    setText(text.slice(0, s) + value + text.slice(e));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + value.length, s + value.length);
    });
  }

  const uploading = files.some((f) => !f.info && !f.error);
  const ready = files.filter((f) => f.info).map((f) => f.info!);

  async function submit() {
    const body = encodeMentions(text.trim(), mentions);
    if (editing) {
      if (!body) return;
      try {
        await edit.mutateAsync({ id: editing.id, body });
        reset();
        onDoneEditing();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not save the edit');
      }
      return;
    }
    if ((!body && !ready.length) || uploading) return;
    send.mutate({
      body,
      parentId: replyTo?.id,
      importance,
      attachments: ready,
      clientId: crypto.randomUUID(),
    });
    reset();
    onCancelReply();
  }

  function reset() {
    setText('');
    setMentions([]);
    setFiles([]);
    setImportance('normal');
    setMentionQuery(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (candidates.length) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setMentionIndex((i) => (i + 1) % candidates.length));
      if (e.key === 'ArrowUp') return (e.preventDefault(), setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length));
      if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), pickMention(candidates[mentionIndex]));
      if (e.key === 'Escape') return setMentionQuery(null);
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      if (editing) {
        reset();
        onDoneEditing();
      } else if (replyTo) onCancelReply();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection('**');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrapSelection('_');
    }
  }

  const canSend = editing ? !!text.trim() : (!!text.trim() || ready.length > 0) && !uploading;

  return (
    <div className="px-4 pt-1 pb-4 md:px-6">
      <div className={clsx('relative rounded-lg border bg-surface shadow-sm', editing ? 'border-brand' : 'border-border focus-within:border-brand')}>
        {(replyTo || editing) && (
          <div className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs">
            <div className="min-w-0 flex-1 border-l-4 border-brand pl-2">
              <p className="font-semibold">{editing ? 'Editing message' : `Replying to ${replyTo!.author?.displayName ?? 'message'}`}</p>
              {replyTo && <p className="truncate text-muted">{toPlainText(replyTo.body) || 'Attachment'}</p>}
            </div>
            <button
              onClick={() => {
                if (editing) {
                  reset();
                  onDoneEditing();
                } else onCancelReply();
              }}
              aria-label="Cancel"
              className="rounded p-0.5 hover:bg-surface-hover"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {importance !== 'normal' && (
          <p className={clsx('px-3 pt-2 text-[11px] font-bold uppercase', importance === 'urgent' ? 'text-danger' : 'text-amber-600')}>
            {importance === 'urgent' ? 'Urgent! Recipients are notified more prominently.' : 'Important!'}
          </p>
        )}

        <textarea
          ref={textRef}
          value={text}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length && !editing) {
              e.preventDefault();
              addFiles(pasted);
            }
          }}
          placeholder={placeholder}
          aria-label="Type a message"
          className="block max-h-60 w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none"
        />

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-3 pb-2">
            {files.map((f) => (
              <li
                key={f.key}
                className={clsx('flex max-w-60 items-center gap-2 rounded-md border px-2 py-1 text-xs', f.error ? 'border-danger text-danger' : 'border-border')}
              >
                {f.error ? <AlertCircle size={14} /> : !f.info ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                <span className="truncate" title={f.error ?? f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-muted">{formatBytes(f.size)}</span>
                <button onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))} aria-label={`Remove ${f.name}`}>
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <button onClick={() => wrapSelection('**')} title="Bold (Ctrl+B)" aria-label="Bold" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-text">
            <Bold size={16} />
          </button>
          <button onClick={() => wrapSelection('_')} title="Italic (Ctrl+I)" aria-label="Italic" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-text">
            <Italic size={16} />
          </button>
          <button onClick={() => wrapSelection('`')} title="Code" aria-label="Code" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-text">
            <Code size={16} />
          </button>
          <div ref={emojiRef} className="relative">
            <button onClick={() => setEmojiOpen((o) => !o)} title="Emoji" aria-label="Emoji" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-text">
              <Smile size={16} />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-10 left-0 z-20">
                <EmojiGrid
                  onPick={(e) => {
                    insertAtCaret(e);
                    setEmojiOpen(false);
                  }}
                />
              </div>
            )}
          </div>
          {!editing && (
            <>
              <button onClick={() => fileRef.current?.click()} title="Attach files" aria-label="Attach files" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-text">
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
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as Importance)}
                title="Delivery options"
                aria-label="Delivery options"
                className="ml-1 rounded bg-transparent px-1 py-1 text-xs text-muted hover:bg-surface-hover"
              >
                <option value="normal">Standard</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
            </>
          )}
          {error && <span className="ml-2 truncate text-xs text-danger">{error}</span>}
          <button
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label={editing ? 'Save' : 'Send'}
            className="ml-auto rounded-md p-1.5 text-brand hover:bg-brand-soft disabled:text-muted disabled:hover:bg-transparent"
          >
            <Send size={18} />
          </button>
        </div>

        {candidates.length > 0 && (
          <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-2 z-20 mb-1 w-72 rounded-md border border-border bg-surface py-1 shadow-xl">
            {candidates.map((u, i) => (
              <li key={u.id}>
                <button
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(u);
                  }}
                  className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === mentionIndex ? 'bg-brand-soft' : 'hover:bg-surface-hover')}
                >
                  <Avatar name={u.displayName} src={u.avatarUrl} size={24} />
                  <span className="truncate">{u.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
