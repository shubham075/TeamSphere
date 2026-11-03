'use client';

import { CalendarDays, Hash, Plus, PenTool, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BoardView, MeetingBoardView, NewBoardDialog } from '@/components/whiteboard/board-view';
import { primaryButton } from '@/components/teams/ui';
import { formatListTime } from '@/lib/chat';
import { useBoards } from '@/lib/pages';

export default function WhiteboardRoute() {
  return (
    <Suspense>
      <WhiteboardApp />
    </Suspense>
  );
}

/** Whiteboard app: my, shared and channel boards plus meeting whiteboards. `?board=` / `?meeting=` opens one. */
function WhiteboardApp() {
  const params = useSearchParams();
  const router = useRouter();
  const boardId = params.get('board');
  const meetingId = params.get('meeting');
  const { data: boards, isLoading } = useBoards();
  const [creating, setCreating] = useState(false);
  const home = () => router.push('/whiteboard');

  if (boardId) return <BoardView key={boardId} boardId={boardId} onBack={home} onDeleted={home} />;
  if (meetingId) return <MeetingBoardView meetingId={meetingId} title={boards?.find((b) => b.id === meetingId)?.title ?? 'Meeting whiteboard'} onBack={home} />;

  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="flex-1 text-xl font-semibold">Whiteboard</h1>
          <button onClick={() => setCreating(true)} className={`${primaryButton} flex items-center gap-1.5`}><Plus size={16} /> New whiteboard</button>
        </div>
        {!isLoading && !boards?.length && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
            <PenTool size={30} className="text-brand" />
            <p className="max-w-sm text-sm text-muted">Sketch ideas together on an infinite canvas. Boards from your meetings show up here too.</p>
          </div>
        )}
        <ul className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {boards?.map((b) => {
            const Icon = b.ownerType === 'meeting' ? CalendarDays : b.channel ? Hash : User;
            return (
              <li key={`${b.ownerType}:${b.id}`}>
                <button
                  onClick={() => router.push(b.ownerType === 'meeting' ? `/whiteboard?meeting=${b.id}` : `/whiteboard?board=${b.id}`)}
                  className="flex h-full w-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-left hover:border-brand"
                >
                  <span className="flex h-20 items-center justify-center rounded-md bg-surface-2"><PenTool size={26} className="text-brand" aria-hidden /></span>
                  <span className="truncate font-medium">{b.title}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                    <Icon size={12} aria-hidden />
                    {b.ownerType === 'meeting' ? 'Meeting' : b.channel ? `${b.channel.teamName} › ${b.channel.name}` : 'Personal'} · {formatListTime(b.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {creating && <NewBoardDialog onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), router.push(`/whiteboard?board=${id}`))} />}
    </section>
  );
}
