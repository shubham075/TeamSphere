import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands';

describe('parseCommand', () => {
  it('treats plain text as a search', () => {
    expect(parseCommand('  budget report ')).toEqual({ kind: 'search', q: 'budget report' });
  });

  it('runs commands without arguments right away', () => {
    const p = parseCommand('/busy');
    expect(p.kind === 'command' && p.command.name).toBe('busy');
    expect(parseCommand('/DND').kind).toBe('command');
  });

  it('resolves aliases', () => {
    const p = parseCommand('/shortcuts');
    expect(p.kind === 'command' && p.command.name).toBe('keys');
  });

  it('waits for an argument on /call, /chat and /goto', () => {
    expect(parseCommand('/call')).toMatchObject({ kind: 'partial', matches: [{ name: 'call' }] });
    expect(parseCommand('/call ')).toMatchObject({ kind: 'partial' });
    const p = parseCommand('/call  Priya Sharma ');
    expect(p).toMatchObject({ kind: 'command', command: { name: 'call' }, arg: 'Priya Sharma' });
  });

  it('lists matching commands for a prefix', () => {
    const p = parseCommand('/a');
    expect(p.kind).toBe('partial');
    if (p.kind === 'partial') expect(p.matches.map((c) => c.name)).toEqual(['available', 'away', 'activity']);
    expect(parseCommand('/')).toMatchObject({ kind: 'partial', prefix: '' });
  });

  it('hides admin commands from non-admins', () => {
    expect(parseCommand('/admin').kind).toBe('partial');
    expect(parseCommand('/admin', { isAdmin: true }).kind).toBe('command');
  });

  it('returns no matches for unknown commands', () => {
    expect(parseCommand('/frobnicate')).toMatchObject({ kind: 'partial', matches: [] });
  });
});
