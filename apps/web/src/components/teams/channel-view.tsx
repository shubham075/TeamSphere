'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, Bell, BellOff, FileText, Loader2, Pencil, Settings } from 'lucide-react';
import { Fragment, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentInfo, ChannelInfo, ChannelNotes, TeamInfo } from '@teamsphere/shared';
import { RichText } from '@/components/chat/rich-text';
import { api, ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/chat';
import { useChatUi } from '@/lib/chat-store';
import { markChannelRead, tk, useChannelSettings, usePosts, useSaveNotes } from '@/lib/teams';
import { ChannelComposer } from './channel-composer';
import { ChannelSettingsDialog } from './dialogs';
import { PostCard } from './post-card';
import { setActiveChannel } from './teams-realtime';
import { ChannelIcon, primaryButton, secondaryButton } from './ui';

type Tab = 'posts' | 'files' | 'notes';

export function ChannelView({ team, channel, meId }: { team: TeamInfo; channel: ChannelInfo; meId: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('posts');
  const [settings, setSettings] = useState(false);
  const prefs = useChannelSettings(channel.id);
  const readOnly = !!channel.archivedAt || !!team.archivedAt;

  // Mark as active (suppresses unread/notifications) and read while open and focused.
  useEffect(() => {
    setActiveChannel(channel.id);
    const markIfVisible = () => document.visibilityState === 'visible' && markChannelRead(qc, channel.id);
    markIfVisible();
    window.addEventListener('focus', markIfVisible);
    document.addEventListener('visibilitychange', markIfVisible);
    return () => {
      setActiveChannel(null);
      window.removeEventListener('focus', markIfVisible);
      document.removeEventListener('visibilitychange', markIfVisible);
    };
  }, [channel.id, qc]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="border-b border-border bg-surface px-5 pt-3">
        <div className="flex items-center gap-2">
          <ChannelIcon type={channel.type} size={18} className="text-muted" />
          <h1 className="min-w-0 truncate text-lg font-semibold">{channel.name}</h1>
          <span className="truncate text-sm text-muted">· {channel.sharedFrom?.teamName ?? team.name}</span>
          {readOnly && (
            <span className="flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">
              <Archive size={12} /> Archived
            </span>
          )}
          <span className="flex-1" />
          <button
            onClick={() => prefs.mutate({ muted: !channel.muted })}
            aria-label={channel.muted ? 'Turn notifications on' : 'Mute channel'}
            title={channel.muted ? 'Muted' : 'Mute'}
            className="rounded p-2 text-muted hover:bg-surface-hover"
          >
            {channel.muted ? <BellOff size={17} /> : <Bell size={17} />}
          </button>
          <button onClick={() => setSettings(true)} aria-label="Channel settings" title="Channel settings" className="rounded p-2 text-muted hover:bg-surface-hover">
            <Settings size={17} />
          </button>
        </div>
        {channel.description && <p className="mt-0.5 truncate text-xs text-muted">{channel.description}</p>}
        <div role="tablist" aria-label="Channel tabs" className="mt-2 flex gap-4">
          {(['posts', 'files', 'notes'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx('border-b-2 pb-2 text-sm capitalize', tab === t ? 'border-brand font-semibold text-text' : 'border-transparent text-muted hover:text-text')}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      {tab === 'posts' && <PostsTab team={team} channel={channel} meId={meId} />}
      {tab === 'files' && <FilesTab channel={channel} />}
      {tab === 'notes' && <NotesTab channel={channel} readOnly={readOnly} />}
      {settings && <ChannelSettingsDialog team={team} channel={channel} onClose={() => setSettings(false)} />}
    </div>
  );
}

function PostsTab({ team, channel, meId }: { team: TeamInfo; channel: ChannelInfo; meId: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = usePosts(channel.id);
  const typing = useChatUi((s) => s.typing[channel.conversationId]);
  const [composing, setComposing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevHeight = useRef<number | null>(null);
  const atBottom = useRef(true);
  const posts = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.posts) : []), [data]);
  const signature = posts.map((p) => `${p.root.id}:${p.replies.length}`).join();

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [signature]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 200 && hasNextPage && !isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void fetchNextPage();
    }
  };

  let lastDay = '';
  return (
    <>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 md:px-8" role="feed" aria-busy={isLoading}>
        <div className="mx-auto max-w-4xl py-4">
          {(isLoading || isFetchingNextPage) && (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-muted" />
            </div>
          )}
          {!hasNextPage && !isLoading && (
            <div className="py-6 text-center text-sm text-muted">
              Welcome to <span className="font-semibold text-text">{channel.name}</span>
              {channel.description ? ` · ${channel.description}` : ''}.
            </div>
          )}
          {posts.map((p) => {
            const day = new Date(p.root.createdAt).toDateString();
            const divider = day !== lastDay;
            lastDay = day;
            return (
              <Fragment key={p.root.clientId ?? p.root.id}>
                {divider && (
                  <div className="my-3 flex items-center gap-3 text-xs font-semibold text-muted">
                    <span className="h-px flex-1 bg-border" />
                    {new Date(p.root.createdAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <PostCard post={p} team={team} channel={channel} meId={meId} />
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="h-5 px-8 text-xs text-muted" aria-live="polite">
        {typing?.length ? `${typing.map((t) => t.displayName.split(' ')[0]).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…` : ''}
      </div>
      <div className="px-4 pb-4 md:px-8">
        <div className="mx-auto max-w-4xl">
          {!channel.permissions.post ? (
            <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
              {channel.archivedAt || team.archivedAt ? 'This channel is archived and read-only.' : 'Only owners and moderators can start new posts in this channel.'}
            </p>
          ) : composing ? (
            <ChannelComposer team={team} channel={channel} meId={meId} autoFocus onDone={() => setComposing(false)} />
          ) : (
            <button onClick={() => setComposing(true)} className={clsx(primaryButton, 'flex items-center gap-2')}>
              <Pencil size={15} /> Start a post
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function FilesTab({ channel }: { channel: ChannelInfo }) {
  const { data, isLoading } = useQuery({
    queryKey: tk.files(channel.id),
    queryFn: () => api<(AttachmentInfo & { uploadedBy: string; createdAt: string })[]>(`/channels/${channel.id}/files`),
  });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <p className="mb-3 text-xs text-muted">Files shared in this channel’s posts. A full document library arrives with Files (phase 6).</p>
      {isLoading && <Loader2 className="animate-spin text-muted" />}
      {!isLoading && !data?.length && <p className="text-sm text-muted">No files yet.</p>}
      <table className="w-full max-w-4xl text-sm">
        {!!data?.length && (
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Name</th>
              <th className="py-1 font-medium">Shared by</th>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Size</th>
            </tr>
          </thead>
        )}
        <tbody>
          {data?.map((f) => (
            <tr key={f.id} className="border-t border-border">
              <td className="py-2">
                <a href={`${f.url}&download=1`} className="flex items-center gap-2 hover:underline">
                  <FileText size={16} className="text-brand" /> {f.fileName}
                </a>
              </td>
              <td>{f.uploadedBy}</td>
              <td>{new Date(f.createdAt).toLocaleDateString()}</td>
              <td>{formatBytes(f.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Minimal markdown: # headings, - lists, blank-line paragraphs; inline formatting via RichText. */
function NotesMarkdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={out.length} className="my-2 list-disc pl-6">{list.map((l, i) => <li key={i}><RichText body={l} /></li>)}</ul>);
    list = [];
  };
  for (const line of text.split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      list.push(li[1]);
      continue;
    }
    flush();
    if (h) {
      const size = ['text-2xl', 'text-xl', 'text-lg'][h[1].length - 1];
      out.push(<p key={out.length} role="heading" aria-level={h[1].length} className={`${size} mt-4 mb-1 font-semibold`}><RichText body={h[2]} /></p>);
    } else if (line.trim()) {
      out.push(<p key={out.length} className="my-1"><RichText body={line} /></p>);
    }
  }
  flush();
  return <>{out}</>;
}

function NotesTab({ channel, readOnly }: { channel: ChannelInfo; readOnly: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: tk.notes(channel.id), queryFn: () => api<ChannelNotes>(`/channels/${channel.id}/notes`) });
  const save = useSaveNotes(channel.id);
  const [draft, setDraft] = useState<{ text: string; version: number } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  if (isLoading || !data) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex items-center gap-2">
          <p className="flex-1 text-xs text-muted">
            {data.updatedAt ? `Last edited by ${data.updatedBy?.displayName ?? 'someone'} · ${new Date(data.updatedAt).toLocaleString()}` : 'Shared notes for everyone in this channel.'}
          </p>
          {!readOnly && !draft && (
            <button onClick={() => setDraft({ text: data.notes, version: data.version })} className={secondaryButton}>
              <span className="flex items-center gap-1.5"><Pencil size={14} /> Edit</span>
            </button>
          )}
        </div>
        {conflict && <p className="mb-2 rounded border border-danger px-3 py-2 text-sm text-danger">{conflict}</p>}
        {draft ? (
          <>
            <textarea
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              rows={18}
              aria-label="Notes (markdown)"
              className="w-full rounded-md border border-border bg-surface p-3 font-mono text-sm outline-none focus:border-brand"
            />
            <div className="mt-2 flex gap-2">
              <button
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    { notes: draft.text, version: draft.version },
                    {
                      onSuccess: () => (setDraft(null), setConflict(null)),
                      onError: (e) => {
                        if (e instanceof ApiError && e.status === 409) {
                          const current = (e.body as { current?: ChannelNotes })?.current;
                          setConflict(e.message);
                          if (current) setDraft({ text: draft.text, version: current.version });
                        } else setConflict(e instanceof ApiError ? e.message : 'Couldn’t save');
                      },
                    },
                  )
                }
                className={primaryButton}
              >
                Save
              </button>
              <button onClick={() => (setDraft(null), setConflict(null))} className={secondaryButton}>Cancel</button>
              <span className="self-center text-xs text-muted"># Heading · - list · **bold** · *italic* · `code`</span>
            </div>
          </>
        ) : data.notes.trim() ? (
          <div className="rounded-md border border-border bg-surface p-5 text-sm leading-relaxed">
            <NotesMarkdown text={data.notes} />
          </div>
        ) : (
          <p className="text-sm text-muted">No notes yet.{!readOnly && ' Select Edit to start.'}</p>
        )}
      </div>
    </div>
  );
}
