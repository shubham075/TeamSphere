'use client';

import { useState } from 'react';
import type { PublicUser } from '@teamsphere/shared';
import { useWritableChannels } from '@/components/lists/list-dialogs';
import { errorText, Field, inputClass, Modal, PeoplePicker, primaryButton, secondaryButton } from '@/components/teams/ui';
import { useAuth } from '@/lib/auth-store';
import { formsApi, newId, useListsMutation } from '@/lib/lists';

export function NewFormDialog({ onClose, onCreated, channelId }: { onClose: () => void; onCreated: (id: string) => void; channelId?: string }) {
  const channels = useWritableChannels();
  const meId = useAuth((s) => s.user?.id);
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState(channelId ?? '');
  const [members, setMembers] = useState<PublicUser[]>([]);
  // Starts with one question so the builder isn't empty.
  const create = useListsMutation(() =>
    formsApi.create({ title: title.trim(), channelId: where || null, memberIds: where ? [] : members.map((m) => m.id), questions: [{ id: newId(), type: 'text', title: 'Your answer', required: false }], addTab: !!where && !channelId }),
  );
  return (
    <Modal
      title="New form"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>Cancel</button>
          <button disabled={!title.trim() || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (f) => onCreated(f.id) })} className={primaryButton}>Create</button>
        </>
      }
    >
      {create.error && <p className="mb-3 text-sm text-danger">{errorText(create.error)}</p>}
      <Field label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
      </Field>
      {!channelId && (
        <Field label="Where" hint={where ? 'Everyone in the channel can edit it and see results; channel members respond.' : 'You and your co-authors edit it; anyone in the organization with the link can respond.'}>
          <select value={where} onChange={(e) => setWhere(e.target.value)} className={inputClass}>
            <option value="">Personal form</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      )}
      {!where && (
        <Field label="Co-authors (optional)">
          <PeoplePicker picked={members} onChange={setMembers} exclude={meId ? [meId] : []} />
        </Field>
      )}
    </Modal>
  );
}
