import type { FormAnswer, FormQuestion, ListColumn, QuestionSummary } from '@teamsphere/shared';

/** Pure rules for Lists and Forms, kept free of Prisma so they can be unit-tested. */

export type CellValue = string | number | boolean | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (v: string) => DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/**
 * Coerces one submitted cell to its column type. Returns `{ error }` for values that can't be stored, so the API
 * answers 400 instead of saving garbage. Empty values become null.
 */
export function normalizeCell(column: ListColumn, raw: unknown, people?: Set<string>): { value: CellValue } | { error: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  switch (column.type) {
    case 'text':
    case 'longtext': {
      const s = String(raw).slice(0, column.type === 'text' ? 500 : 10_000);
      return { value: s.trim() ? s : null };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) ? { value: n } : { error: `${column.name} must be a number` };
    }
    case 'choice': {
      const s = String(raw);
      return column.options?.includes(s) ? { value: s } : { error: `${column.name}: “${s}” isn’t one of the choices` };
    }
    case 'date': {
      const s = String(raw);
      return isRealDate(s) ? { value: s } : { error: `${column.name} must be a date (YYYY-MM-DD)` };
    }
    case 'person': {
      const s = String(raw);
      return !people || people.has(s) ? { value: s } : { error: `${column.name}: that person can’t be picked here` };
    }
    case 'boolean':
      return { value: raw === true || raw === 'true' };
    case 'link': {
      const s = String(raw).trim();
      return /^(https?:\/\/|mailto:)/i.test(s) && s.length <= 2000 ? { value: s } : { error: `${column.name} must be a web or mail link` };
    }
  }
}

/** Normalizes a whole row against the columns; unknown keys are dropped. */
export function normalizeRow(columns: ListColumn[], raw: Record<string, unknown>, people?: Set<string>): { values: Record<string, CellValue> } | { error: string } {
  const values: Record<string, CellValue> = {};
  for (const column of columns) {
    const r = normalizeCell(column, raw[column.id], people);
    if ('error' in r) return r;
    if (column.required && (r.value === null || r.value === false)) return { error: `${column.name} is required` };
    if (r.value !== null) values[column.id] = r.value;
  }
  return { values };
}

/** Column sets must have unique ids and choice columns need options. */
export function checkColumns(columns: ListColumn[]): string | null {
  const ids = new Set<string>();
  for (const c of columns) {
    if (ids.has(c.id)) return `Duplicate column id “${c.id}”`;
    ids.add(c.id);
    if (c.type === 'choice' && !c.options?.length) return `Add choices to “${c.name}”`;
  }
  return null;
}

/** Keeps only values whose column still exists and still accepts them (after columns were edited). */
export function pruneValues(columns: ListColumn[], values: Record<string, CellValue>): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of columns) {
    if (!(c.id in values)) continue;
    const r = normalizeCell(c, values[c.id]);
    if ('value' in r && r.value !== null) out[c.id] = r.value;
  }
  return out;
}

/** CSV cell: quoted when needed, and formula-looking values defused so spreadsheets don't execute them. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- forms

/** Whether a form takes responses right now. */
export function accepting(form: { status: string; closesAt: Date | null }, now = new Date()): boolean {
  return form.status === 'open' && (!form.closesAt || form.closesAt > now);
}

/** Validates and normalizes a submission. Unknown question ids are dropped. */
export function validateAnswers(questions: FormQuestion[], raw: Record<string, unknown>): { answers: Record<string, FormAnswer> } | { error: string } {
  const answers: Record<string, FormAnswer> = {};
  for (const q of questions) {
    const v = raw[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required) return { error: `“${q.title}” needs an answer` };
      continue;
    }
    switch (q.type) {
      case 'text':
      case 'longtext': {
        const s = String(v).slice(0, q.type === 'text' ? 1000 : 10_000).trim();
        if (!s && q.required) return { error: `“${q.title}” needs an answer` };
        if (s) answers[q.id] = s;
        break;
      }
      case 'choice':
        if (!q.options?.includes(String(v))) return { error: `“${q.title}”: pick one of the options` };
        answers[q.id] = String(v);
        break;
      case 'multichoice': {
        const picked = (Array.isArray(v) ? v : [v]).map(String);
        if (picked.some((p) => !q.options?.includes(p))) return { error: `“${q.title}”: pick from the options` };
        answers[q.id] = [...new Set(picked)];
        break;
      }
      case 'rating': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > (q.scale ?? 5)) return { error: `“${q.title}”: choose 1–${q.scale ?? 5}` };
        answers[q.id] = n;
        break;
      }
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) return { error: `“${q.title}” must be a number` };
        answers[q.id] = n;
        break;
      }
      case 'date':
        if (!isRealDate(String(v))) return { error: `“${q.title}” must be a date` };
        answers[q.id] = String(v);
        break;
    }
  }
  return { answers };
}

/** Per-question summary of all responses (newest first for text answers). */
export function summarize(questions: FormQuestion[], responses: { answers: Record<string, FormAnswer> }[]): QuestionSummary[] {
  return questions.map((q): QuestionSummary => {
    const given = responses.map((r) => r.answers[q.id]).filter((a) => a !== undefined);
    switch (q.type) {
      case 'choice':
      case 'multichoice': {
        const counts = new Map((q.options ?? []).map((o) => [o, 0]));
        for (const a of given) for (const o of Array.isArray(a) ? a : [String(a)]) if (counts.has(o)) counts.set(o, counts.get(o)! + 1);
        return { questionId: q.id, type: q.type, answered: given.length, counts: [...counts].map(([option, count]) => ({ option, count })) };
      }
      case 'rating':
      case 'number': {
        const nums = given.map(Number).filter(Number.isFinite);
        const dist = new Map<number, number>();
        if (q.type === 'rating') for (let i = 1; i <= (q.scale ?? 5); i++) dist.set(i, 0);
        for (const n of nums) dist.set(n, (dist.get(n) ?? 0) + 1);
        return {
          questionId: q.id,
          type: q.type,
          answered: nums.length,
          average: nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null,
          min: nums.length ? Math.min(...nums) : null,
          max: nums.length ? Math.max(...nums) : null,
          distribution: q.type === 'rating' ? [...dist].map(([value, count]) => ({ value, count })) : [],
        };
      }
      default:
        return { questionId: q.id, type: q.type, answered: given.length, latest: given.slice(-20).reverse().map(String) };
    }
  });
}
