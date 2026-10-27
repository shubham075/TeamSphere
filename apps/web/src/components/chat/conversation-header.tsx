'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Bell, BellOff, LogOut, MoreHorizontal, Pencil, Phone, Pin, PinOff, UserPlus, Users, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConversationInfo, PRESENCE_LABELS_OTHERS, PublicUser } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { conversationTitle, otherMember, removeConversation, upsertConversation, useMemberSettings } from '@/lib/chat';
import { usePresence } from '@/lib/chat-store';
import { useDismiss } from '@/lib/use-dismiss';
import { ConversationAvatar } from './conversation-avatar';
import { AddPeopleDialog } from './add-people-dialog';
import { NewChatDialog } from './new-chat-dialog';

export function ConversationHeader({ conversation: c, meId }: { conversation: ConversationInfo; meId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const settings = useMemberSettings(c.id);
  const other = otherMember(c, meId);
  const presence = usePresence(other?.id, other?.presence);
  const [menu, setMenu] = useState<'none' | 'more' | 'people'>('none');
  const [dialog, setDialog] = useState<'none' | 'add' | 'group'>('none');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title ?? '');
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menu !== 'none', () => setMenu('none'));

  const rename = useMutation({
    mutationFn: (t: string | null) => api<ConversationInfo>(`/conversations/${c.id}`, { method: 'PATCH', json: { title: t } }),
    onSuccess: (info) => upsertConversation(qc, info),
  });
  const leave = useMutation({
    mutationFn: () => api(`/conversations/${c.id}/members/${meId}`, { method: 'DELETE' }),
    onSuccess: () => {
      removeConversation(qc, c.id);
      router.replace('/chat');
    },
  });

  const subtitle =
    c.type === 'direct' ? PRESENCE_LABELS_OTHERS[presence] : c.type === 'group' ? `${c.members.length} people` : 'Notes, links and files for yourself';

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 md:px-5">
      <Link href="/chat" aria-label="Back to chats" className="rounded p-1 hover:bg-surface-hover md:hidden">
        <ArrowLeft size={18} />
      </Link>
      <ConversationAvatar conversation={c} meId={meId} size={32} />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate(title.trim() || null);
              setRenaming(false);
            }}
          >
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setRenaming(false)}
              maxLength={128}
              placeholder="Group name"
              className="w-full max-w-sm rounded border border-brand bg-surface px-2 py-0.5 text-sm font-semibold outline-none"
            />
          </form>
        ) : (
          <h2 className="truncate text-base font-semibold">{conversationTitle(c, meId)}</h2>
        )}
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>

      <div ref={menuRef} className="relative flex items-center gap-1">
        {/* Calling arrives in Phase 3. */}
        <button disabled title="Video call (coming soon)" aria-label="Video call" className="rounded p-2 text-muted opacity-50">
          <Video size={18} />
        </button>
        <button disabled title="Audio call (coming soon)" aria-label="Audio call" className="rounded p-2 text-muted opacity-50">
          <Phone size={18} />
        </button>
        {c.type === 'group' && (
          <button
            onClick={() => setMenu(menu === 'people' ? 'none' : 'people')}
            aria-label="People"
            className={clsx('flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-surface-hover', menu === 'people' && 'bg-surface-hover')}
          >
            <Users size={18} /> {c.members.length}
          </button>
        )}
        <button onClick={() => setMenu(menu === 'more' ? 'none' : 'more')} aria-label="More options" className="rounded p-2 hover:bg-surface-hover">
          <MoreHorizontal size={18} />
        </button>

        {menu === 'people' && (
          <div className="absolute top-11 right-0 z-30 w-72 rounded-md border border-border bg-surface py-2 shadow-xl">
            <ul className="max-h-80 overflow-y-auto">
              {c.members.map((m) => (
                <MemberRow key={m.user.id} user={m.user} you={m.user.id === meId} />
              ))}
            </ul>
            <button
              onClick={() => {
                setDialog('add');
                setMenu('none');
              }}
              className="mt-1 flex w-full items-center gap-2 border-t border-border px-4 pt-2 text-sm text-brand hover:underline"
            >
              <UserPlus size={16} /> Add people
            </button>
          </div>
        )}

        {menu === 'more' && (
          <div className="absolute top-11 right-0 z-30 w-56 rounded-md border border-border bg-surface py-1 text-sm shadow-xl">
            <MenuButton icon={c.pinned ? PinOff : Pin} label={c.pinned ? 'Unpin' : 'Pin'} onClick={() => settings.mutate({ pinned: !c.pinned })} />
            <MenuButton icon={c.muted ? Bell : BellOff} label={c.muted ? 'Unmute' : 'Mute'} onClick={() => settings.mutate({ muted: !c.muted })} />
            {c.type === 'group' && (
              <>
                <MenuButton icon={Pencil} label="Rename" onClick={() => setRenaming(true)} />
                <MenuButton icon={UserPlus} label="Add people" onClick={() => setDialog('add')} />
                <MenuButton
                  icon={LogOut}
                  label="Leave chat"
                  danger
                  onClick={() => {
                    if (confirm('Leave this chat? You will stop receiving its messages.')) leave.mutate();
                  }}
                />
              </>
            )}
            {c.type === 'direct' && <MenuButton icon={UserPlus} label="Start group with…" onClick={() => setDialog('group')} />}
          </div>
        )}
      </div>

      {dialog === 'add' && <AddPeopleDialog conversation={c} onClose={() => setDialog('none')} />}
      {dialog === 'group' && other && (
        <NewChatDialog
          onClose={() => setDialog('none')}
          initial={[{ id: other.id, displayName: other.displayName, avatarUrl: other.avatarUrl, jobTitle: other.jobTitle } as PublicUser]}
        />
      )}
    </header>
  );

  function MenuButton({ icon: Icon, label, onClick, danger }: { icon: typeof Pin; label: string; onClick: () => void; danger?: boolean }) {
    return (
      <button
        onClick={() => {
          onClick();
          setMenu('none');
        }}
        className={clsx('flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-hover', danger && 'text-danger')}
      >
        <Icon size={15} /> {label}
      </button>
    );
  }
}

function MemberRow({ user, you }: { user: ConversationInfo['members'][number]['user']; you: boolean }) {
  const presence = usePresence(user.id, user.presence);
  return (
    <li className="flex items-center gap-2.5 px-4 py-1.5">
      <Avatar name={user.displayName} src={user.avatarUrl} size={28} presence={presence} />
      <span className="min-w-0">
        <span className="block truncate text-sm">
          {user.displayName}
          {you && <span className="text-muted"> (You)</span>}
        </span>
        {user.jobTitle && <span className="block truncate text-xs text-muted">{user.jobTitle}</span>}
      </span>
    </li>
  );
}
