// Pure rules behind the desktop integration (badge, toasts, call toast buttons), kept free of React and the
// browser so they can be unit-tested.
import type { CallKind, CallToastAction, PresenceStatus } from '@teamsphere/shared';

export interface UnreadSources {
  conversations?: { unread: number; markedUnread?: boolean; muted: boolean }[];
  channels?: { unread: number; muted: boolean }[];
  activity?: { read: boolean }[];
}

/** Taskbar badge and window title count: unread chats + channels with unread posts + unread Activity. Muted ones don't count. */
export function unreadBadgeCount({ conversations = [], channels = [], activity = [] }: UnreadSources): number {
  const chats = conversations.filter((c) => (c.unread > 0 || c.markedUnread) && !c.muted).length;
  const posts = channels.filter((c) => c.unread > 0 && !c.muted).length;
  return chats + posts + activity.filter((a) => !a.read).length;
}

export interface NotifyContext {
  /** The chat/channel is on screen in a focused window. */
  viewing: boolean;
  muted: boolean;
  mentioned: boolean;
  urgent: boolean;
  myStatus?: PresenceStatus;
}

/** Whether a new message should raise a toast. DND lets only urgent messages through; mute lets @mentions through. */
export function shouldNotify({ viewing, muted, mentioned, urgent, myStatus }: NotifyContext): boolean {
  if (viewing) return false;
  if (myStatus === 'dnd') return urgent;
  return !muted || mentioned || urgent;
}

export type CallCommand = { type: 'accept'; video: boolean } | { type: 'decline' } | { type: 'open' };

/**
 * Native call toast button → call action. The toast shows "Video" + "Audio" for video calls and a single
 * "Accept" for audio calls, so a plain accept follows the call's kind.
 */
export function callToastCommand(action: CallToastAction, kind: CallKind | undefined): CallCommand {
  switch (action) {
    case 'accept':
      return { type: 'accept', video: kind === 'video' };
    case 'accept-audio':
      return { type: 'accept', video: false };
    case 'decline':
      return { type: 'decline' };
    default:
      return { type: 'open' };
  }
}

/** Which native call toasts to raise and which to take down so the shown set matches `wanted`. */
export function diffCallToasts(shown: ReadonlySet<string>, wanted: readonly string[]): { show: string[]; dismiss: string[] } {
  const want = new Set(wanted);
  return { show: wanted.filter((id) => !shown.has(id)), dismiss: [...shown].filter((id) => !want.has(id)) };
}
