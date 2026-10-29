'use client';

import { Phone, PhoneOff, Video } from 'lucide-react';
import type { CallInfo } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { useCallStore } from '@/lib/call-store';
import { callTitle, myParticipant } from '@/lib/calls';

/** Ringing card: accept (video), accept audio-only, decline. */
export function IncomingCall({ call, meId }: { call: CallInfo; meId: string }) {
  const { accept, decline } = useCallStore.getState();
  const caller = call.startedBy;
  const group = call.conversationType === 'group';
  const forwardedFor = myParticipant(call, meId)?.forwardedFor;
  const video = call.kind === 'video';

  return (
    <div
      role="alertdialog"
      aria-labelledby={`incoming-${call.id}`}
      aria-describedby={`incoming-${call.id}-desc`}
      className="w-80 rounded-xl border border-border bg-surface p-4 text-text shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="relative">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand/30" aria-hidden="true" />
          <Avatar name={caller.displayName} src={caller.avatarUrl} size={48} />
        </span>
        <div className="min-w-0">
          <p id={`incoming-${call.id}`} className="truncate font-semibold">
            {group ? callTitle(call, meId) : caller.displayName}
          </p>
          <p id={`incoming-${call.id}-desc`} className="truncate text-sm text-muted">
            {group ? `${caller.displayName} is calling the group` : `Incoming ${video ? 'video' : 'audio'} call`}
            {call.transferredBy && ` · transferred by ${call.transferredBy.displayName}`}
            {forwardedFor && ` · for ${forwardedFor.displayName}`}
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={() => void decline(call.id)}
          aria-label="Decline"
          title="Decline"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-danger text-white hover:opacity-90"
        >
          <PhoneOff size={18} />
        </button>
        {video && (
          <button
            onClick={() => void accept(call.id, { video: true })}
            aria-label="Accept with video"
            title="Accept with video"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-white hover:opacity-90"
          >
            <Video size={18} />
          </button>
        )}
        <button
          onClick={() => void accept(call.id, { video: false })}
          aria-label={video ? 'Accept with audio only' : 'Accept'}
          title={video ? 'Accept with audio only' : 'Accept'}
          autoFocus
          className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-white hover:opacity-90"
        >
          <Phone size={18} />
        </button>
      </div>
    </div>
  );
}
