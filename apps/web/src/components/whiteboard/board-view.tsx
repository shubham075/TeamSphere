'use client';

import { ArrowLeft, Loader2, Share2, Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { PublicUser } from '@teamsphere/shared';
import { ShareDialog } from '@/components/pages/share-dialog';
import { errorText, Field, inputClass, Modal, PeoplePicker, primaryButton, secondaryButton } from '@/components/teams/ui';
import { useAuth } from '@/lib/auth-store';
import { boardsApi, useBoard, useCollabMutation } from '@/lib/pages';
import { useTeams } from '@/lib/teams';

// tldraw touches window on import.
const BoardCanvas = dynamic(() => import('./board-canvas'), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Loading whiteboard…</p> });
const MeetingWhiteboard = dynamic(() => import('@/components/meetings/whiteboard'), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Loading whiteboard…</p> });

/** A board with its header (rename, share, delete). `compact` drops the title row for channel tabs. */
export function BoardView({ boardId, compact, onBack, onDeleted }: { boardId: string; compact?: boolean; onBack?: () => void; onDeleted?: () => void }) {
  const { data: board, isLoading, error } = useBoard(boardId);
  const [title, setTitle] = useState('');
  const [share, setShare] = useState(false);
  const rename = useCollabMutation((t: string) => boardsApi.rename(boardId, t));
  const del = useCollabMutation(() => boardsApi.remove(boardId));
  useEffect(() => setTitle(board?.title ?? ''), [board?.title]);

  if (isLoading) return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (!board) return <p className="p-6 text-sm text-muted">{errorText(error) ?? 'This whiteboard is not available.'}</p>;
  const editable = board.role !== 'view';
  const canDelete = editable && (board.ownerType !== 'user' || board.role === 'owner');

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!compact && (
        <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
          {onBack && <button onClick={onBack} aria-label="All whiteboards" className="rounded p-1.5 text-muted hover:bg-surface-hover"><ArrowLeft size={18} /></button>}
          <input
            value={title}
            readOnly={!editable}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== board.title && rename.mutate(title.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Whiteboard name"
            maxLength={200}
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
          />
          <span className="truncate text-xs text-muted max-md:hidden">{board.channel ? `${board.channel.teamName} › ${board.channel.name}` : board.members.length ? `Shared with ${board.members.length}` : 'Only you'}</span>
          {board.ownerType === 'user' && (
            <button onClick={() => setShare(true)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface-hover">
              <Share2 size={15} /> Share
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => confirm(`Delete “${board.title}”? This can’t be undone.`) && del.mutate(undefined, { onSuccess: () => onDeleted?.() })}
              aria-label="Delete whiteboard"
              title="Delete whiteboard"
              className="rounded p-2 text-muted hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 size={17} />
            </button>
          )}
        </header>
      )}
      {(rename.error || del.error) && <p className="px-4 py-1 text-sm text-danger">{errorText(rename.error ?? del.error)}</p>}
      <div className="min-h-0 flex-1">
        <BoardCanvas boardId={board.id} />
      </div>
      {share && (
        <ShareDialog
          what="whiteboard"
          owner={board.owner}
          members={board.members}
          isOwner={board.role === 'owner'}
          onAdd={(ids) => boardsApi.addMembers(board.id, ids)}
          onRemove={(id) => boardsApi.removeMember(board.id, id)}
          onClose={() => setShare(false)}
          onLeft={onDeleted}
        />
      )}
    </div>
  );
}

/** A meeting's whiteboard opened from the Whiteboard app (synced through the meeting's own channel). */
export function MeetingBoardView({ meetingId, title, onBack }: { meetingId: string; title: string; onBack: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <button onClick={onBack} aria-label="All whiteboards" className="rounded p-1.5 text-muted hover:bg-surface-hover"><ArrowLeft size={18} /></button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        <span className="text-xs text-muted">Meeting whiteboard</span>
      </header>
      <div className="min-h-0 flex-1"><MeetingWhiteboard meetingId={meetingId} /></div>
    </div>
  );
}

export function NewBoardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: teams } = useTeams();
  const channels = (teams ?? []).filter((t) => !t.archivedAt).flatMap((t) => t.channels.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: `${t.name} › ${c.name}` })));
  const meId = useAuth((s) => s.user?.id);
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState('');
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [addTab, setAddTab] = useState(true);
  const create = useCollabMutation(() =>
    boardsApi.create({ title: title.trim() || 'Untitled board', channelId: where || null, memberIds: where ? [] : members.map((m) => m.id), addTab: !!where && addTab }),
  );
  return (
    <Modal
      title="New whiteboard"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button disabled={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (b) => onCreated(b.id) })} className={primaryButton}>Create</button>
        </>
      }
    >
      {create.error && <p className="mb-3 text-sm text-danger">{errorText(create.error)}</p>}
      <Field label="Name">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled board" maxLength={200} className={inputClass} />
      </Field>
      <Field label="Where" hint={where ? 'Everyone in the channel can draw on it.' : 'Only you and the people you add can open it.'}>
        <select value={where} onChange={(e) => setWhere(e.target.value)} className={inputClass}>
          <option value="">Personal whiteboard</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      {where ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={addTab} onChange={(e) => setAddTab(e.target.checked)} className="accent-[var(--brand)]" />
          Add as a tab in the channel
        </label>
      ) : (
        <Field label="Share with (optional)">
          <PeoplePicker picked={members} onChange={setMembers} exclude={meId ? [meId] : []} />
        </Field>
      )}
    </Modal>
  );
}
