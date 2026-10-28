import { describe, expect, it } from 'vitest';
import { DEFAULT_MODERATION, DEFAULT_TEAM_SETTINGS } from '@teamsphere/shared';
import { canCreateChannel, channelPermissions, generateJoinCode, resolveMentions, wouldLeaveNoOwner } from './teams.policy';

const base = {
  userId: 'u1',
  teamRole: 'member' as const,
  channelRole: null,
  channelType: 'standard' as const,
  moderation: DEFAULT_MODERATION,
  settings: DEFAULT_TEAM_SETTINGS,
  archived: false,
};

describe('channelPermissions', () => {
  it('lets members post and reply in an unmoderated channel', () => {
    expect(channelPermissions(base)).toMatchObject({ post: true, reply: true, mentionGroups: true, manage: false, moderate: false });
  });

  it('restricts new posts and replies to owners and moderators when moderated', () => {
    const moderation = { ...DEFAULT_MODERATION, newPosts: 'moderators' as const, allowReplies: false, mentions: 'moderators' as const, moderatorIds: ['mod'] };
    expect(channelPermissions({ ...base, moderation })).toMatchObject({ post: false, reply: false, mentionGroups: false });
    expect(channelPermissions({ ...base, moderation, userId: 'mod' })).toMatchObject({ post: true, reply: true, mentionGroups: true, moderate: true });
    expect(channelPermissions({ ...base, moderation, teamRole: 'owner' })).toMatchObject({ post: true, reply: true, manage: true });
  });

  it('makes archived channels read-only', () => {
    expect(channelPermissions({ ...base, teamRole: 'owner', archived: true })).toMatchObject({ post: false, reply: false });
  });
});

describe('canCreateChannel', () => {
  it('follows team settings for members and guests', () => {
    expect(canCreateChannel('member', 'standard', DEFAULT_TEAM_SETTINGS)).toBe(true);
    expect(canCreateChannel('member', 'private', { ...DEFAULT_TEAM_SETTINGS, membersCanCreatePrivateChannels: false })).toBe(false);
    expect(canCreateChannel('guest', 'standard', DEFAULT_TEAM_SETTINGS)).toBe(false);
    expect(canCreateChannel('guest', 'private', { ...DEFAULT_TEAM_SETTINGS, guestsCanCreateChannels: true })).toBe(false);
    expect(canCreateChannel('owner', 'shared', DEFAULT_TEAM_SETTINGS)).toBe(true);
    expect(canCreateChannel(null, 'standard', DEFAULT_TEAM_SETTINGS)).toBe(false);
  });
});

describe('resolveMentions', () => {
  const ctx = {
    authorId: 'a',
    teamId: 'team1',
    channelId: 'chan1',
    channelType: 'standard' as const,
    channelMemberIds: ['a', 'b', 'c', 'd'],
    tags: [{ id: 'tag1', memberIds: ['c', 'outsider'] }],
    settings: DEFAULT_TEAM_SETTINGS,
    canMentionGroups: true,
  };

  it('separates personal and group mentions and never notifies the author', () => {
    expect(resolveMentions(['b', 'chan1'], ctx)).toEqual({ personal: ['b'], group: ['c', 'd'] });
  });

  it('limits tags to channel members and ignores non-members', () => {
    expect(resolveMentions(['tag1', 'stranger'], ctx)).toEqual({ personal: [], group: ['c'] });
  });

  it('ignores @team outside standard channels and when disabled', () => {
    expect(resolveMentions(['team1'], { ...ctx, channelType: 'private' }).group).toEqual([]);
    expect(resolveMentions(['team1'], { ...ctx, settings: { ...DEFAULT_TEAM_SETTINGS, allowTeamMentions: false } }).group).toEqual([]);
    expect(resolveMentions(['team1'], ctx).group).toEqual(['b', 'c', 'd']);
  });

  it('drops group mentions for people who may not use them', () => {
    expect(resolveMentions(['chan1', 'tag1', 'b'], { ...ctx, canMentionGroups: false })).toEqual({ personal: ['b'], group: [] });
  });
});

describe('helpers', () => {
  it('generates readable join codes', () => {
    expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
  });

  it('protects the last owner', () => {
    expect(wouldLeaveNoOwner(['o'], 'o', 'member')).toBe(true);
    expect(wouldLeaveNoOwner(['o', 'p'], 'o', null)).toBe(false);
    expect(wouldLeaveNoOwner(['o'], 'm', null)).toBe(false);
  });
});
