'use client';

import { useState } from 'react';
import type { CollabPerson, PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { errorText, Modal, PeoplePicker, secondaryButton } from '@/components/teams/ui';
import { useAuth } from '@/lib/auth-store';
import { useCollabMutation } from '@/lib/pages';

/** People with access to a personal page tree or whiteboard: the owner shares, members can leave. */
export function ShareDialog({ what, owner, members, isOwner, onAdd, onRemove, onClose, onLeft }: {
  what: string;
  owner: CollabPerson | null;
  members: CollabPerson[];
  isOwner: boolean;
  onAdd: (userIds: string[]) => Promise<unknown>;
  onRemove: (userId: string) => Promise<unknown>;
  onClose: () => void;
  onLeft?: () => void;
}) {
  const meId = useAuth((s) => s.user?.id);
  const [adding, setAdding] = useState<PublicUser[]>([]);
  const add = useCollabMutation(() => onAdd(adding.map((a) => a.id)));
  const remove = useCollabMutation((userId: string) => onRemove(userId));
  return (
    <Modal title={`Share ${what}`} onClose={onClose}>
      {(add.error || remove.error) && <p className="mb-3 text-sm text-danger">{errorText(add.error ?? remove.error)}</p>}
      <ul className="mb-3 space-y-1.5">
        {[owner, ...members].filter((p): p is CollabPerson => !!p).map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <Avatar name={p.displayName} src={p.avatarUrl} size={26} />
            <span className="flex-1">{p.displayName}{p.id === owner?.id && <span className="text-muted"> · Owner</span>}</span>
            {p.id !== owner?.id && (isOwner || p.id === meId) && (
              <button
                onClick={() => remove.mutate(p.id, { onSuccess: () => p.id === meId && (onClose(), onLeft?.()) })}
                className="text-xs text-danger hover:underline"
              >
                {p.id === meId ? 'Leave' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <>
          <PeoplePicker picked={adding} onChange={setAdding} exclude={[owner?.id ?? '', ...members.map((m) => m.id)]} />
          <button disabled={!adding.length || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setAdding([]) })} className={`${secondaryButton} mt-3`}>
            Share with {adding.length || ''} {adding.length === 1 ? 'person' : 'people'}
          </button>
        </>
      )}
    </Modal>
  );
}
