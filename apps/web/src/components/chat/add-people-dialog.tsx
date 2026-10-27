'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import type { ConversationInfo, PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api, ApiError } from '@/lib/api';
import { upsertConversation } from '@/lib/chat';

export function AddPeopleDialog({ conversation, onClose }: { conversation: ConversationInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const [shareHistory, setShareHistory] = useState(true);
  const memberIds = new Set(conversation.members.map((m) => m.user.id));

  const { data: people } = useQuery({
    queryKey: ['people', q],
    queryFn: () => api<PublicUser[]>(`/users?take=20&q=${encodeURIComponent(q)}`),
  });
  const add = useMutation({
    mutationFn: () =>
      api<ConversationInfo>(`/conversations/${conversation.id}/members`, {
        method: 'POST',
        json: { userIds: picked.map((u) => u.id), shareHistory },
      }),
    onSuccess: (c) => {
      upsertConversation(qc, c);
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Add people" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[75vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">Add people</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pt-4">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <ul className="mt-2 flex-1 overflow-y-auto px-3">
          {people
            ?.filter((u) => !memberIds.has(u.id))
            .map((u) => {
              const selected = picked.some((x) => x.id === u.id);
              return (
                <li key={u.id}>
                  <button
                    onClick={() => setPicked((p) => (selected ? p.filter((x) => x.id !== u.id) : [...p, u]))}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover"
                  >
                    <Avatar name={u.displayName} src={u.avatarUrl} size={30} />
                    <span className="min-w-0 flex-1 truncate text-sm">{u.displayName}</span>
                    {selected && <Check size={16} className="text-brand" />}
                  </button>
                </li>
              );
            })}
        </ul>
        <label className="flex items-center gap-2 px-5 py-3 text-sm">
          <input type="checkbox" checked={shareHistory} onChange={(e) => setShareHistory(e.target.checked)} className="accent-brand" />
          Include chat history
        </label>
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {add.error && <p className="mr-auto text-sm text-danger">{add.error instanceof ApiError ? add.error.message : 'Failed'}</p>}
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-hover">
            Cancel
          </button>
          <button
            onClick={() => add.mutate()}
            disabled={!picked.length || add.isPending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50"
          >
            Add {picked.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
