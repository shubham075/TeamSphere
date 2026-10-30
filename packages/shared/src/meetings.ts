import { z } from 'zod';
import type { CallUser } from './calls';

// ---------- constants ----------

export const MEETING_ROLES = ['organizer', 'coorganizer', 'presenter', 'attendee'] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];
export const RSVP_STATES = ['none', 'accepted', 'tentative', 'declined'] as const;
export type RsvpState = (typeof RSVP_STATES)[number];
/** Who skips the lobby. "everyone" means everyone in the organization: anonymous guests always wait in the lobby. */
export const LOBBY_BYPASS = ['everyone', 'invited', 'organizers'] as const;
export const WHO_CAN_PRESENT = ['everyone', 'organizers', 'specific'] as const;
export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export const MAX_MEETING_ATTENDEES = 200;
/** Minutes before the start that reminders go out (in-app toast + desktop notification). */
export const MEETING_REMINDER_MINUTES = 15;
/** Join button shows this long before the start. */
export const MEETING_JOIN_EARLY_MINUTES = 15;

// ---------- schemas ----------

/**
 * Recurrence rule, expanded in the meeting's time zone. `byWeekday` (0 = Sunday) applies to weekly rules;
 * monthly rules repeat on the start date's day of month. Ends at `until` (inclusive date) or after `count`.
 */
export const recurrenceSchema = z.object({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().min(1).max(99).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: z.string().datetime().optional(),
  count: z.number().int().min(1).max(500).optional(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const meetingOptionsSchema = z.object({
  lobbyBypass: z.enum(LOBBY_BYPASS).default('invited'),
  /** Notify organizers with a sound/toast when someone waits in the lobby. */
  announceLobby: z.boolean().default(true),
  whoCanPresent: z.enum(WHO_CAN_PRESENT).default('everyone'),
  allowAttendeeMic: z.boolean().default(true),
  allowAttendeeCamera: z.boolean().default(true),
  allowChat: z.boolean().default(true),
  allowReactions: z.boolean().default(true),
  /** Start recording when the first person joins. */
  autoRecord: z.boolean().default(false),
  /** Anonymous guests may join with the link (name only; always through the lobby). */
  allowGuests: z.boolean().default(true),
  allowQna: z.boolean().default(true),
  /** Attendee questions wait for an organizer to publish them. */
  moderateQna: z.boolean().default(true),
  allowWhiteboard: z.boolean().default(true),
});
export type MeetingOptions = z.infer<typeof meetingOptionsSchema>;
export const DEFAULT_MEETING_OPTIONS: MeetingOptions = meetingOptionsSchema.parse({});

const attendeeInput = z.object({ userId: z.string().min(1), required: z.boolean().default(true) });

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).default(''),
    location: z.string().max(200).default(''),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    timeZone: z.string().min(1).max(64).default('UTC'),
    recurrence: recurrenceSchema.nullable().default(null),
    attendees: z.array(attendeeInput).max(MAX_MEETING_ATTENDEES).default([]),
    channelId: z.string().nullable().default(null),
  })
  .refine((m) => new Date(m.endAt) > new Date(m.startAt), { message: 'End must be after start', path: ['endAt'] });
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

/** Editing one occurrence (`occurrence` set) can only move it; everything else edits the whole series. */
export const updateMeetingSchema = z.object({
  occurrence: z.string().datetime().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  location: z.string().max(200).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  timeZone: z.string().min(1).max(64).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  attendees: z.array(attendeeInput).max(MAX_MEETING_ATTENDEES).optional(),
});
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

export const instantMeetingSchema = z.object({
  title: z.string().trim().max(200).optional(),
  conversationId: z.string().optional(),
  channelId: z.string().optional(),
});
export type InstantMeetingInput = z.input<typeof instantMeetingSchema>;

export const rsvpSchema = z.object({
  rsvp: z.enum(['accepted', 'tentative', 'declined']),
  /** Applies the answer to one occurrence only. */
  occurrence: z.string().datetime().optional(),
  proposedStartAt: z.string().datetime().optional(),
  proposedEndAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});
export type RsvpInput = z.input<typeof rsvpSchema>;

export const updateMeetingOptionsSchema = z.object({
  options: meetingOptionsSchema.partial().optional(),
  /** Role changes; the organizer's own role can't change. */
  roles: z.array(z.object({ userId: z.string(), role: z.enum(['coorganizer', 'presenter', 'attendee']) })).max(MAX_MEETING_ATTENDEES).optional(),
});
export type UpdateMeetingOptionsInput = z.input<typeof updateMeetingOptionsSchema>;

export const joinMeetingSchema = z.object({ occurrence: z.string().datetime().optional() });

export const lobbyDecisionSchema = z.object({ userIds: z.array(z.string()).min(1).max(200), admit: z.boolean() });

export const hostActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mute_all') }),
  z.object({ action: z.literal('lock'), locked: z.boolean() }),
  z.object({ action: z.literal('attendee_mic'), allowed: z.boolean() }),
  z.object({ action: z.literal('attendee_camera'), allowed: z.boolean() }),
  z.object({ action: z.literal('remove'), userId: z.string() }),
  z.object({ action: z.literal('lower_hand'), userId: z.string() }),
  z.object({ action: z.literal('end') }),
]);
export type HostActionInput = z.infer<typeof hostActionSchema>;

export const handSchema = z.object({ raised: z.boolean() });

/** Recordings are kept this many days unless the server overrides it (RECORDING_RETENTION_DAYS). */
export const DEFAULT_RECORDING_RETENTION_DAYS = 90;
export const MAX_BREAKOUT_ROOMS = 50;

export const recordingActionSchema = z.object({ recording: z.boolean() });

export const breakoutActionSchema = z.discriminatedUnion('action', [
  /** Creates (or recreates, replacing the old set) N closed rooms; auto assignment spreads people evenly. */
  z.object({ action: z.literal('create'), count: z.number().int().min(1).max(MAX_BREAKOUT_ROOMS), assign: z.enum(['auto', 'manual']) }),
  /** Assigns (or with roomId null unassigns) people; moves them right away while rooms are open. */
  z.object({ action: z.literal('assign'), userIds: z.array(z.string()).min(1).max(200), roomId: z.string().nullable() }),
  z.object({ action: z.literal('rename'), roomId: z.string(), name: z.string().trim().min(1).max(60) }),
  /** Opens the rooms; with a timer they close by themselves. */
  z.object({ action: z.literal('open'), minutes: z.number().int().min(1).max(240).nullable().default(null) }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('broadcast'), text: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('delete') }),
]);
export type BreakoutActionInput = z.input<typeof breakoutActionSchema>;

export const meetingPollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  /** false = save as a draft to launch later. */
  launch: z.boolean().default(false),
});
export type MeetingPollInput = z.input<typeof meetingPollSchema>;
export const meetingPollActionSchema = z.object({ action: z.enum(['launch', 'close', 'delete']) });
export const meetingPollVoteSchema = z.object({ options: z.array(z.number().int().min(0).max(9)).min(1).max(10) });

export const meetingQuestionSchema = z.object({ text: z.string().trim().min(1).max(500), anonymous: z.boolean().default(false) });
export const meetingQuestionActionSchema = z.object({ action: z.enum(['publish', 'answer', 'dismiss', 'upvote', 'unvote', 'delete']) });

/** Anonymous guest join: name only, from the join link (`/join/<joinCode>`). */
export const guestJoinSchema = z.object({ code: z.string().trim().min(4).max(32), name: z.string().trim().min(1).max(60) });
export type GuestJoinInput = z.input<typeof guestJoinSchema>;

export const workingHoursSchema = z.object({
  timeZone: z.string().min(1).max(64),
  /** 0 = Sunday. */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
}).refine((w) => w.endMinute > w.startMinute, { message: 'End must be after start' });
export type WorkingHours = z.infer<typeof workingHoursSchema>;
export const DEFAULT_WORKING_HOURS: Omit<WorkingHours, 'timeZone'> = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 };

// ---------- DTOs ----------

export interface MeetingAttendeeInfo {
  user: CallUser;
  role: MeetingRole;
  required: boolean;
  rsvp: RsvpState;
  proposedStartAt: string | null;
  proposedEndAt: string | null;
  rsvpNote: string | null;
}

export interface MeetingInfo {
  id: string;
  title: string;
  description: string;
  location: string;
  organizer: CallUser;
  startAt: string;
  endAt: string;
  timeZone: string;
  recurrence: Recurrence | null;
  /** Keyed by the occurrence's original start (ISO). */
  exceptions: Record<string, MeetingException>;
  joinCode: string;
  options: MeetingOptions;
  conversationId: string;
  channelId: string | null;
  channelName: string | null;
  isInstant: boolean;
  cancelledAt: string | null;
  attendees: MeetingAttendeeInfo[];
  myRole: MeetingRole | null;
  /** Live session right now (someone is in the meeting). */
  liveSessionId: string | null;
  createdAt: string;
}

export interface MeetingException {
  cancelled?: boolean;
  startAt?: string;
  endAt?: string;
  /** Per-occurrence RSVP: userId → answer. */
  rsvp?: Record<string, RsvpState>;
}

/** One expanded occurrence for the calendar. */
export interface MeetingOccurrence {
  meetingId: string;
  /** Original start of the occurrence (stable id within the series). */
  occurrence: string;
  startAt: string;
  endAt: string;
  title: string;
  organizerId: string;
  myRsvp: RsvpState;
  myRole: MeetingRole | null;
  isRecurring: boolean;
  cancelled: boolean;
  live: boolean;
  channelName: string | null;
}

export interface BusyInterval {
  startAt: string;
  endAt: string;
  tentative: boolean;
}

export interface FreeBusyInfo {
  users: { user: CallUser; busy: BusyInterval[]; workingHours: WorkingHours }[];
  suggestions: { startAt: string; endAt: string }[];
}

export interface MeetingUser extends CallUser {
  role: MeetingRole;
}

/** Live state of an in-progress meeting, pushed to everyone in it (`meeting:updated`). */
export interface MeetingLiveState {
  meetingId: string;
  sessionId: string;
  locked: boolean;
  allowAttendeeMic: boolean;
  allowAttendeeCamera: boolean;
  lobby: (CallUser & { since: string })[];
  /** Ordered raised-hand queue. */
  hands: { userId: string; at: string }[];
  participants: MeetingUser[];
  endedAt: string | null;
  recording: { startedAt: string; startedBy: string } | null;
  breakouts: BreakoutState | null;
}

export interface BreakoutRoomInfo {
  id: string;
  name: string;
  /** Assigned people (whether or not they are in the room right now). */
  userIds: string[];
  /** People connected to this room right now. */
  presentIds: string[];
}

export interface BreakoutState {
  open: boolean;
  /** Timer: when the rooms close by themselves. */
  endsAt: string | null;
  rooms: BreakoutRoomInfo[];
}

/** A LiveKit room to connect to: the main meeting room or a breakout room. */
export interface MeetingRoomToken {
  url: string;
  token: string;
  roomName: string;
  /** Null for the main room. */
  breakoutRoomId: string | null;
  breakoutName: string | null;
}

export interface RecordingInfo {
  id: string;
  status: 'recording' | 'processing' | 'ready' | 'failed';
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  size: number | null;
  startedBy: CallUser;
  expiresAt: string;
  /** Signed playback URL once ready. */
  url: string | null;
}

export interface MeetingPollInfo {
  id: string;
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  status: 'draft' | 'live' | 'closed';
  /** Votes per option. Hidden from attendees (empty) until they vote or the poll closes. */
  counts: number[];
  voters: number;
  myVotes: number[];
  /** Who voted for what (non-anonymous polls, organizers only). */
  votesByOption: CallUser[][] | null;
  createdAt: string;
  launchedAt: string | null;
}

export interface MeetingQuestionInfo {
  id: string;
  text: string;
  /** Null when anonymous (to everyone except the author). */
  author: CallUser | null;
  mine: boolean;
  status: 'pending' | 'published' | 'answered' | 'dismissed';
  upvotes: number;
  upvotedByMe: boolean;
  createdAt: string;
}

export interface GuestJoinResult {
  accessToken: string;
  user: import('./auth').PublicUser;
  meetingId: string;
}

/** Things inside a meeting changed; clients refetch the matching list. */
export interface MeetingActivityEvent {
  meetingId: string;
  kind: 'polls' | 'questions' | 'recordings';
  /** A poll was just launched (show it to everyone). */
  launchedPollId?: string;
}

export interface MeetingBroadcastEvent {
  meetingId: string;
  sessionId: string;
  from: string;
  text: string;
}

export type MeetingJoinResult =
  | { status: 'admitted'; url: string; token: string; roomName: string; role: MeetingRole; state: MeetingLiveState; meeting: MeetingInfo }
  | { status: 'lobby'; sessionId: string; meeting: MeetingInfo }
  | { status: 'denied'; reason: 'locked' | 'removed' | 'declined' | 'cancelled' };

export interface AttendanceRecord {
  user: CallUser;
  role: MeetingRole;
  firstJoinAt: string;
  lastLeaveAt: string | null;
  durationSec: number;
  intervals: { joinedAt: string; leftAt: string | null }[];
}

export interface AttendanceReport {
  sessionId: string;
  occurrence: string;
  startedAt: string;
  endedAt: string | null;
  records: AttendanceRecord[];
}

// ---------- realtime payloads ----------

export interface MeetingLobbyEvent {
  meetingId: string;
  sessionId: string;
  /** For organizers: someone new is waiting. For the waiting user: admitted / denied. */
  kind: 'waiting' | 'admitted' | 'denied';
  user?: CallUser;
}

export interface MeetingReminderEvent {
  meetingId: string;
  occurrence: string;
  title: string;
  startAt: string;
}
