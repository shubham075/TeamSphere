import { describe, expect, it } from 'vitest';
import { combineRestrictive, normalizeSettings, resolvePolicies, uploadLimitBytes } from './policies.logic';
import { csvCell } from './admin.service';

describe('normalizeSettings', () => {
  it('fills defaults and drops unknown keys', () => {
    expect(normalizeSettings('messaging', { allowEdit: false, bogus: 1 })).toEqual({
      allowEdit: false,
      allowDelete: true,
      allowUrgent: true,
      linkPreviews: true,
    });
  });

  it('keeps valid keys of a partly broken row', () => {
    expect(normalizeSettings('calling', { allowCalls: 'nope', allowVideo: false })).toEqual({ allowCalls: true, allowVideo: false });
  });
});

describe('combineRestrictive', () => {
  it('turns a feature off if any team policy does, and picks the strictest lobby', () => {
    const a = normalizeSettings('meeting', { allowRecording: true, lobbyDefault: 'everyone' });
    const b = normalizeSettings('meeting', { allowRecording: false, lobbyDefault: 'invited' });
    expect(combineRestrictive('meeting', [a, b])).toEqual({ allowRecording: false, lobbyDefault: 'invited' });
    const c = normalizeSettings('meeting', { lobbyDefault: 'organizers' });
    expect(combineRestrictive('meeting', [a, c]).lobbyDefault).toBe('organizers');
  });
});

describe('resolvePolicies', () => {
  const base = { type: 'messaging', settings: {} };

  it('falls back to built-in defaults (everything allowed)', () => {
    const { effective, sources } = resolvePolicies([]);
    expect(effective.messaging.allowEdit).toBe(true);
    expect(effective.apps).toEqual({ files: true, meetings: true, calls: true });
    expect(sources.every((s) => s.via === 'builtin')).toBe(true);
  });

  it('applies the org default when nothing else is assigned', () => {
    const { effective, sources } = resolvePolicies([{ ...base, id: 'd', name: 'Org', via: 'default', settings: { allowUrgent: false } }]);
    expect(effective.messaging.allowUrgent).toBe(false);
    expect(sources.find((s) => s.type === 'messaging')).toMatchObject({ via: 'default', policyId: 'd' });
  });

  it('a direct user assignment beats team policies and the default', () => {
    const { effective, sources } = resolvePolicies([
      { ...base, id: 'd', name: 'Org', via: 'default', settings: { allowEdit: false } },
      { ...base, id: 't', name: 'Team', via: 'team', settings: { allowEdit: false } },
      { ...base, id: 'u', name: 'Person', via: 'user', settings: { allowEdit: true } },
    ]);
    expect(effective.messaging.allowEdit).toBe(true);
    expect(sources.find((s) => s.type === 'messaging')?.via).toBe('user');
  });

  it('team policies beat the default and combine restrictively', () => {
    const { effective } = resolvePolicies([
      { ...base, id: 'd', name: 'Org', via: 'default', settings: { allowDelete: false } },
      { ...base, id: 't1', name: 'A', via: 'team', settings: { allowUrgent: false } },
      { ...base, id: 't2', name: 'B', via: 'team', settings: { linkPreviews: false } },
    ]);
    expect(effective.messaging).toEqual({ allowEdit: true, allowDelete: true, allowUrgent: false, linkPreviews: false });
  });

  it('resolves each type independently', () => {
    const { effective } = resolvePolicies([
      { id: 'c', type: 'calling', name: 'No video', via: 'user', settings: { allowVideo: false } },
      { id: 'a', type: 'apps', name: 'No files', via: 'default', settings: { files: false } },
    ]);
    expect(effective.calling).toEqual({ allowCalls: true, allowVideo: false });
    expect(effective.apps.files).toBe(false);
    expect(effective.messaging.allowEdit).toBe(true);
  });
});

describe('uploadLimitBytes', () => {
  it('never exceeds the endpoint hard limit', () => {
    expect(uploadLimitBytes(10, 100 * 1024 * 1024)).toBe(10 * 1024 * 1024);
    expect(uploadLimitBytes(250, 100 * 1024 * 1024)).toBe(100 * 1024 * 1024);
  });
});

describe('csvCell', () => {
  it('quotes and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
