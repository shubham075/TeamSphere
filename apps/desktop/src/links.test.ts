import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './links';

describe('parseDeepLink', () => {
  it('maps app sections to in-app paths', () => {
    expect(parseDeepLink('teamsphere://chat/abc123')).toEqual({ kind: 'navigate', path: '/chat/abc123' });
    expect(parseDeepLink('teamsphere://teams/c/ch1')).toEqual({ kind: 'navigate', path: '/teams/c/ch1' });
    expect(parseDeepLink('teamsphere://activity')).toEqual({ kind: 'navigate', path: '/activity' });
  });

  it('parses call toast buttons', () => {
    expect(parseDeepLink('teamsphere://call/accept?id=c1')).toEqual({ kind: 'call', callId: 'c1', action: 'accept' });
    expect(parseDeepLink('teamsphere://call/accept-audio?id=c1')).toEqual({ kind: 'call', callId: 'c1', action: 'accept-audio' });
    expect(parseDeepLink('teamsphere://call/decline?id=c1')).toEqual({ kind: 'call', callId: 'c1', action: 'decline' });
  });

  it('opens (never answers) a plain call link', () => {
    expect(parseDeepLink('teamsphere://call/cmabc')).toEqual({ kind: 'call', callId: 'cmabc', action: 'open' });
  });

  it('rejects unknown, unsafe or malformed links', () => {
    expect(parseDeepLink('https://chat/abc')).toBeNull();
    expect(parseDeepLink('teamsphere://settings/x')).toBeNull();
    expect(parseDeepLink('teamsphere://chat/a%2F..%2Fb')).toBeNull();
    expect(parseDeepLink('teamsphere://chat/%E0%A4%A')).toBeNull();
    expect(parseDeepLink('teamsphere://call/accept')).toBeNull();
    expect(parseDeepLink('teamsphere://call/hack?id=c1')).toBeNull();
    expect(parseDeepLink('teamsphere://call/accept?id=a%20b')).toBeNull();
    expect(parseDeepLink('teamsphere://chat/a/b/c/d')).toBeNull();
  });
});
