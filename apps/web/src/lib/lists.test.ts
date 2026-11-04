import { describe, expect, it } from 'vitest';
import type { ListColumn, ListItemInfo } from '@teamsphere/shared';
import { applyView, cellText, lanes } from './lists';

const columns: ListColumn[] = [
  { id: 'title', name: 'Title', type: 'text' },
  { id: 'status', name: 'Status', type: 'choice', options: ['New', 'Done'] },
  { id: 'cost', name: 'Cost', type: 'number' },
  { id: 'owner', name: 'Owner', type: 'person' },
];
const people = new Map([['u1', { id: 'u1', displayName: 'Alex', avatarUrl: null }], ['u2', { id: 'u2', displayName: 'Priya', avatarUrl: null }]]);
const item = (id: string, values: ListItemInfo['values'], position = 0): ListItemInfo => ({ id, values, position, createdBy: null, updatedBy: null, createdAt: '', updatedAt: '' });
const items = [
  item('a', { title: 'Laptop', status: 'Done', cost: 900, owner: 'u2' }, 1),
  item('b', { title: 'Monitor', status: 'New', cost: 150 }, 2),
  item('c', { title: 'Dock', cost: 120, owner: 'u1' }, 3),
];
const ids = (list: ListItemInfo[]) => list.map((i) => i.id);

describe('applyView', () => {
  it('keeps position order without a sort', () => {
    expect(ids(applyView(items, columns, { filters: [], sort: null }, '', people))).toEqual(['a', 'b', 'c']);
  });

  it('sorts numbers and keeps empty values last', () => {
    expect(ids(applyView(items, columns, { filters: [], sort: { columnId: 'cost', dir: 'desc' } }, '', people))).toEqual(['a', 'b', 'c']);
    expect(ids(applyView(items, columns, { filters: [], sort: { columnId: 'status', dir: 'asc' } }, '', people))).toEqual(['b', 'a', 'c']);
    expect(ids(applyView(items, columns, { filters: [], sort: { columnId: 'owner', dir: 'asc' } }, '', people))).toEqual(['c', 'a', 'b']);
  });

  it('filters and searches, including person names', () => {
    expect(ids(applyView(items, columns, { filters: [{ columnId: 'status', value: 'New' }], sort: null }, '', people))).toEqual(['b']);
    expect(ids(applyView(items, columns, { filters: [{ columnId: 'title', value: 'mon' }], sort: null }, '', people))).toEqual(['b']);
    expect(ids(applyView(items, columns, { filters: [], sort: null }, 'priya', people))).toEqual(['a']);
  });
});

describe('cells and lanes', () => {
  it('formats cells for display', () => {
    expect(cellText(columns[3], 'u1', people)).toBe('Alex');
    expect(cellText({ id: 'b', name: 'B', type: 'boolean' }, false, people)).toBe('No');
    expect(cellText(columns[0], null, people)).toBe('');
  });

  it('groups items into choice lanes with a catch-all', () => {
    expect(lanes(items, columns[1]).map((l) => [l.label, ids(l.items)])).toEqual([['New', ['b']], ['Done', ['a']], ['No status', ['c']]]);
  });
});
