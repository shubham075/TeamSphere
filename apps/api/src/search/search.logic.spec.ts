import { describe, expect, it } from 'vitest';
import { likePattern, messageVisible, searchTerms, stripMentionMarkup, toTsQuery } from './search.logic';

describe('toTsQuery', () => {
  it('ANDs prefix terms', () => {
    expect(toTsQuery('Budget Q3')).toBe('budget:* & q3:*');
  });

  it('strips tsquery operators and punctuation so input cannot break the query', () => {
    expect(toTsQuery("a & b | !c <-> 'd':*")).toBe('a:* & b:* & c:* & d:*');
    expect(toTsQuery('  ):(  ')).toBeNull();
  });

  it('keeps non-ASCII words and caps the term count', () => {
    expect(searchTerms('Résumé Müller')).toEqual(['résumé', 'müller']);
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('likePattern', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern(' 50%_off\\ ')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('messageVisible', () => {
  const at = new Date('2026-10-01T10:00:00Z');
  const msg = { deletedAt: null, type: 'text', createdAt: at };

  it('requires membership', () => {
    expect(messageVisible({ message: msg, membership: null, channel: null })).toBe(false);
    expect(messageVisible({ message: msg, membership: { historySince: null }, channel: null })).toBe(true);
  });

  it('hides messages from before the member was added without history', () => {
    expect(messageVisible({ message: msg, membership: { historySince: new Date('2026-10-02T00:00:00Z') }, channel: null })).toBe(false);
    expect(messageVisible({ message: msg, membership: { historySince: new Date('2026-09-30T00:00:00Z') }, channel: null })).toBe(true);
  });

  it('hides deleted and system messages', () => {
    expect(messageVisible({ message: { ...msg, deletedAt: at }, membership: { historySince: null }, channel: null })).toBe(false);
    expect(messageVisible({ message: { ...msg, type: 'system' }, membership: { historySince: null }, channel: null })).toBe(false);
  });

  it('hides posts of deleted channels and teams', () => {
    const member = { historySince: null };
    expect(messageVisible({ message: msg, membership: member, channel: { deletedAt: null, teamDeletedAt: null } })).toBe(true);
    expect(messageVisible({ message: msg, membership: member, channel: { deletedAt: at, teamDeletedAt: null } })).toBe(false);
    expect(messageVisible({ message: msg, membership: member, channel: { deletedAt: null, teamDeletedAt: at } })).toBe(false);
  });
});

describe('stripMentionMarkup', () => {
  it('shows mentions as @Name', () => {
    expect(stripMentionMarkup('hi @[Priya Sharma](cku1) and @[Ops](tag:x)')).toBe('hi @Priya Sharma and @Ops');
  });
});
