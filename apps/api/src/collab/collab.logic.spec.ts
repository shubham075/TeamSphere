import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canEdit, collabRole, excerpt, fragmentText, pathTo, wouldCycle } from './collab.logic';

const OWNER = 'u-owner';
const ALICE = 'u-alice';

describe('collab roles', () => {
  it('lets the owner manage a personal item and members edit it', () => {
    const base = { ownerType: 'user' as const, ownerId: OWNER, memberIds: [ALICE] };
    expect(collabRole({ ...base, userId: OWNER })).toBe('owner');
    expect(collabRole({ ...base, userId: ALICE })).toBe('edit');
    expect(collabRole({ ...base, userId: 'u-x' })).toBeNull();
  });

  it('follows the channel role and meeting access', () => {
    expect(collabRole({ userId: ALICE, ownerType: 'channel', ownerId: 'c', memberIds: [], channelRole: 'view' })).toBe('view');
    expect(collabRole({ userId: ALICE, ownerType: 'meeting', ownerId: 'm', memberIds: [], meeting: { allowed: true, moderator: false } })).toBe('edit');
    expect(collabRole({ userId: ALICE, ownerType: 'meeting', ownerId: 'm', memberIds: [], meeting: { allowed: true, moderator: true } })).toBe('owner');
    expect(collabRole({ userId: ALICE, ownerType: 'meeting', ownerId: 'm', memberIds: [], meeting: null })).toBeNull();
    expect(canEdit('view')).toBe(false);
    expect(canEdit('edit')).toBe(true);
  });
});

describe('page text', () => {
  it('extracts plain text from a Tiptap Yjs fragment', () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment('default');
    const heading = new Y.XmlElement('heading');
    heading.insert(0, [new Y.XmlText('Agenda')]);
    const para = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'Budget ');
    text.insert(7, 'review', { bold: true });
    text.insert(13, ' & <plans>');
    para.insert(0, [text]);
    frag.insert(0, [heading, para]);
    expect(fragmentText(frag)).toBe('Agenda\nBudget review & <plans>');
  });

  it('shortens excerpts on one line', () => {
    expect(excerpt('a\n\nb')).toBe('a b');
    expect(excerpt('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('page tree', () => {
  const parentOf = new Map<string, string | null>([['root', null], ['a', 'root'], ['b', 'a']]);
  it('refuses moves under itself or its subpages', () => {
    expect(wouldCycle('a', 'b', parentOf)).toBe(true);
    expect(wouldCycle('a', 'a', parentOf)).toBe(true);
    expect(wouldCycle('b', 'root', parentOf)).toBe(false);
  });

  it('builds breadcrumbs from the root', () => {
    const byId = new Map([['root', { id: 'root', parentId: null }], ['a', { id: 'a', parentId: 'root' }], ['b', { id: 'b', parentId: 'a' }]]);
    expect(pathTo('b', byId).map((p) => p.id)).toEqual(['root', 'a', 'b']);
  });
});
