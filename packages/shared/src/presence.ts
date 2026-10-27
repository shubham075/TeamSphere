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

export interface PresenceInfo {
  userId: string;
  status: PresenceStatus;
  statusMessage: string | null;
}
