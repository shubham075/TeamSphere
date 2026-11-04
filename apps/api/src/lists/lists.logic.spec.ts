import { describe, expect, it } from 'vitest';
import type { FormQuestion, ListColumn } from '@teamsphere/shared';
import { accepting, checkColumns, csvCell, normalizeCell, normalizeRow, pruneValues, summarize, validateAnswers } from './lists.logic';

const col = (c: Partial<ListColumn> & Pick<ListColumn, 'type'>): ListColumn => ({ id: c.type, name: c.type, ...c });

describe('list cells', () => {
  it('coerces values to their column type', () => {
    expect(normalizeCell(col({ type: 'number' }), '42.5')).toEqual({ value: 42.5 });
    expect(normalizeCell(col({ type: 'boolean' }), 'true')).toEqual({ value: true });
    expect(normalizeCell(col({ type: 'date' }), '2026-11-04')).toEqual({ value: '2026-11-04' });
    expect(normalizeCell(col({ type: 'text' }), '')).toEqual({ value: null });
  });

  it('rejects values that do not fit', () => {
    expect(normalizeCell(col({ type: 'number' }), 'abc')).toHaveProperty('error');
    expect(normalizeCell(col({ type: 'choice', options: ['A'] }), 'B')).toHaveProperty('error');
    expect(normalizeCell(col({ type: 'date' }), '2026-02-30')).toHaveProperty('error');
    expect(normalizeCell(col({ type: 'link' }), 'javascript:alert(1)')).toHaveProperty('error');
    expect(normalizeCell(col({ type: 'person' }), 'u-x', new Set(['u-a']))).toHaveProperty('error');
  });

  it('enforces required columns and drops unknown keys', () => {
    const columns = [col({ id: 'title', name: 'Title', type: 'text', required: true }), col({ type: 'number' })];
    expect(normalizeRow(columns, { number: 3 })).toEqual({ error: 'Title is required' });
    expect(normalizeRow(columns, { title: 'Laptop', number: '3', junk: 1 })).toEqual({ values: { title: 'Laptop', number: 3 } });
  });

  it('validates column sets', () => {
    expect(checkColumns([col({ type: 'text' }), col({ type: 'text' })])).toMatch(/Duplicate/);
    expect(checkColumns([col({ type: 'choice' })])).toMatch(/choices/);
    expect(checkColumns([col({ type: 'choice', options: ['A'] })])).toBeNull();
  });

  it('prunes values after columns change', () => {
    const columns = [col({ id: 'status', name: 'Status', type: 'choice', options: ['Open'] })];
    expect(pruneValues(columns, { status: 'Done', gone: 'x' })).toEqual({});
    expect(pruneValues(columns, { status: 'Open' })).toEqual({ status: 'Open' });
  });

  it('defuses formulas in CSV', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(['x', 'y'])).toBe('x; y');
  });
});

describe('forms', () => {
  const questions: FormQuestion[] = [
    { id: 'name', type: 'text', title: 'Name', required: true },
    { id: 'team', type: 'choice', title: 'Team', required: false, options: ['Ops', 'Dev'] },
    { id: 'tools', type: 'multichoice', title: 'Tools', required: false, options: ['A', 'B', 'C'] },
    { id: 'score', type: 'rating', title: 'Score', required: false, scale: 5 },
  ];

  it('accepts only while open and before the close date', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    expect(accepting({ status: 'open', closesAt: null }, now)).toBe(true);
    expect(accepting({ status: 'open', closesAt: new Date('2026-11-04T09:00:00Z') }, now)).toBe(false);
    expect(accepting({ status: 'draft', closesAt: null }, now)).toBe(false);
  });

  it('validates answers', () => {
    expect(validateAnswers(questions, {})).toEqual({ error: '“Name” needs an answer' });
    expect(validateAnswers(questions, { name: 'A', team: 'QA' })).toHaveProperty('error');
    expect(validateAnswers(questions, { name: 'A', score: 6 })).toHaveProperty('error');
    expect(validateAnswers(questions, { name: ' Ana ', tools: ['A', 'A', 'C'], score: '4', extra: 1 })).toEqual({ answers: { name: 'Ana', tools: ['A', 'C'], score: 4 } });
  });

  it('summarizes responses per question', () => {
    const summary = summarize(questions, [
      { answers: { name: 'A', team: 'Ops', tools: ['A', 'B'], score: 4 } },
      { answers: { name: 'B', team: 'Ops', tools: ['B'], score: 2 } },
      { answers: { name: 'C' } },
    ]);
    expect(summary[0]).toMatchObject({ answered: 3, latest: ['C', 'B', 'A'] });
    expect(summary[1]).toMatchObject({ answered: 2, counts: [{ option: 'Ops', count: 2 }, { option: 'Dev', count: 0 }] });
    expect(summary[2]).toMatchObject({ counts: [{ option: 'A', count: 1 }, { option: 'B', count: 2 }, { option: 'C', count: 0 }] });
    expect(summary[3]).toMatchObject({ answered: 2, average: 3, min: 2, max: 4 });
  });
});
