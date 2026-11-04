import { z } from 'zod';
import type { CollabPerson, CollabRole } from './pages';

/** Phase 8c: Lists (custom-column tables) and Forms (questions, responses, summaries). */

export type CollabOwner = 'user' | 'channel';

export const LISTS_WS_EVENTS = {
  /** A list's columns, views or items changed, or the user's lists changed: refetch. */
  listsChanged: 'lists:changed',
  /** A form changed or got a response: refetch. */
  formsChanged: 'forms:changed',
} as const;

export interface ListsChangedEvent {
  ids: string[];
}

// ---------------------------------------------------------------- Lists

export const LIST_COLUMN_TYPES = ['text', 'longtext', 'number', 'choice', 'date', 'person', 'boolean', 'link'] as const;
export type ListColumnType = (typeof LIST_COLUMN_TYPES)[number];

const id = z.string().min(1).max(40);
const name = z.string().trim().min(1, 'Enter a name').max(100);

export const listColumnSchema = z.object({
  id,
  name,
  type: z.enum(LIST_COLUMN_TYPES),
  /** Choice columns: the allowed values. */
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  required: z.boolean().optional(),
});
export type ListColumn = z.infer<typeof listColumnSchema>;

export const listViewSchema = z.object({
  id,
  name,
  layout: z.enum(['grid', 'board']).default('grid'),
  sort: z.object({ columnId: id, dir: z.enum(['asc', 'desc']) }).nullable().default(null),
  /** Simple column filters: equals for choice/person/boolean, contains for text. */
  filters: z.array(z.object({ columnId: id, value: z.string().max(200) })).max(10).default([]),
  /** Board layout: the choice column whose values become lanes. */
  groupBy: id.nullable().default(null),
});
export type ListView = z.infer<typeof listViewSchema>;

export const createListSchema = z.object({
  title: z.string().trim().min(1, 'Enter a name').max(200),
  description: z.string().max(2000).default(''),
  channelId: z.string().min(1).nullable().default(null),
  memberIds: z.array(z.string().min(1)).max(100).default([]),
  columns: z.array(listColumnSchema).max(40).default([]),
  /** Starter rows for templates: column id → value. */
  items: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
  addTab: z.boolean().default(false),
});
export type CreateListInput = z.input<typeof createListSchema>;

export const updateListSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  /** Replaces the column set; values of removed columns are dropped from items. */
  columns: z.array(listColumnSchema).max(40).optional(),
  views: z.array(listViewSchema).max(20).optional(),
});
export type UpdateListInput = z.input<typeof updateListSchema>;

export const listItemSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  position: z.number().finite().optional(),
});
export type ListItemInput = z.infer<typeof listItemSchema>;

export interface ListSummary {
  id: string;
  title: string;
  description: string;
  ownerType: CollabOwner;
  channel: { id: string; name: string; teamName: string } | null;
  role: CollabRole;
  itemCount: number;
  updatedAt: string;
}

export interface ListDetail extends ListSummary {
  columns: ListColumn[];
  views: ListView[];
  owner: CollabPerson | null;
  members: CollabPerson[];
  /** People who can be picked in person columns (members, or everyone in the channel). */
  people: CollabPerson[];
}

export interface ListItemInfo {
  id: string;
  /** Normalized values: string | number | boolean | null (person = user id, date = YYYY-MM-DD). */
  values: Record<string, string | number | boolean | null>;
  position: number;
  createdBy: CollabPerson | null;
  updatedBy: CollabPerson | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListWithItems {
  list: ListDetail;
  items: ListItemInfo[];
}

// ---------------------------------------------------------------- Forms

export const FORM_QUESTION_TYPES = ['text', 'longtext', 'choice', 'multichoice', 'rating', 'number', 'date'] as const;
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number];
export type FormStatus = 'draft' | 'open' | 'closed';

export const formQuestionSchema = z.object({
  id,
  type: z.enum(FORM_QUESTION_TYPES),
  title: z.string().trim().min(1, 'Enter a question').max(300),
  description: z.string().max(1000).optional(),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  /** Rating questions: number of stars (3–10). */
  scale: z.number().int().min(3).max(10).optional(),
});
export type FormQuestion = z.infer<typeof formQuestionSchema>;

export const createFormSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
  description: z.string().max(2000).default(''),
  channelId: z.string().min(1).nullable().default(null),
  memberIds: z.array(z.string().min(1)).max(100).default([]),
  questions: z.array(formQuestionSchema).max(100).default([]),
  addTab: z.boolean().default(false),
});
export type CreateFormInput = z.input<typeof createFormSchema>;

export const updateFormSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  questions: z.array(formQuestionSchema).max(100).optional(),
  status: z.enum(['draft', 'open', 'closed']).optional(),
  closesAt: z.string().datetime().nullable().optional(),
  anonymous: z.boolean().optional(),
  onePerPerson: z.boolean().optional(),
});
export type UpdateFormInput = z.input<typeof updateFormSchema>;

/** question id → string (text/choice/date), string[] (multichoice) or number (rating/number). */
export const submitFormSchema = z.object({ answers: z.record(z.string(), z.unknown()) });
export type SubmitFormInput = z.infer<typeof submitFormSchema>;

export type FormAnswer = string | string[] | number;

export interface FormSummary {
  id: string;
  title: string;
  ownerType: CollabOwner;
  channel: { id: string; name: string; teamName: string } | null;
  role: CollabRole | 'respondent';
  status: FormStatus;
  responseCount: number;
  updatedAt: string;
}

export interface FormDetail extends FormSummary {
  description: string;
  questions: FormQuestion[];
  closesAt: string | null;
  anonymous: boolean;
  onePerPerson: boolean;
  /** Open, not past its close date. */
  accepting: boolean;
  /** The caller already answered (one-per-person forms). */
  responded: boolean;
  owner: CollabPerson | null;
  members: CollabPerson[];
}

export interface FormResponseInfo {
  id: string;
  respondent: CollabPerson | null;
  answers: Record<string, FormAnswer>;
  createdAt: string;
}

export type QuestionSummary =
  | { questionId: string; type: 'choice' | 'multichoice'; answered: number; counts: { option: string; count: number }[] }
  | { questionId: string; type: 'rating' | 'number'; answered: number; average: number | null; min: number | null; max: number | null; distribution: { value: number; count: number }[] }
  | { questionId: string; type: 'text' | 'longtext' | 'date'; answered: number; latest: string[] };

export interface FormResults {
  responseCount: number;
  questions: QuestionSummary[];
  responses: FormResponseInfo[];
}
