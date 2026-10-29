import { describe, expect, it } from 'vitest';
import { computePresence } from './presence.service';

const base = {
  id: 'u1',
  presenceStatus: null,
  presenceExpiresAt: null,
  statusMessage: null,
  statusExpiresAt: null,
  oooEnabled: false,
  oooMessage: null,
  oooStartAt: null,
  oooEndAt: null,
};
const now = new Date('2026-10-28T12:00:00Z');
const hour = 60 * 60 * 1000;

describe('computePresence', () => {
  it('is available while connected and offline otherwise', () => {
    expect(computePresence(base, true, now).status).toBe('available');
    expect(computePresence(base, false, now).status).toBe('offline');
  });

  it('applies a manual status until it expires', () => {
    const busy = { ...base, presenceStatus: 'busy', presenceExpiresAt: new Date(now.getTime() + hour) };
    expect(computePresence(busy, true, now)).toMatchObject({ status: 'busy', presenceExpiresAt: busy.presenceExpiresAt.toISOString() });
    expect(computePresence(busy, true, new Date(now.getTime() + 2 * hour))).toMatchObject({ status: 'available', presenceExpiresAt: null });
  });

  it('hides an expired status message', () => {
    const msg = { ...base, statusMessage: 'At lunch', statusExpiresAt: new Date(now.getTime() - 1) };
    expect(computePresence(msg, true, now).statusMessage).toBeNull();
  });

  it('shows out of office within its window, even when online or busy', () => {
    const ooo = {
      ...base,
      presenceStatus: 'busy',
      oooEnabled: true,
      oooMessage: 'Back Monday',
      oooStartAt: new Date(now.getTime() - hour),
      oooEndAt: new Date(now.getTime() + hour),
    };
    expect(computePresence(ooo, true, now)).toMatchObject({
      status: 'ooo',
      outOfOffice: { message: 'Back Monday', until: ooo.oooEndAt.toISOString() },
    });
    expect(computePresence(ooo, false, now).status).toBe('ooo');
    expect(computePresence(ooo, true, new Date(now.getTime() + 2 * hour))).toMatchObject({ status: 'busy', outOfOffice: null });
    expect(computePresence({ ...ooo, oooStartAt: new Date(now.getTime() + hour) }, true, now).status).toBe('busy');
  });

  it('keeps "Appear offline" over out of office', () => {
    const hidden = { ...base, presenceStatus: 'offline', oooEnabled: true };
    expect(computePresence(hidden, true, now).status).toBe('offline');
  });
});

const user = (presenceStatus: string | null = null) => ({ ...base, presenceStatus });

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
