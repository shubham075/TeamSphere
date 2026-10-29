'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  ChannelMessageEvent, ChannelNotes, ChannelUpdatedEvent, MessageInfo, ReactionEvent, TEAMS_WS_EVENTS, TeamInfo,
  TeamUpdatedEvent, toPlainText, WS_EVENTS,
} from '@teamsphere/shared';
import { useAuth } from '@/lib/auth-store';
import { myStatus, notifyDesktop } from '@/lib/notify';
import { getSocket } from '@/lib/socket';
import {
  findChannel, markChannelRead, patchChannel, setChannelReactions, tk, updateChannelMessage, upsertChannel, upsertPost,
  upsertReply,
} from '@/lib/teams';

/** Channel currently on screen; its new messages are marked read instead of counted as unread. */
let activeChannelId: string | null = null;
export const setActiveChannel = (id: string | null) => {
  activeChannelId = id;
};
const isViewing = (channelId: string) => activeChannelId === channelId && document.visibilityState === 'visible' && document.hasFocus();

const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRead(qc: ReturnType<typeof useQueryClient>, channelId: string) {
  clearTimeout(readTimers.get(channelId));
  readTimers.set(channelId, setTimeout(() => markChannelRead(qc, channelId), 400));
}

/**
 * Folds Teams realtime events into the query cache. Lives beside RealtimeProvider and reuses its socket; edits,
 * deletes and reactions on channel posts arrive as the chat events and are matched by conversation id.
 */
export function TeamsRealtime() {
  const qc = useQueryClient();
  const router = useRouter();
  const meId = useAuth((s) => s.user?.id);

  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();

    const onConnect = () => {
      void qc.invalidateQueries({ queryKey: tk.teams });
      void qc.invalidateQueries({ queryKey: ['channel-posts'] });
    };
    const onTeam = (e: TeamUpdatedEvent) => {
      void qc.invalidateQueries({ queryKey: tk.teams });
      if (e.removed && location.pathname.startsWith('/teams')) {
        const viewing = findChannel(qc.getQueryData<TeamInfo[]>(tk.teams), (c) => c.id === activeChannelId);
        if (viewing?.team.id === e.teamId || location.pathname.includes(e.teamId)) router.replace('/teams');
      }
    };
    const onChannel = (e: ChannelUpdatedEvent) => {
      if (e.channel) upsertChannel(qc, e.channel);
      else void qc.invalidateQueries({ queryKey: tk.teams });
      if (e.removed && activeChannelId === e.channelId) router.replace('/teams');
    };
    const onMessage = (e: ChannelMessageEvent) => {
      if (e.post) upsertPost(qc, e.channelId, e.post);
      if (e.reply && e.rootId) upsertReply(qc, e.channelId, e.rootId, e.reply);
      const m = e.post?.root ?? e.reply;
      if (!m) return;
      patchChannel(qc, e.channelId, (c) => ({ ...c, lastMessageAt: m.createdAt }));
      if (m.author?.id === meId || m.type === 'system') return;
      if (isViewing(e.channelId)) return scheduleRead(qc, e.channelId);
      const mentioned = m.mentionIds.includes(meId);
      patchChannel(qc, e.channelId, (c) => ({ ...c, unread: c.unread + 1, unreadMentions: c.unreadMentions + (mentioned ? 1 : 0) }));
      const found = findChannel(qc.getQueryData<TeamInfo[]>(tk.teams), (c) => c.id === e.channelId);
      // Channels toast for @mentions and announcements only; Do not disturb silences both.
      if (found && (mentioned || (!found.channel.muted && e.post?.meta.announcement)) && myStatus(qc) !== 'dnd') {
        const title = `${m.author?.displayName ?? 'Someone'} in ${found.team.name} › ${found.channel.name}`;
        const body = (e.post?.meta.subject ? `${e.post.meta.subject}: ` : '') + toPlainText(m.body);
        const path = `/teams/c/${e.channelId}`;
        notifyDesktop(title, body.slice(0, 200), path);
      }
    };
    const onUpdated = (m: MessageInfo) => updateChannelMessage(qc, m);
    const onReaction = (e: ReactionEvent) => setChannelReactions(qc, e.conversationId, e.messageId, e.reactions);
    const onNotes = (n: ChannelNotes) => qc.setQueryData(tk.notes(n.channelId), n);

    socket.on('connect', onConnect);
    socket.on(WS_EVENTS.teamUpdated, onTeam);
    socket.on(WS_EVENTS.channelUpdated, onChannel);
    socket.on(TEAMS_WS_EVENTS.channelMessage, onMessage);
    socket.on(WS_EVENTS.messageUpdated, onUpdated);
    socket.on(WS_EVENTS.reactionChanged, onReaction);
    socket.on(TEAMS_WS_EVENTS.channelNotes, onNotes);
    return () => {
      socket.off('connect', onConnect);
      socket.off(WS_EVENTS.teamUpdated, onTeam);
      socket.off(WS_EVENTS.channelUpdated, onChannel);
      socket.off(TEAMS_WS_EVENTS.channelMessage, onMessage);
      socket.off(WS_EVENTS.messageUpdated, onUpdated);
      socket.off(WS_EVENTS.reactionChanged, onReaction);
      socket.off(TEAMS_WS_EVENTS.channelNotes, onNotes);
    };
  }, [meId, qc, router]);

  return null;
}
