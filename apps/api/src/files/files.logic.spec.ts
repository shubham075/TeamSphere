import { describe, expect, it } from 'vitest';
import {
  AccessNode, can, effectiveRole, nextVersion, personalLibraryRole, planRestore, planUpload, purgeCutoff, uniqueName,
} from './files.logic';

const OWNER = 'u-owner';
const ALICE = 'u-alice';
const BOB = 'u-bob';

const node = (id: string, extra: Partial<AccessNode> = {}): AccessNode => ({ id, shares: [], links: [], ...extra });

function roleOf(userId: string, chain: AccessNode[], presentedLink?: Parameters<typeof effectiveRole>[0]['presentedLink']) {
  return effectiveRole({ userId, libraryRole: personalLibraryRole(userId, 'user', OWNER), chain, presentedLink });
}

describe('file permissions', () => {
  it('gives the library owner full control and strangers nothing', () => {
    const chain = [node('file')];
    expect(roleOf(OWNER, chain)).toBe('owner');
    expect(roleOf(ALICE, chain)).toBeNull();
    expect(can(roleOf(OWNER, chain), 'purge')).toBe(true);
    expect(can(roleOf(ALICE, chain), 'read')).toBe(false);
  });

  it('lets a view share read but not write or share', () => {
    const chain = [node('file', { shares: [{ userId: ALICE, role: 'view' }] })];
    const role = roleOf(ALICE, chain);
    expect(role).toBe('view');
    expect(can(role, 'read')).toBe(true);
    expect(can(role, 'write')).toBe(false);
    expect(can(role, 'share')).toBe(false);
    expect(roleOf(BOB, chain)).toBeNull();
  });

  it('lets an edit share write and share, but never purge the owner’s recycle bin', () => {
    const role = roleOf(ALICE, [node('file', { shares: [{ userId: ALICE, role: 'edit' }] })]);
    expect(role).toBe('edit');
    expect(can(role, 'write')).toBe(true);
    expect(can(role, 'share')).toBe(true);
    expect(can(role, 'purge')).toBe(false);
  });

  it('inherits shares from parent folders and keeps the strongest grant', () => {
    const chain = [
      node('file', { shares: [{ userId: ALICE, role: 'view' }] }),
      node('folder', { shares: [{ userId: ALICE, role: 'edit' }] }),
    ];
    expect(roleOf(ALICE, chain)).toBe('edit');
  });

  it('grants org-link access only to people who opened an active link', () => {
    const link = { role: 'view' as const, revokedAt: null, usedBy: [ALICE] };
    const chain = [node('file'), node('folder', { links: [link] })];
    expect(roleOf(ALICE, chain)).toBe('view');
    expect(roleOf(BOB, chain)).toBeNull();
    // Bob opening the link for the first time.
    expect(roleOf(BOB, chain, { role: 'view', revokedAt: null, itemIdOnChain: 'folder' })).toBe('view');
    // A link for some other item doesn't apply here.
    expect(roleOf(BOB, chain, { role: 'edit', revokedAt: null, itemIdOnChain: 'elsewhere' })).toBeNull();
  });

  it('stops granting access once a link is revoked', () => {
    const revokedAt = new Date();
    const chain = [node('file', { links: [{ role: 'edit', revokedAt, usedBy: [ALICE] }] })];
    expect(roleOf(ALICE, chain)).toBeNull();
    expect(roleOf(BOB, chain, { role: 'edit', revokedAt, itemIdOnChain: 'file' })).toBeNull();
  });

  it('treats team and channel libraries as not personal', () => {
    expect(personalLibraryRole(OWNER, 'team', OWNER)).toBeNull();
    expect(personalLibraryRole(OWNER, 'user', OWNER)).toBe('owner');
  });
});

describe('file versions', () => {
  it('turns a same-name upload into a new version, and refuses to overwrite a folder', () => {
    expect(planUpload(null)).toBe('create');
    expect(planUpload({ kind: 'file' })).toBe('new-version');
    expect(planUpload({ kind: 'folder' })).toBe('conflict');
  });

  it('numbers versions after the highest existing one', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4);
  });

  it('restores an old version as a new latest version and ignores the current one', () => {
    const versions = [
      { id: 'a', version: 1 },
      { id: 'b', version: 2 },
      { id: 'c', version: 3 },
    ];
    expect(planRestore(versions, 'a')).toEqual({ from: 1, version: 4 });
    expect(planRestore(versions, 'c')).toBeNull();
    expect(() => planRestore(versions, 'zzz')).toThrow();
  });
});

describe('helpers', () => {
  it('picks a free name case-insensitively and keeps the extension', () => {
    expect(uniqueName('Report.pdf', [])).toBe('Report.pdf');
    expect(uniqueName('Report.pdf', ['report.PDF'])).toBe('Report (1).pdf');
    expect(uniqueName('Report.pdf', ['Report.pdf', 'Report (1).pdf'])).toBe('Report (2).pdf');
    expect(uniqueName('Notes', ['notes'])).toBe('Notes (1)');
    expect(uniqueName('.env', ['.env'])).toBe('.env (1)');
  });

  it('purges items deleted more than 93 days ago', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    expect(purgeCutoff(now).toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
});
