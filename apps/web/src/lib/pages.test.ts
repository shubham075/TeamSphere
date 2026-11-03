import { describe, expect, it } from 'vitest';
import type { PageSummary } from '@teamsphere/shared';
import { buildTree } from './pages';

const page = (id: string, parentId: string | null, position: number, title = id): PageSummary => ({
  id, title, icon: null, parentId, rootId: 'r', position, excerpt: '', updatedAt: '', updatedBy: null,
});

describe('buildTree', () => {
  it('nests pages under their parents in position order', () => {
    const tree = buildTree([page('b', 'a', 2), page('a', null, 1), page('c', 'a', 1), page('d', null, 0)]);
    expect(tree.map((n) => n.id)).toEqual(['d', 'a']);
    expect(tree[1].children.map((n) => n.id)).toEqual(['c', 'b']);
  });

  it('treats pages whose parent is missing as roots', () => {
    expect(buildTree([page('x', 'gone', 1)]).map((n) => n.id)).toEqual(['x']);
  });
});
