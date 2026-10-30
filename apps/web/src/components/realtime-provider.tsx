'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import {
  ActivityItem, ChatSectionInfo, ConversationInfo, MessageInfo, PresenceEvent, ReactionEvent, ReadEvent, toPlainText,
  TypingEvent, UrgentReminderEvent, WS_EVENTS,
} from '@teamsphere/shared';
import { api } from '@/lib/api';
import { bindCallEvents } from '@/lib/call-store';
import { useAuth } from '@/lib/auth-store';
import {
  conversationTitle, patchConversation, qk, removeConversation, setReactions, upsertConversation, upsertMessage,
  useActivity, useConversations,
} from '@/lib/chat';
import { useChatUi } from '@/lib/chat-store';
import { getDesktop } from '@/lib/desktop';
import { shouldNotify, unreadBadgeCount } from '@/lib/desktop-logic';
import { myStatus, notifyDesktop } from '@/lib/notify';
import { isPopout } from '@/lib/popout';
import { closeSocket, getSocket } from '@/lib/socket';
import { useTeams } from '@/lib/teams';

const isViewing = (conversationId: string) =>
  useChatUi.getState().activeConversationId === conversationId && document.visibilityState === 'visible' && document.hasFocus();

/** Debounced "mark as read" so a burst of incoming messages makes one request. */
const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleMarkRead(conversationId: string) {
  if (useChatUi.getState().readPausedFor === conversationId) return;
  clearTimeout(readTimers.get(conversationId));
  readTimers.set(
    conversationId,
    setTimeout(() => {
      readTimers.delete(conversationId);
      void api(`/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => undefined);
    }, 400),
  );
}

/** Stops auto-marking a chat read (after "Mark as unread" while it's open) until `resumeMarkRead`. */
export function pauseMarkRead(conversationId: string) {
  clearTimeout(readTimers.get(conversationId));
  readTimers.delete(conversationId);
  useChatUi.getState().pauseRead(conversationId);
}

export function resumeMarkRead(conversationId: string) {
  if (useChatUi.getState().readPausedFor === conversationId) useChatUi.getState().pauseRead(null);
}

/**
 * Owns the Socket.IO connection for the signed-in user and folds realtime events into the query cache.
 * Also keeps unread counts in sync with the window title and the desktop app's taskbar badge.
 */
export function RealtimeProvider() {
  const qc = useQueryClient();
  const router = useRouter();
  const meId = useAuth((s) => s.user?.id);
  const { data: conversations } = useConversations();
  const { data: activity } = useActivity();
  const { data: teams } = useTeams();

  useEffect(() => {
    if (!meId) return;
    const me = { id: meId };
    const socket = getSocket();
    const { setPresence, addTyping, pruneTyping } = useChatUi.getState();

    socket.on('connect', () => {
      // Catch up on anything missed while disconnected.
      void qc.invalidateQueries({ queryKey: qk.conversations });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: qk.activity });
    });

    // Admin changed org settings or policies: refetch branding/limits and what this user may do.
    socket.on(WS_EVENTS.orgUpdated, () => {
      void qc.invalidateQueries({ queryKey: ['org'] });
      void qc.invalidateQueries({ queryKey: ['my-policies'] });
    });

    socket.on(WS_EVENTS.messageNew, (m: MessageInfo) => {
      const list = qc.getQueryData<ConversationInfo[]>(qk.conversations);
      const conversation = list?.find((c) => c.id === m.conversationId);
      if (!conversation) {
        void qc.invalidateQueries({ queryKey: qk.conversations });
        return;
      }
      upsertMessage(qc, m);
      const mine = m.author?.id === me.id;
      if (mine || m.type === 'system') return;
      if (isViewing(m.conversationId)) {
        scheduleMarkRead(m.conversationId);
        return;
      }
      patchConversation(qc, m.conversationId, (c) => ({ ...c, unread: c.unread + 1, hidden: false }));
      const mentioned = m.mentionIds.includes(me.id);
      const urgent = m.importance === 'urgent';
      if (shouldNotify({ viewing: false, muted: conversation.muted, mentioned, urgent, myStatus: myStatus(qc) })) {
        const title = conversation.type === 'direct' ? (m.author?.displayName ?? 'New message') : `${m.author?.displayName} in ${conversationTitle(conversation, me.id)}`;
        const body = toPlainText(m.body) || (m.attachments.length ? 'Sent a file' : '');
        notifyDesktop(urgent ? `URGENT: ${title}` : title, body.slice(0, 200), `/chat/${m.conversationId}`);
      }
    });

    socket.on(WS_EVENTS.messageUpdated, (m: MessageInfo) => upsertMessage(qc, m));
    socket.on(WS_EVENTS.reactionChanged, (e: ReactionEvent) => setReactions(qc, e.conversationId, e.messageId, e.reactions));

    socket.on(WS_EVENTS.readUpdated, (e: ReadEvent) =>
      patchConversation(qc, e.conversationId, (c) => ({
        ...c,
        unread: e.userId === me.id ? 0 : c.unread,
        members: c.members.map((m) => (m.user.id === e.userId ? { ...m, lastReadAt: e.lastReadAt } : m)),
      })),
    );

    socket.on(WS_EVENTS.conversationUpdated, (c: ConversationInfo | { id: string; removed: true } | { sectionRemoved: string }) => {
      if ('sectionRemoved' in c) {
        qc.setQueryData<ConversationInfo[]>(qk.conversations, (list) =>
          list?.map((x) => (x.sectionId === c.sectionRemoved ? { ...x, sectionId: null } : x)),
        );
      } else if ('removed' in c) {
        removeConversation(qc, c.id);
        if (useChatUi.getState().activeConversationId === c.id) router.replace('/chat');
      } else {
        upsertConversation(qc, c);
      }
    });

    socket.on(WS_EVENTS.sectionsUpdated, (sections: ChatSectionInfo[]) => qc.setQueryData(qk.sections, sections));
    socket.on(WS_EVENTS.savedUpdated, () => void qc.invalidateQueries({ queryKey: qk.saved }));
    socket.on(WS_EVENTS.scheduledUpdated, (e: { conversationId: string }) => void qc.invalidateQueries({ queryKey: qk.scheduled(e.conversationId) }));

    socket.on(WS_EVENTS.messageUrgentReminder, (e: UrgentReminderEvent) => {
      if (isViewing(e.conversationId)) return;
      notifyDesktop(`URGENT: ${e.authorName}`, e.preview, `/chat/${e.conversationId}`);
      getDesktop()?.flashFrame(true);
    });

    socket.on(WS_EVENTS.typing, (e: TypingEvent) => addTyping(e.conversationId, e.userId, e.displayName));

    socket.on(WS_EVENTS.presenceChanged, (p: PresenceEvent) => {
      setPresence({ [p.userId]: p.status });
      useChatUi.getState().setDetails(p.userId, { statusMessage: p.statusMessage, outOfOffice: p.outOfOffice });
      if (p.userId === me.id) void qc.invalidateQueries({ queryKey: ['me'] });
    });

    socket.on(WS_EVENTS.notificationNew, (n: ActivityItem) => {
      qc.setQueryData<ActivityItem[]>(qk.activity, (list) => (list ? [n, ...list.filter((x) => x.id !== n.id)] : list));
    });

    bindCallEvents(socket, qc);

    const prune = setInterval(pruneTyping, 1000);
    return () => {
      clearInterval(prune);
      closeSocket();
    };
  }, [meId, qc, router]);

  // Seed the presence store from loaded conversations.
  useEffect(() => {
    if (!conversations) return;
    const entries: Record<string, ConversationInfo['members'][number]['user']['presence']> = {};
    for (const c of conversations) for (const m of c.members) entries[m.user.id] ??= m.user.presence;
    useChatUi.getState().setPresence(Object.fromEntries(Object.entries(entries).filter(([id]) => !(id in useChatUi.getState().presence))));
  }, [conversations]);

  // Unread totals → window title + desktop taskbar badge (same number in both).
  const total = useMemo(
    () => unreadBadgeCount({ conversations, channels: teams?.flatMap((t) => t.channels), activity }),
    [conversations, teams, activity],
  );
  const pathname = usePathname();
  useEffect(() => {
    if (!isPopout()) getDesktop()?.setUnreadCount(total);
    // Next.js resets <title> after each navigation, so reapply it once the new page has rendered.
    const t = setTimeout(() => {
      document.title = total ? `(${total}) TeamSphere` : 'TeamSphere';
    }, 50);
    return () => clearTimeout(t);
  }, [total, pathname]);

  return null;
}
