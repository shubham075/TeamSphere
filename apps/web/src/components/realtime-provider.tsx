'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import {
  ActivityItem, ConversationInfo, MessageInfo, PresenceEvent, ReactionEvent, ReadEvent, toPlainText, TypingEvent,
  WS_EVENTS,
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
import { closeSocket, getSocket } from '@/lib/socket';

const isViewing = (conversationId: string) =>
  useChatUi.getState().activeConversationId === conversationId && document.visibilityState === 'visible' && document.hasFocus();

/** Debounced "mark as read" so a burst of incoming messages makes one request. */
const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleMarkRead(conversationId: string) {
  clearTimeout(readTimers.get(conversationId));
  readTimers.set(
    conversationId,
    setTimeout(() => {
      readTimers.delete(conversationId);
      void api(`/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => undefined);
    }, 400),
  );
}

function notifyDesktop(title: string, body: string, path: string) {
  const desktop = getDesktop();
  if (desktop) return desktop.notify({ title, body, path });
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag: path });
    n.onclick = () => {
      window.focus();
      location.assign(path);
    };
  }
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
      if (!conversation.muted || mentioned) {
        const title = conversation.type === 'direct' ? (m.author?.displayName ?? 'New message') : `${m.author?.displayName} in ${conversationTitle(conversation, me.id)}`;
        const body = toPlainText(m.body) || (m.attachments.length ? 'Sent a file' : '');
        notifyDesktop(m.importance === 'urgent' ? `URGENT: ${title}` : title, body.slice(0, 200), `/chat/${m.conversationId}`);
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

    socket.on(WS_EVENTS.conversationUpdated, (c: ConversationInfo | { id: string; removed: true }) => {
      if ('removed' in c) {
        removeConversation(qc, c.id);
        if (useChatUi.getState().activeConversationId === c.id) router.replace('/chat');
      } else {
        upsertConversation(qc, c);
      }
    });

    socket.on(WS_EVENTS.typing, (e: TypingEvent) => addTyping(e.conversationId, e.userId, e.displayName));

    socket.on(WS_EVENTS.presenceChanged, (p: PresenceEvent) => {
      setPresence({ [p.userId]: p.status });
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

  // Unread totals → window title + desktop taskbar badge.
  const unreadChats = useMemo(() => conversations?.filter((c) => c.unread > 0 && !c.muted).length ?? 0, [conversations]);
  const unreadActivity = useMemo(() => activity?.filter((a) => !a.read).length ?? 0, [activity]);
  const pathname = usePathname();
  useEffect(() => {
    const total = unreadChats + unreadActivity;
    getDesktop()?.setUnreadCount(total);
    // Next.js resets <title> after each navigation, so reapply it once the new page has rendered.
    const t = setTimeout(() => {
      document.title = total ? `(${total}) TeamSphere` : 'TeamSphere';
    }, 50);
    return () => clearTimeout(t);
  }, [unreadChats, unreadActivity, pathname]);

  return null;
}
