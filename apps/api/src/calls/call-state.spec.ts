import { describe, expect, it } from 'vitest';
import { RING_TIMEOUT_MS } from '@teamsphere/shared';
import {
  callDurationSec, canTransition, defaultEndReason, formatDuration, historyDirection, isRingExpired, nextCallStatus,
  ParticipantState,
} from './call-state';

const caller = (status: ParticipantState['status'] = 'joined'): ParticipantState => ({ status, isCaller: true });
const callee = (status: ParticipantState['status']): ParticipantState => ({ status, isCaller: false });
const oneToOne = { status: 'ringing' as const, answered: false, group: false };

describe('participant transitions', () => {
  it('lets a ringing person answer, decline or miss', () => {
    expect(canTransition('ringing', 'joined')).toBe(true);
    expect(canTransition('ringing', 'declined')).toBe(true);
    expect(canTransition('ringing', 'missed')).toBe(true);
  });

  it('never rings someone who is already connected', () => {
    expect(canTransition('joined', 'ringing')).toBe(false);
    expect(canTransition('joined', 'declined')).toBe(false);
  });

  it('lets people who declined or missed join a running call later', () => {
    expect(canTransition('declined', 'joined')).toBe(true);
    expect(canTransition('missed', 'joined')).toBe(true);
    expect(canTransition('left', 'joined')).toBe(true);
  });
});

describe('nextCallStatus', () => {
  it('keeps ringing while a callee is still ringing', () => {
    expect(nextCallStatus(oneToOne, [caller(), callee('ringing')])).toBe('ringing');
  });

  it('becomes active once answered', () => {
    expect(nextCallStatus({ ...oneToOne, answered: true }, [caller(), callee('joined')])).toBe('active');
  });

  it('is declined when every callee declines', () => {
    expect(nextCallStatus(oneToOne, [caller(), callee('declined')])).toBe('declined');
  });

  it('is missed when the ring times out', () => {
    expect(nextCallStatus(oneToOne, [caller(), callee('missed')])).toBe('missed');
  });

  it('is missed when the caller hangs up before anyone answers', () => {
    expect(nextCallStatus(oneToOne, [caller('left'), callee('ringing')])).toBe('missed');
  });

  it('is missed (not declined) when only some group members declined', () => {
    expect(nextCallStatus({ ...oneToOne, group: true }, [caller(), callee('declined'), callee('missed')])).toBe('missed');
  });

  it('ends a 1:1 call when either side leaves', () => {
    expect(nextCallStatus({ status: 'active', answered: true, group: false }, [caller('left'), callee('joined')])).toBe('ended');
  });

  it('keeps a 1:1 call open while someone added to it is still ringing', () => {
    expect(nextCallStatus({ status: 'active', answered: true, group: false }, [caller(), callee('left'), callee('ringing')])).toBe('active');
  });

  it('keeps a group call running until everyone has left', () => {
    const group = { status: 'active' as const, answered: true, group: true };
    expect(nextCallStatus(group, [caller('left'), callee('joined'), callee('left')])).toBe('active');
    expect(nextCallStatus(group, [caller('left'), callee('left'), callee('left')])).toBe('ended');
  });

  it('never reopens a finished call', () => {
    expect(nextCallStatus({ status: 'ended', answered: true, group: false }, [caller(), callee('joined')])).toBe('ended');
  });
});

describe('defaultEndReason', () => {
  it('explains why an unanswered call ended', () => {
    expect(defaultEndReason('missed', [caller('left'), callee('missed')])).toBe('cancelled');
    expect(defaultEndReason('missed', [caller(), callee('busy')])).toBe('busy');
    expect(defaultEndReason('missed', [caller(), callee('forwarded')])).toBe('voicemail');
    expect(defaultEndReason('missed', [caller(), callee('missed')])).toBe('no_answer');
    expect(defaultEndReason('declined', [caller(), callee('declined')])).toBe('declined');
    expect(defaultEndReason('ended', [caller('left'), callee('left')])).toBe('hangup');
  });
});

describe('timing helpers', () => {
  it('expires rings after the timeout', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(isRingExpired(new Date(now.getTime() - RING_TIMEOUT_MS + 1000), now)).toBe(false);
    expect(isRingExpired(new Date(now.getTime() - RING_TIMEOUT_MS), now)).toBe(true);
  });

  it('measures duration from the answer, not the first ring', () => {
    expect(callDurationSec(new Date('2026-10-28T12:00:10Z'), new Date('2026-10-28T12:03:22Z'))).toBe(192);
    expect(callDurationSec(null, new Date())).toBe(0);
    expect(formatDuration(192)).toBe('3m 12s');
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(3720)).toBe('1h 2m');
  });

  it('classifies call history from my point of view', () => {
    expect(historyDirection({ startedById: 'a' }, { userId: 'a', joinedAt: new Date() })).toBe('outgoing');
    expect(historyDirection({ startedById: 'a' }, { userId: 'b', joinedAt: new Date() })).toBe('incoming');
    expect(historyDirection({ startedById: 'a' }, { userId: 'b', joinedAt: null })).toBe('missed');
  });
});
