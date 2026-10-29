import { randomInt } from 'node:crypto';
import type { ChannelModeration, ChannelPermissions, ChannelType, TeamRole, TeamSettings } from '@teamsphere/shared';

/** Pure permission and mention rules, kept apart from the service so they can be unit tested. */

export interface ChannelAccessContext {
  userId: string;
  /** Role in the channel's host team (null for people outside it, e.g. shared-channel guests). */
  teamRole: TeamRole | null;
  /** Explicit role in a private/shared channel. */
  channelRole: 'owner' | 'member' | null;
  channelType: ChannelType;
  moderation: ChannelModeration;
  settings: TeamSettings;
  /** Channel or team is archived (read-only). */
  archived: boolean;
}

export function channelPermissions(c: ChannelAccessContext): ChannelPermissions {
  const teamOwner = c.teamRole === 'owner';
  const channelOwner = c.channelRole === 'owner';
  const manage =
    teamOwner || channelOwner || (c.channelType === 'standard' && c.teamRole === 'member' && c.settings.membersCanDeleteChannels);
  const moderator = teamOwner || channelOwner || c.moderation.moderatorIds.includes(c.userId);
  const writable = !c.archived;
  return {
    post: writable && (c.moderation.newPosts === 'everyone' || moderator),
    reply: writable && (c.moderation.allowReplies || moderator),
    mentionGroups: writable && (c.moderation.mentions === 'everyone' || moderator),
    manage,
    moderate: (teamOwner && c.settings.ownersCanDeleteMessages) || channelOwner || c.moderation.moderatorIds.includes(c.userId),
  };
}

export function canCreateChannel(role: TeamRole | null, type: ChannelType, settings: TeamSettings): boolean {
  if (role === 'owner') return true;
  if (role === 'member') return type === 'standard' ? settings.membersCanCreateChannels : settings.membersCanCreatePrivateChannels;
  if (role === 'guest') return type === 'standard' && settings.guestsCanCreateChannels;
  return false;
}

export function canManageTags(role: TeamRole | null, settings: TeamSettings): boolean {
  return role === 'owner' || (role === 'member' && settings.membersCanManageTags);
}

export interface MentionContext {
  authorId: string;
  teamId: string;
  channelId: string;
  channelType: ChannelType;
  /** Everyone with access to the channel. */
  channelMemberIds: string[];
  tags: { id: string; memberIds: string[] }[];
  settings: TeamSettings;
  /** From channelPermissions().mentionGroups. */
  canMentionGroups: boolean;
}

export interface ResolvedMentions {
  /** Named individually: "mentioned you". */
  personal: string[];
  /** Reached through @team / @channel / @tag only. */
  group: string[];
}

/**
 * Turns the ids in `@[Name](id)` tokens into the people to notify. Team, channel and tag tokens use the same
 * syntax with the team/channel/tag id. Only channel members can be reached; the author is never notified.
 */
export function resolveMentions(ids: string[], c: MentionContext): ResolvedMentions {
  const members = new Set(c.channelMemberIds);
  const personal = new Set<string>();
  const group = new Set<string>();
  for (const id of ids) {
    if (id === c.teamId) {
      // @team only makes sense where the whole team can read the post.
      if (c.canMentionGroups && c.settings.allowTeamMentions && c.channelType === 'standard') c.channelMemberIds.forEach((u) => group.add(u));
    } else if (id === c.channelId) {
      if (c.canMentionGroups && c.settings.allowChannelMentions) c.channelMemberIds.forEach((u) => group.add(u));
    } else {
      const tag = c.tags.find((t) => t.id === id);
      if (tag) {
        if (c.canMentionGroups) tag.memberIds.filter((u) => members.has(u)).forEach((u) => group.add(u));
      } else if (members.has(id)) {
        personal.add(id);
      }
    }
  }
  personal.delete(c.authorId);
  group.delete(c.authorId);
  for (const u of personal) group.delete(u);
  return { personal: [...personal], group: [...group] };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function generateJoinCode(length = 7): string {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** Moving a member to `nextRole` must leave the team with at least one owner. */
export function wouldLeaveNoOwner(owners: string[], userId: string, nextRole: TeamRole | null): boolean {
  return owners.includes(userId) && nextRole !== 'owner' && owners.length <= 1;
}
