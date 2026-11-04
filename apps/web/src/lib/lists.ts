import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CollabPerson, CreateFormInput, CreateListInput, FormDetail, FormQuestion, FormResults, FormSummary, ListColumn, ListDetail,
  ListItemInfo, ListSummary, ListView, ListWithItems, UpdateFormInput, UpdateListInput,
} from '@teamsphere/shared';
import { api, ApiError } from './api';
import { useAuth } from './auth-store';

// ------------------------------------------------------------------ pure helpers (unit-tested)

export type Cell = string | number | boolean | null | undefined;

/** Short random id for new columns, questions and views. */
export const newId = () => Math.random().toString(36).slice(2, 10);

/** Display text for a cell (person ids resolve to names). */
export function cellText(column: ListColumn, value: Cell, people: Map<string, CollabPerson>): string {
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'person') return people.get(String(value))?.displayName ?? 'Unknown person';
  if (column.type === 'boolean') return value ? 'Yes' : 'No';
  if (column.type === 'date') return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'medium' });
  return String(value);
}

/** Applies a view's filters and sort plus a free-text search to items. */
export function applyView(items: ListItemInfo[], columns: ListColumn[], view: Pick<ListView, 'filters' | 'sort'>, search: string, people: Map<string, CollabPerson>): ListItemInfo[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const q = search.trim().toLowerCase();
  let out = items.filter((item) =>
    view.filters.every((f) => {
      const column = byId.get(f.columnId);
      if (!column || f.value === '') return true;
      const v = item.values[f.columnId];
      if (column.type === 'text' || column.type === 'longtext' || column.type === 'link') return String(v ?? '').toLowerCase().includes(f.value.toLowerCase());
      if (column.type === 'boolean') return String(!!v) === f.value;
      return String(v ?? '') === f.value;
    }),
  );
  if (q) out = out.filter((item) => columns.some((c) => cellText(c, item.values[c.id], people).toLowerCase().includes(q)));
  const sort = view.sort && byId.get(view.sort.columnId);
  if (sort && view.sort) {
    const dir = view.sort.dir === 'asc' ? 1 : -1;
    const key = (i: ListItemInfo) => {
      const v = i.values[sort.id];
      if (v === null || v === undefined || v === '') return null;
      if (sort.type === 'person') return people.get(String(v))?.displayName ?? '';
      if (sort.type === 'choice') return sort.options?.indexOf(String(v)) ?? 0;
      return v;
    };
    out = [...out].sort((a, b) => {
      const ka = key(a), kb = key(b);
      // Empty values always last, whatever the direction.
      if (ka === null) return kb === null ? 0 : 1;
      if (kb === null) return -1;
      if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir;
      return String(ka).localeCompare(String(kb), undefined, { numeric: true }) * dir;
    });
  } else {
    out = [...out].sort((a, b) => a.position - b.position);
  }
  return out;
}

/** Board lanes for a choice column: one per option, then "No value". */
export function lanes(items: ListItemInfo[], column: ListColumn): { value: string | null; label: string; items: ListItemInfo[] }[] {
  const options = column.options ?? [];
  return [
    ...options.map((o) => ({ value: o, label: o, items: items.filter((i) => i.values[column.id] === o) })),
    { value: null, label: `No ${column.name.toLowerCase()}`, items: items.filter((i) => !options.includes(String(i.values[column.id] ?? ''))) },
  ];
}

export interface ListTemplate {
  id: string;
  name: string;
  description: string;
  columns: ListColumn[];
  items?: Record<string, Cell>[];
}

export const LIST_TEMPLATES: ListTemplate[] = [
  { id: 'blank', name: 'Blank list', description: 'Start with a Title column and add your own.', columns: [{ id: 'title', name: 'Title', type: 'text', required: true }] },
  {
    id: 'issues',
    name: 'Issue tracker',
    description: 'Track issues with priority, status and an owner.',
    columns: [
      { id: 'title', name: 'Issue', type: 'text', required: true },
      { id: 'priority', name: 'Priority', type: 'choice', options: ['High', 'Medium', 'Low'] },
      { id: 'status', name: 'Status', type: 'choice', options: ['New', 'In progress', 'Blocked', 'Done'] },
      { id: 'owner', name: 'Assigned to', type: 'person' },
      { id: 'due', name: 'Due', type: 'date' },
      { id: 'details', name: 'Details', type: 'longtext' },
    ],
  },
  {
    id: 'assets',
    name: 'Asset manager',
    description: 'Keep track of equipment and who has it.',
    columns: [
      { id: 'title', name: 'Asset', type: 'text', required: true },
      { id: 'type', name: 'Type', type: 'choice', options: ['Laptop', 'Monitor', 'Phone', 'Other'] },
      { id: 'serial', name: 'Serial number', type: 'text' },
      { id: 'holder', name: 'Checked out to', type: 'person' },
      { id: 'cost', name: 'Cost', type: 'number' },
      { id: 'returned', name: 'Returned', type: 'boolean' },
    ],
  },
  {
    id: 'events',
    name: 'Event itinerary',
    description: 'Plan sessions with dates, locations and links.',
    columns: [
      { id: 'title', name: 'Session', type: 'text', required: true },
      { id: 'date', name: 'Date', type: 'date' },
      { id: 'location', name: 'Location', type: 'text' },
      { id: 'host', name: 'Host', type: 'person' },
      { id: 'link', name: 'Link', type: 'link' },
    ],
  },
];

export const QUESTION_LABEL: Record<FormQuestion['type'], string> = {
  text: 'Short answer', longtext: 'Long answer', choice: 'Choice', multichoice: 'Multiple choice', rating: 'Rating', number: 'Number', date: 'Date',
};

// ------------------------------------------------------------------ queries

export const lk = {
  lists: ['lists'] as const,
  list: (id: string) => ['lists', id] as const,
  forms: ['forms'] as const,
  form: (id: string) => ['forms', id] as const,
  results: (id: string) => ['forms', id, 'results'] as const,
};

export const useLists = () => useQuery({ queryKey: lk.lists, queryFn: () => api<ListSummary[]>('/lists') });
export const useList = (id: string | null) => useQuery({ queryKey: lk.list(id ?? ''), queryFn: () => api<ListWithItems>(`/lists/${id}`), enabled: !!id });
export const useForms = () => useQuery({ queryKey: lk.forms, queryFn: () => api<FormSummary[]>('/forms') });
export const useForm = (id: string | null) => useQuery({ queryKey: lk.form(id ?? ''), queryFn: () => api<FormDetail>(`/forms/${id}`), enabled: !!id, retry: false });
export const useFormResults = (id: string, enabled = true) => useQuery({ queryKey: lk.results(id), queryFn: () => api<FormResults>(`/forms/${id}/results`), enabled });

/** Mutation that refreshes Lists and Forms afterwards (realtime does the same for everyone else). */
export function useListsMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: lk.lists }), qc.invalidateQueries({ queryKey: lk.forms })]),
  });
}

export const listsApi = {
  create: (input: CreateListInput) => api<ListDetail>('/lists', { method: 'POST', json: input }),
  update: (id: string, input: UpdateListInput) => api<ListDetail>(`/lists/${id}`, { method: 'PATCH', json: input }),
  remove: (id: string) => api(`/lists/${id}`, { method: 'DELETE' }),
  addItem: (id: string, values: Record<string, Cell>) => api<ListItemInfo>(`/lists/${id}/items`, { method: 'POST', json: { values } }),
  updateItem: (itemId: string, values: Record<string, Cell>) => api<ListItemInfo>(`/lists/items/${itemId}`, { method: 'PATCH', json: { values } }),
  removeItem: (itemId: string) => api(`/lists/items/${itemId}`, { method: 'DELETE' }),
  addMembers: (id: string, userIds: string[]) => api<ListDetail>(`/lists/${id}/members`, { method: 'POST', json: { userIds } }),
  removeMember: (id: string, userId: string) => api(`/lists/${id}/members/${userId}`, { method: 'DELETE' }),
};

export const formsApi = {
  create: (input: CreateFormInput) => api<FormDetail>('/forms', { method: 'POST', json: input }),
  update: (id: string, input: UpdateFormInput) => api<FormDetail>(`/forms/${id}`, { method: 'PATCH', json: input }),
  remove: (id: string) => api(`/forms/${id}`, { method: 'DELETE' }),
  submit: (id: string, answers: Record<string, unknown>) => api(`/forms/${id}/responses`, { method: 'POST', json: { answers } }),
  addMembers: (id: string, userIds: string[]) => api<FormDetail>(`/forms/${id}/members`, { method: 'POST', json: { userIds } }),
  removeMember: (id: string, userId: string) => api(`/forms/${id}/members/${userId}`, { method: 'DELETE' }),
};

/** Downloads an authenticated CSV export (a plain link can't carry the bearer token). */
export async function downloadCsv(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${useAuth.getState().accessToken}`, 'x-teamsphere': '1' }, credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
