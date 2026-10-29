import { describe, expect, it } from 'vitest';
import { callToastCommand, diffCallToasts, shouldNotify, unreadBadgeCount } from './desktop-logic';

describe('unreadBadgeCount', () => {
  it('adds unread chats, channels and activity, skipping muted ones', () => {
    expect(
      unreadBadgeCount({
        conversations: [
          { unread: 3, muted: false },
          { unread: 0, markedUnread: true, muted: false },
          { unread: 5, muted: true },
          { unread: 0, muted: false },
        ],
        channels: [
          { unread: 2, muted: false },
          { unread: 1, muted: true },
        ],
        activity: [{ read: false }, { read: true }, { read: false }],
      }),
    ).toBe(2 + 1 + 2);
  });

  it('is zero before anything has loaded', () => {
    expect(unreadBadgeCount({})).toBe(0);
  });
});

describe('shouldNotify', () => {
  const base = { viewing: false, muted: false, mentioned: false, urgent: false, myStatus: 'available' as const };

  it('notifies by default but not for the chat in view', () => {
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, viewing: true, urgent: true })).toBe(false);
  });

  it('lets mentions and urgent messages through a mute', () => {
    expect(shouldNotify({ ...base, muted: true })).toBe(false);
    expect(shouldNotify({ ...base, muted: true, mentioned: true })).toBe(true);
    expect(shouldNotify({ ...base, muted: true, urgent: true })).toBe(true);
  });

  it('lets only urgent messages through Do not disturb', () => {
    expect(shouldNotify({ ...base, myStatus: 'dnd', mentioned: true })).toBe(false);
    expect(shouldNotify({ ...base, myStatus: 'dnd', urgent: true })).toBe(true);
    expect(shouldNotify({ ...base, myStatus: 'busy' })).toBe(true);
  });
});

describe('callToastCommand', () => {
  it('maps toast buttons to call actions', () => {
    expect(callToastCommand('accept', 'video')).toEqual({ type: 'accept', video: true });
    expect(callToastCommand('accept', 'audio')).toEqual({ type: 'accept', video: false });
    expect(callToastCommand('accept-audio', 'video')).toEqual({ type: 'accept', video: false });
    expect(callToastCommand('decline', 'video')).toEqual({ type: 'decline' });
    expect(callToastCommand('open', undefined)).toEqual({ type: 'open' });
  });

  it('never turns the camera on for an unknown call', () => {
    expect(callToastCommand('accept', undefined)).toEqual({ type: 'accept', video: false });
  });
});

describe('diffCallToasts', () => {
  it('shows new rings and dismisses answered/cancelled ones', () => {
    expect(diffCallToasts(new Set(['a', 'b']), ['b', 'c'])).toEqual({ show: ['c'], dismiss: ['a'] });
    expect(diffCallToasts(new Set(), [])).toEqual({ show: [], dismiss: [] });
  });
});
