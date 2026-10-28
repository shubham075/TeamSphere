import { describe, expect, it } from 'vitest';
import { computePresence } from './presence.service';

const user = (presenceStatus: string | null = null) => ({
  id: 'u1',
  presenceStatus,
  presenceExpiresAt: null,
  statusMessage: null,
  statusExpiresAt: null,
});

describe('computePresence in calls', () => {
  it('shows "In a call" over automatic and manual statuses', () => {
    expect(computePresence(user(), true, new Date(), true).status).toBe('in_call');
    expect(computePresence(user('busy'), true, new Date(), true).status).toBe('in_call');
  });

  it('keeps Do not disturb and Appear offline while in a call', () => {
    expect(computePresence(user('dnd'), true, new Date(), true).status).toBe('dnd');
    expect(computePresence(user('offline'), true, new Date(), true).status).toBe('offline');
  });

  it('falls back to the normal status after the call', () => {
    expect(computePresence(user(), true, new Date(), false).status).toBe('available');
  });
});
