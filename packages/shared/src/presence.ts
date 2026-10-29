import { z } from 'zod';

/** Statuses a user can pick manually. */
export const MANUAL_PRESENCE = ['available', 'busy', 'dnd', 'brb', 'away', 'offline'] as const;
/** Statuses the system sets automatically. */
export const AUTO_PRESENCE = ['in_call', 'in_meeting', 'presenting', 'ooo'] as const;

export type ManualPresence = (typeof MANUAL_PRESENCE)[number];
export type PresenceStatus = ManualPresence | (typeof AUTO_PRESENCE)[number];

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  available: 'Available',
  busy: 'Busy',
  dnd: 'Do not disturb',
  brb: 'Be right back',
  away: 'Appear away',
  offline: 'Appear offline',
  in_call: 'In a call',
  in_meeting: 'In a meeting',
  presenting: 'Presenting',
  ooo: 'Out of office',
};

/** How a status reads when shown for someone else ("Appear away" is only a menu choice). */
export const PRESENCE_LABELS_OTHERS: Record<PresenceStatus, string> = {
  ...PRESENCE_LABELS,
  away: 'Away',
  offline: 'Offline',
};

export const setPresenceSchema = z.object({
  status: z.enum(MANUAL_PRESENCE),
  /** ISO timestamp after which the status resets to automatic. */
  until: z.iso.datetime().nullable().optional(),
});
export type SetPresenceInput = z.infer<typeof setPresenceSchema>;

export const setStatusMessageSchema = z.object({
  message: z.string().max(280).nullable(),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type SetStatusMessageInput = z.infer<typeof setStatusMessageSchema>;

/** Out of office: on now (no start) or scheduled, until an optional end; others see the message in chat. */
export const outOfOfficeSchema = z
  .object({
    enabled: z.boolean(),
    message: z.string().trim().max(1000).nullable().optional(),
    startAt: z.iso.datetime().nullable().optional(),
    endAt: z.iso.datetime().nullable().optional(),
  })
  .refine((v) => !v.startAt || !v.endAt || v.startAt < v.endAt, { message: 'The end must be after the start' });
export type OutOfOfficeInput = z.infer<typeof outOfOfficeSchema>;

export interface OutOfOfficeInfo {
  message: string | null;
  until: string | null;
}

/** The owner's own out-of-office settings (including a schedule that hasn't started yet). */
export interface OutOfOfficeSettings {
  enabled: boolean;
  message: string | null;
  startAt: string | null;
  endAt: string | null;
}

export interface PresenceInfo {
  userId: string;
  status: PresenceStatus;
  statusMessage: string | null;
  /** When the status message clears itself; null = never. */
  statusExpiresAt: string | null;
  /** When a manually picked status resets to automatic; null = never. */
  presenceExpiresAt: string | null;
  /** Set while out of office is active. */
  outOfOffice: OutOfOfficeInfo | null;
}
