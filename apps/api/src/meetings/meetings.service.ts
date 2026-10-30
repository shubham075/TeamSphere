import {
  BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { MeetingRole, Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { TrackSource, type WebhookEvent } from 'livekit-server-sdk';
import {
  ActivityItem, AttendanceReport, BreakoutActionInput, BreakoutState, BusyInterval, GuestJoinResult, MeetingBroadcastEvent, MeetingRoomToken, CallUser, createPostSchema, CreateMeetingInput, createMeetingSchema,
  DEFAULT_MEETING_OPTIONS, DEFAULT_WORKING_HOURS, FreeBusyInfo, HostActionInput, InstantMeetingInput,
  MEETING_REMINDER_MINUTES, MeetingException, MeetingInfo, MeetingJoinResult, MeetingLiveState, MeetingLobbyEvent,
  MeetingOccurrence, MeetingOptions, meetingOptionsSchema, MeetingReminderEvent, Recurrence, RsvpInput, RsvpState,
  UpdateMeetingInput, UpdateMeetingOptionsInput, WorkingHours, WS_EVENTS,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { OrgService } from '../admin/org.service';
import { SessionService } from '../auth/session.service';
import { toPublicUser } from '../users/users.mapper';
import { NOTIFICATION_INCLUDE, toActivityItem, toCallUser } from '../calls/calls.mapper';
import { LivekitService } from '../calls/livekit.service';
import { ChatService } from '../chat/chat.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChannelPostsService } from '../teams/channel-posts.service';
import { TeamsService } from '../teams/teams.service';
import {
  bypassesLobby, effectiveRole, expandOccurrences, isOccurrenceOf, isOrganizerRole, isValidTimeZone, mergeIntervals,
  publishSources, PublishSource, SeriesInput, suggestTimes, summarizeAttendance,
} from './meetings.logic';
import { assignBreakouts, canRunMeeting, guestDisplayName, moveToRoom, roomFor } from './advanced.logic';
import { RecordingsService } from './recordings.service';

const MEETING_INCLUDE = { attendees: true } satisfies Prisma.MeetingInclude;
type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof MEETING_INCLUDE }>;
type UserRow = { id: string; displayName: string; avatarKey: string | null };

const USER_SELECT = { id: true, displayName: true, avatarKey: true } as const;
const SOURCES: Record<PublishSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};
/** How often reminders are checked. */
const REMINDER_SWEEP_MS = 30_000;
/** How often live sessions are compared with the LiveKit rooms (attendance + empty-room cleanup). */
const RECONCILE_MS = 15_000;
/** A session nobody connected to within this time (or left empty) ends. */
const EMPTY_SESSION_MS = 90_000;
const INSTANT_MINUTES = 60;
/** Guest sessions last this long (no refresh); guests are disabled when the meeting session ends anyway. */
const GUEST_SESSION_HOURS = 12;
/** When breakout rooms close, people get this long to move back before the rooms are torn down. */
const BREAKOUT_CLOSE_GRACE_MS = 3_000;

interface BreakoutRoom {
  id: string;
  name: string;
  /** Separate LiveKit room (`mbr-<uuid>`), so the meeting webhook/attendance code ignores it by name. */
  roomName: string;
  userIds: Set<string>;
  present: Set<string>;
}

interface Breakouts {
  open: boolean;
  endsAt: Date | null;
  timer: NodeJS.Timeout | null;
  rooms: BreakoutRoom[];
}

/**
 * In-memory state of a live session: lobby, admitted people, raised hands and host switches. Like calls this
 * assumes one API instance; after a restart it is rebuilt from the session row (lobby and hands start empty).
 */
interface Live {
  sessionId: string;
  meetingId: string;
  roomName: string;
  locked: boolean;
  allowAttendeeMic: boolean;
  allowAttendeeCamera: boolean;
  lobby: Map<string, { user: CallUser; since: Date }>;
  admitted: Set<string>;
  removed: Set<string>;
  hands: { userId: string; at: Date }[];
  /** Users currently in the LiveKit room or one of its breakout rooms (from the last reconcile / webhook). */
  inRoom: Set<string>;
  startedAt: Date;
  recording: { id: string; startedAt: Date; startedBy: string } | null;
  breakouts: Breakouts | null;
}

/** Meetings & calendar (SOURCE_OF_TRUTH §3.6, §3.8). Media reuses the Phase 3 LiveKit setup. */
@Injectable()
export class MeetingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly lives = new Map<string, Live>();
  private readonly reminded = new Map<string, number>();
  /** Anonymous guests seen by this instance (always plain attendees, never presenters). */
  private readonly guestIds = new Set<string>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly livekit: LivekitService,
    private readonly chat: ChatService,
    private readonly teams: TeamsService,
    private readonly posts: ChannelPostsService,
    private readonly audit: AuditService,
    private readonly recordings: RecordingsService,
    private readonly sessions: SessionService,
    private readonly policies: PolicyService,
    private readonly org: OrgService,
  ) {}

  onModuleInit() {
    this.livekit.onWebhookEvent((e) => this.onWebhook(e));
    this.recordings.onStopped = (meetingId, recordingId) => {
      const live = [...this.lives.values()].find((l) => l.meetingId === meetingId && l.recording?.id === recordingId);
      if (!live) return;
      live.recording = null;
      void this.broadcast(live);
    };
    if (process.env.VITEST) return;
    this.timers.push(
      setInterval(() => void this.sendReminders().catch((e) => this.logger.warn(`reminders: ${e}`)), REMINDER_SWEEP_MS),
      setInterval(() => void this.reconcileAll().catch((e) => this.logger.warn(`reconcile: ${e}`)), RECONCILE_MS),
    );
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  // ------------------------------------------------------------------ calendar

  /** My meeting occurrences overlapping [from, to). */
  async calendar(me: string, from: Date, to: Date): Promise<MeetingOccurrence[]> {
    if (!(to > from) || to.getTime() - from.getTime() > 100 * 86_400_000) throw new BadRequestException('Invalid range');
    const rows = await this.prisma.meeting.findMany({
      where: {
        cancelledAt: null,
        startAt: { lt: to },
        OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }],
        AND: [{ OR: [{ recurrence: { not: Prisma.DbNull } }, { endAt: { gt: from } }] }],
      },
      include: MEETING_INCLUDE,
    });
    const live = await this.liveMeetingIds(rows.map((r) => r.id));
    const channels = await this.channelNames(rows.map((r) => r.channelId));
    const out: MeetingOccurrence[] = [];
    for (const m of rows) {
      const options = this.options(m);
      const mine = m.attendees.find((a) => a.userId === me);
      const role = mine || m.organizerId === me ? effectiveRole(mine?.role, m.organizerId === me, options) : null;
      for (const o of expandOccurrences(this.series(m), from, to)) {
        const key = o.occurrence.toISOString();
        const rsvp = this.exceptions(m)[key]?.rsvp?.[me] ?? (m.organizerId === me ? 'accepted' : (mine?.rsvp ?? 'none'));
        out.push({
          meetingId: m.id, occurrence: key, startAt: o.startAt.toISOString(), endAt: o.endAt.toISOString(), title: m.title,
          organizerId: m.organizerId, myRsvp: rsvp, myRole: role, isRecurring: !!m.recurrence, cancelled: o.cancelled,
          live: live.has(m.id), channelName: m.channelId ? (channels.get(m.channelId) ?? null) : null,
        });
      }
    }
    return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async get(me: string, id: string): Promise<MeetingInfo> {
    const m = await this.load(id);
    return this.toInfo(m, me, await this.isRelated(m, me));
  }

  async byJoinCode(me: string, code: string): Promise<MeetingInfo> {
    const m = await this.prisma.meeting.findUnique({ where: { joinCode: code.replace(/\s+/g, '') }, include: MEETING_INCLUDE });
    if (!m || m.cancelledAt) throw new NotFoundException('No meeting with that code');
    return this.toInfo(m, me, await this.isRelated(m, me));
  }

  /** The live meeting tied to a chat or a channel, if any ("Join meeting" buttons). */
  async liveFor(me: string, where: { conversationId?: string; channelId?: string }): Promise<{ meetingId: string; sessionId: string } | null> {
    if (where.channelId) {
      if (!(await this.teams.requireChannel(me, where.channelId).then(() => true, () => false))) return null;
    } else if (where.conversationId) {
      const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: where.conversationId, userId: me } } });
      if (!member) return null;
    } else return null;
    const session = await this.prisma.meetingSession.findFirst({
      where: { endedAt: null, meeting: { cancelledAt: null, ...(where.channelId ? { channelId: where.channelId } : { conversationId: where.conversationId }) } },
      orderBy: { startedAt: 'desc' },
    });
    return session ? { meetingId: session.meetingId, sessionId: session.id } : null;
  }

  async create(me: string, raw: CreateMeetingInput): Promise<MeetingInfo> {
    const input = createMeetingSchema.parse(raw);
    const options = await this.defaultOptions(me);
    if (!isValidTimeZone(input.timeZone)) throw new BadRequestException('Unknown time zone');
    const attendees = input.attendees.filter((a) => a.userId !== me);
    await this.assertActiveUsers(attendees.map((a) => a.userId));
    let channelName: string | null = null;
    if (input.channelId) {
      const access = await this.teams.requireChannel(me, input.channelId);
      if (!access.permissions.post) throw new ForbiddenException('You can’t post in this channel');
      channelName = access.channel.name;
    }
    const conversationId = await this.chat.syncMeetingChat(me, null, input.title, attendees.map((a) => a.userId));
    const m = await this.prisma.meeting.create({
      data: {
        organizerId: me, title: input.title, description: input.description, location: input.location,
        startAt: new Date(input.startAt), endAt: new Date(input.endAt), timeZone: input.timeZone,
        recurrence: (input.recurrence ?? Prisma.DbNull) as Prisma.InputJsonValue, joinCode: await this.newJoinCode(),
        options, conversationId, channelId: input.channelId,
        attendees: { create: [{ userId: me, role: 'organizer', rsvp: 'accepted' }, ...attendees.map((a) => ({ userId: a.userId, required: a.required }))] },
      },
      include: MEETING_INCLUDE,
    });
    if (input.channelId) await this.announceInChannel(me, input.channelId, `📅 **${m.title}** · ${this.whenText(m)}\n${this.joinUrl(m.id)}`);
    await this.notify(attendees.map((a) => a.userId), 'meeting_invite', me, m, `Invited you to ${m.title} · ${this.whenText(m)}`);
    this.audit.log({ actorId: me, action: 'meeting.create', targetType: 'meeting', targetId: m.id, meta: { channelName } });
    this.changed(m);
    return this.toInfo(m, me, true);
  }

  /** Meet now: from the calendar (new chat), a chat (its members), or a channel (posted there). */
  async instant(me: string, input: InstantMeetingInput): Promise<MeetingInfo> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me }, select: USER_SELECT });
    let conversationId: string;
    let attendeeIds: string[] = [];
    let title = input.title?.trim() || '';
    if (input.conversationId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, include: { members: true } });
      if (!conv || conv.type === 'channel' || !conv.members.some((x) => x.userId === me)) throw new NotFoundException('Chat not found');
      conversationId = conv.id;
      attendeeIds = conv.members.map((x) => x.userId).filter((id) => id !== me);
      title ||= conv.title || 'Meeting';
    } else {
      if (input.channelId) {
        const access = await this.teams.requireChannel(me, input.channelId);
        title ||= `Meeting in ${access.channel.name}`;
      }
      title ||= `Meeting with ${user.displayName}`;
      conversationId = await this.chat.syncMeetingChat(me, null, title, []);
    }
    const now = new Date();
    now.setSeconds(0, 0);
    const m = await this.prisma.meeting.create({
      data: {
        organizerId: me, title, startAt: now, endAt: new Date(now.getTime() + INSTANT_MINUTES * 60_000), joinCode: await this.newJoinCode(),
        options: await this.defaultOptions(me), conversationId, channelId: input.channelId ?? null, isInstant: true,
        attendees: { create: [{ userId: me, role: 'organizer', rsvp: 'accepted' }, ...attendeeIds.map((userId) => ({ userId }))] },
      },
      include: MEETING_INCLUDE,
    });
    await this.chat.postSystemMessage(conversationId, me, `{actor} started a meeting: ${this.joinUrl(m.id)}`);
    if (input.channelId) await this.announceInChannel(me, input.channelId, `🎥 **${title}** started · join: ${this.joinUrl(m.id)}`);
    this.changed(m);
    return this.toInfo(m, me, true);
  }

  async update(me: string, id: string, input: UpdateMeetingInput): Promise<MeetingInfo> {
    const m = await this.load(id);
    this.requireOrganizer(m, me);
    if (m.cancelledAt) throw new BadRequestException('The meeting was cancelled');

    if (input.occurrence) {
      // One occurrence: only its time can change.
      const occ = new Date(input.occurrence);
      if (!isOccurrenceOf(this.series(m), occ)) throw new BadRequestException('Not an occurrence of this meeting');
      if (!input.startAt) throw new BadRequestException('Give the new start time');
      const start = new Date(input.startAt);
      const end = input.endAt ? new Date(input.endAt) : new Date(start.getTime() + (m.endAt.getTime() - m.startAt.getTime()));
      if (!(end > start)) throw new BadRequestException('End must be after start');
      const ex = this.exceptions(m);
      ex[input.occurrence] = { ...ex[input.occurrence], startAt: start.toISOString(), endAt: end.toISOString() };
      const row = await this.prisma.meeting.update({ where: { id }, data: { exceptions: ex as Prisma.InputJsonValue }, include: MEETING_INCLUDE });
      await this.notify(this.otherAttendees(row, me), 'meeting_updated', me, row, `Moved one occurrence of ${row.title} to ${this.fmt(start, row.timeZone)}`);
      this.changed(row);
      return this.toInfo(row, me, true);
    }

    if (input.timeZone && !isValidTimeZone(input.timeZone)) throw new BadRequestException('Unknown time zone');
    const startAt = input.startAt ? new Date(input.startAt) : m.startAt;
    const endAt = input.endAt ? new Date(input.endAt) : m.endAt;
    if (!(endAt > startAt)) throw new BadRequestException('End must be after start');
    const timeChanged = startAt.getTime() !== m.startAt.getTime() || endAt.getTime() !== m.endAt.getTime()
      || (input.recurrence !== undefined && JSON.stringify(input.recurrence) !== JSON.stringify(m.recurrence));

    const before = new Set(m.attendees.map((a) => a.userId));
    let added: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      if (input.attendees) {
        const wanted = input.attendees.filter((a) => a.userId !== m.organizerId);
        await this.assertActiveUsers(wanted.map((a) => a.userId));
        const keep = new Set(wanted.map((a) => a.userId));
        await tx.meetingAttendee.deleteMany({ where: { meetingId: id, userId: { notIn: [...keep, m.organizerId] } } });
        for (const a of wanted) {
          await tx.meetingAttendee.upsert({
            where: { meetingId_userId: { meetingId: id, userId: a.userId } },
            create: { meetingId: id, userId: a.userId, required: a.required ?? true },
            update: { required: a.required ?? true },
          });
        }
        added = wanted.map((a) => a.userId).filter((uid) => !before.has(uid));
      }
      if (timeChanged) {
        // A new time invalidates earlier answers (and per-occurrence overrides of the old rule).
        await tx.meetingAttendee.updateMany({ where: { meetingId: id, userId: { not: m.organizerId } }, data: { rsvp: 'none', proposedStartAt: null, proposedEndAt: null } });
      }
      await tx.meeting.update({
        where: { id },
        data: {
          title: input.title, description: input.description, location: input.location, startAt, endAt, timeZone: input.timeZone,
          recurrence: input.recurrence === undefined ? undefined : ((input.recurrence ?? Prisma.DbNull) as Prisma.InputJsonValue),
          exceptions: timeChanged ? {} : undefined,
        },
      });
    });
    const row = await this.load(id);
    if (input.attendees || input.title) await this.chat.syncMeetingChat(me, row.conversationId, row.title, row.attendees.map((a) => a.userId));
    await this.notify(added, 'meeting_invite', me, row, `Invited you to ${row.title} · ${this.whenText(row)}`);
    await this.notify(this.otherAttendees(row, me).filter((uid) => !added.includes(uid)), 'meeting_updated', me, row, `Updated ${row.title} · ${this.whenText(row)}`);
    this.audit.log({ actorId: me, action: 'meeting.update', targetType: 'meeting', targetId: id });
    this.changed(row, [...before]);
    return this.toInfo(row, me, true);
  }

  async cancel(me: string, id: string, occurrence?: string): Promise<void> {
    const m = await this.load(id);
    this.requireOrganizer(m, me);
    if (occurrence) {
      if (!isOccurrenceOf(this.series(m), new Date(occurrence))) throw new BadRequestException('Not an occurrence of this meeting');
      const ex = this.exceptions(m);
      ex[occurrence] = { ...ex[occurrence], cancelled: true };
      const row = await this.prisma.meeting.update({ where: { id }, data: { exceptions: ex as Prisma.InputJsonValue }, include: MEETING_INCLUDE });
      await this.notify(this.otherAttendees(row, me), 'meeting_cancelled', me, row, `Cancelled ${row.title} on ${this.fmt(new Date(occurrence), row.timeZone)}`);
      this.changed(row);
      return;
    }
    const row = await this.prisma.meeting.update({ where: { id }, data: { cancelledAt: new Date() }, include: MEETING_INCLUDE });
    await this.notify(this.otherAttendees(row, me), 'meeting_cancelled', me, row, `Cancelled ${row.title}`);
    await this.chat.postSystemMessage(row.conversationId, me, `{actor} cancelled "${row.title}".`);
    const live = await this.prisma.meetingSession.findFirst({ where: { meetingId: id, endedAt: null } });
    if (live) await this.endSession(live.id);
    this.audit.log({ actorId: me, action: 'meeting.cancel', targetType: 'meeting', targetId: id });
    this.changed(row);
  }

  async rsvp(me: string, id: string, input: RsvpInput): Promise<MeetingInfo> {
    const m = await this.load(id);
    if (m.organizerId === me) throw new BadRequestException('You organize this meeting');
    if (!(await this.isRelated(m, me))) throw new NotFoundException('Meeting not found');
    const proposed = input.proposedStartAt && input.proposedEndAt ? { start: new Date(input.proposedStartAt), end: new Date(input.proposedEndAt) } : null;
    if (proposed && !(proposed.end > proposed.start)) throw new BadRequestException('Proposed end must be after start');

    if (input.occurrence) {
      if (!isOccurrenceOf(this.series(m), new Date(input.occurrence))) throw new BadRequestException('Not an occurrence of this meeting');
      const ex = this.exceptions(m);
      ex[input.occurrence] = { ...ex[input.occurrence], rsvp: { ...ex[input.occurrence]?.rsvp, [me]: input.rsvp } };
      await this.prisma.meeting.update({ where: { id }, data: { exceptions: ex as Prisma.InputJsonValue } });
    } else {
      await this.prisma.meetingAttendee.upsert({
        where: { meetingId_userId: { meetingId: id, userId: me } },
        create: { meetingId: id, userId: me, required: false, rsvp: input.rsvp, rsvpNote: input.note ?? null, proposedStartAt: proposed?.start, proposedEndAt: proposed?.end },
        update: { rsvp: input.rsvp, rsvpNote: input.note ?? null, proposedStartAt: proposed?.start ?? null, proposedEndAt: proposed?.end ?? null },
      });
    }
    const row = await this.load(id);
    const label = { accepted: 'Accepted', tentative: 'Tentatively accepted', declined: 'Declined' }[input.rsvp];
    const preview = proposed
      ? `${label} ${row.title} and proposed ${this.fmt(proposed.start, row.timeZone)}`
      : `${label} ${row.title}${input.occurrence ? ` (${this.fmt(new Date(input.occurrence), row.timeZone)})` : ''}`;
    await this.notify([row.organizerId], 'meeting_rsvp', me, row, preview);
    this.changed(row);
    return this.toInfo(row, me, true);
  }

  async updateOptions(me: string, id: string, input: UpdateMeetingOptionsInput): Promise<MeetingInfo> {
    const m = await this.load(id);
    this.requireOrganizer(m, me);
    const options = meetingOptionsSchema.parse({ ...this.options(m), ...input.options });
    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id }, data: { options } });
      for (const r of input.roles ?? []) {
        if (r.userId === m.organizerId) continue;
        await tx.meetingAttendee.upsert({
          where: { meetingId_userId: { meetingId: id, userId: r.userId } },
          create: { meetingId: id, userId: r.userId, role: r.role as MeetingRole, required: false },
          update: { role: r.role as MeetingRole },
        });
      }
    });
    const row = await this.load(id);
    // Apply to a running meeting: new defaults for the switches and publish rights of everyone in the room.
    const session = await this.prisma.meetingSession.findFirst({ where: { meetingId: id, endedAt: null } });
    if (session) {
      const live = await this.live(session.id);
      if (input.options?.allowAttendeeMic !== undefined) live.allowAttendeeMic = options.allowAttendeeMic;
      if (input.options?.allowAttendeeCamera !== undefined) live.allowAttendeeCamera = options.allowAttendeeCamera;
      await this.applyPermissions(row, live);
      await this.broadcast(live);
    }
    this.audit.log({ actorId: me, action: 'meeting.options', targetType: 'meeting', targetId: id, meta: input as Prisma.InputJsonValue });
    this.changed(row);
    return this.toInfo(row, me, true);
  }

  // ------------------------------------------------------------------ scheduling assistant

  async freeBusy(me: string, q: { userIds: string[]; from: Date; to: Date; durationMin: number; timeZone: string; excludeMeetingId?: string }): Promise<FreeBusyInfo> {
    if (!(q.to > q.from) || q.to.getTime() - q.from.getTime() > 31 * 86_400_000) throw new BadRequestException('Invalid range');
    const ids = [...new Set([me, ...q.userIds])].slice(0, 50);
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: USER_SELECT });
    const hours = await this.prisma.workingHours.findMany({ where: { userId: { in: ids } } });
    const tz = isValidTimeZone(q.timeZone) ? q.timeZone : 'UTC';
    const meetings = await this.prisma.meeting.findMany({
      where: {
        cancelledAt: null, id: q.excludeMeetingId ? { not: q.excludeMeetingId } : undefined, startAt: { lt: q.to },
        OR: [{ organizerId: { in: ids } }, { attendees: { some: { userId: { in: ids } } } }],
        AND: [{ OR: [{ recurrence: { not: Prisma.DbNull } }, { endAt: { gt: q.from } }] }],
      },
      include: MEETING_INCLUDE,
    });
    const result = users.map((u) => {
      const busy: { start: number; end: number; tentative: boolean }[] = [];
      for (const m of meetings) {
        const att = m.attendees.find((a) => a.userId === u.id);
        if (!att && m.organizerId !== u.id) continue;
        for (const o of expandOccurrences(this.series(m), q.from, q.to)) {
          if (o.cancelled) continue;
          const rsvp: RsvpState = m.organizerId === u.id ? 'accepted' : (this.exceptions(m)[o.occurrence.toISOString()]?.rsvp?.[u.id] ?? att?.rsvp ?? 'none');
          if (rsvp === 'declined') continue;
          busy.push({ start: o.startAt.getTime(), end: o.endAt.getTime(), tentative: rsvp !== 'accepted' });
        }
      }
      const wh = hours.find((h) => h.userId === u.id);
      const workingHours: WorkingHours = wh ? { timeZone: wh.timeZone, days: wh.days, startMinute: wh.startMinute, endMinute: wh.endMinute } : { ...DEFAULT_WORKING_HOURS, timeZone: tz };
      return { user: toCallUser(u), busy: mergeIntervals(busy), workingHours };
    });
    const suggestions = suggestTimes({
      busy: result.map((r) => r.busy),
      workingHours: result.map((r) => r.workingHours),
      from: new Date(Math.max(q.from.getTime(), Date.now())),
      to: q.to,
      durationMin: q.durationMin,
    });
    return {
      users: result.map((r) => ({
        user: r.user,
        workingHours: r.workingHours,
        busy: r.busy.map((b): BusyInterval => ({ startAt: new Date(b.start).toISOString(), endAt: new Date(b.end).toISOString(), tentative: !!b.tentative })),
      })),
      suggestions: suggestions.map((s) => ({ startAt: s.start.toISOString(), endAt: s.end.toISOString() })),
    };
  }

  async workingHours(me: string, fallbackTz = 'UTC'): Promise<WorkingHours> {
    const row = await this.prisma.workingHours.findUnique({ where: { userId: me } });
    if (row) return { timeZone: row.timeZone, days: row.days, startMinute: row.startMinute, endMinute: row.endMinute };
    return { ...DEFAULT_WORKING_HOURS, timeZone: isValidTimeZone(fallbackTz) ? fallbackTz : 'UTC' };
  }

  async setWorkingHours(me: string, wh: WorkingHours): Promise<WorkingHours> {
    if (!isValidTimeZone(wh.timeZone)) throw new BadRequestException('Unknown time zone');
    const data = { timeZone: wh.timeZone, days: [...new Set(wh.days)].sort(), startMinute: wh.startMinute, endMinute: wh.endMinute };
    await this.prisma.workingHours.upsert({ where: { userId: me }, create: { userId: me, ...data }, update: data });
    return data;
  }

  // ------------------------------------------------------------------ joining & lobby

  async join(me: string, id: string, occurrence?: string): Promise<MeetingJoinResult> {
    const m = await this.load(id);
    if (m.cancelledAt) return { status: 'denied', reason: 'cancelled' };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me }, select: { ...USER_SELECT, guestMeetingId: true } });
    const guest = !!user.guestMeetingId;
    if (guest) {
      if (user.guestMeetingId !== m.id) throw new ForbiddenException('Guests can only join the meeting they were invited to');
      if (!this.options(m).allowGuests) return { status: 'denied', reason: 'declined' };
      this.guestIds.add(me);
    }
    const role = this.roleOf(m, me);
    const invited = !guest && (await this.isInvited(m, me));
    const session = await this.activeSession(m, occurrence);
    const live = await this.live(session.id);

    if (live.removed.has(me)) return { status: 'denied', reason: 'removed' };
    const organizer = isOrganizerRole(role);
    if (!organizer && !live.admitted.has(me)) {
      if (live.locked) return { status: 'denied', reason: 'locked' };
      // Anonymous guests always wait for someone to let them in.
      if (guest || !bypassesLobby(role, invited, this.options(m))) {
        if (!live.lobby.has(me)) {
          live.lobby.set(me, { user: toCallUser(user), since: new Date() });
          const event: MeetingLobbyEvent = { meetingId: m.id, sessionId: live.sessionId, kind: 'waiting', user: toCallUser(user) };
          this.realtime.toUsers(this.organizerIds(m), WS_EVENTS.meetingLobby, event);
          await this.broadcast(live);
        }
        return { status: 'lobby', sessionId: live.sessionId, meeting: await this.toInfo(m, me, invited) };
      }
    }
    live.admitted.add(me);
    live.lobby.delete(me);
    // Everyone who gets in keeps the meeting chat afterwards (guests have no chat access).
    if (!guest) await this.chat.syncMeetingChat(m.organizerId, m.conversationId, m.title, [me]);
    const sources = publishSources(role, this.options(m), live).map((s) => SOURCES[s]);
    const token = await this.livekit.token(live.roomName, user, sources);
    await this.broadcast(live);
    return {
      status: 'admitted', url: this.livekit.publicUrl, token, roomName: live.roomName, role,
      state: await this.state(live), meeting: await this.toInfo(m, me, !guest),
    };
  }

  /** Anonymous join from the link: creates a meeting-scoped guest account and a short session. */
  async guestJoin(code: string, name: string, client: { ip: string | null; userAgent: string | null }): Promise<GuestJoinResult> {
    const m = await this.prisma.meeting.findUnique({ where: { joinCode: code.replace(/\s+/g, '') }, include: MEETING_INCLUDE });
    if (!m || m.cancelledAt) throw new NotFoundException('No meeting with that link');
    if (!this.options(m).allowGuests) throw new ForbiddenException('This meeting doesn’t allow guests');
    await this.org.assertGuestAccess();
    const user = await this.prisma.user.create({
      data: { username: `guest-${randomUUID()}`, displayName: guestDisplayName(name), role: 'guest', guestMeetingId: m.id },
    });
    this.guestIds.add(user.id);
    const { accessToken } = await this.sessions.createGuest(user, client, GUEST_SESSION_HOURS);
    this.audit.log({ actorId: user.id, action: 'meeting.guest_join', targetType: 'meeting', targetId: m.id, meta: { name: user.displayName } });
    return { accessToken, meetingId: m.id, user: toPublicUser(user) };
  }

  /**
   * Who may use a meeting's polls, Q&A, whiteboard and recordings: invited people, plus anyone (guests included)
   * admitted to its live session.
   */
  async access(me: string, meetingId: string): Promise<{ m: MeetingRow; moderator: boolean; audience: string[] }> {
    const m = await this.load(meetingId);
    const live = [...this.lives.values()].find((l) => l.meetingId === meetingId);
    const inLive = !!live && (live.admitted.has(me) || live.inRoom.has(me));
    const allowed = inLive || (!this.guestIds.has(me) && (await this.isInvited(m, me)));
    if (!allowed) throw new ForbiddenException('You are not in this meeting');
    const audience = [m.organizerId, ...m.attendees.map((a) => a.userId), ...(live ? [...live.admitted, ...live.inRoom] : [])];
    return { m, moderator: canRunMeeting(this.roleOf(m, me)), audience: [...new Set(audience)] };
  }

  optionsOf(m: { options: Prisma.JsonValue }): MeetingOptions {
    return this.options(m);
  }

  /** People admitted to or present in the meeting's live session right now (guests included). */
  liveAudience(meetingId: string): string[] {
    const live = [...this.lives.values()].find((l) => l.meetingId === meetingId);
    return live ? [...new Set([...live.admitted, ...live.inRoom])] : [];
  }

  // ------------------------------------------------------------------ rooms, breakouts, recording

  /**
   * Token for the room I belong in right now: my breakout room while rooms are open, else the main room.
   * Organizers may visit any breakout room (`roomId`) or return to the main room (`main`).
   */
  async roomToken(me: string, sessionId: string, roomId?: string): Promise<MeetingRoomToken> {
    const live = await this.requireInSession(me, sessionId);
    const m = await this.load(live.meetingId);
    const role = this.roleOf(m, me);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me }, select: USER_SELECT });
    let target = roomFor(live.breakouts, me);
    if (roomId && isOrganizerRole(role)) target = roomId === 'main' ? null : roomId;
    const room = target ? live.breakouts?.rooms.find((r) => r.id === target) : undefined;
    if (target && (!room || !live.breakouts?.open)) throw new BadRequestException('That breakout room isn’t open');
    // In breakout rooms everyone may talk and share (small groups), as in Teams.
    const sources = room ? Object.values(SOURCES) : publishSources(role, this.options(m), live).map((s) => SOURCES[s]);
    const token = await this.livekit.token(room ? room.roomName : live.roomName, user, sources);
    return { url: this.livekit.publicUrl, token, roomName: room ? room.roomName : live.roomName, breakoutRoomId: room?.id ?? null, breakoutName: room?.name ?? null };
  }

  async breakoutAction(me: string, sessionId: string, input: BreakoutActionInput): Promise<MeetingLiveState> {
    const { m, live } = await this.requireHost(me, sessionId);
    const need = () => {
      if (!live.breakouts) throw new BadRequestException('Create breakout rooms first');
      return live.breakouts;
    };
    switch (input.action) {
      case 'create': {
        await this.closeBreakouts(live, true);
        const rooms: BreakoutRoom[] = Array.from({ length: input.count }, (_, i) => ({
          id: randomUUID(), name: `Room ${i + 1}`, roomName: `mbr-${randomUUID()}`, userIds: new Set<string>(), present: new Set<string>(),
        }));
        if (input.assign === 'auto') {
          const organizers = new Set(this.organizerIds(m));
          const people = [...live.inRoom].filter((id) => !organizers.has(id));
          for (const [roomId, ids] of assignBreakouts(people, rooms.map((r) => r.id))) ids.forEach((id) => rooms.find((r) => r.id === roomId)!.userIds.add(id));
        }
        live.breakouts = { open: false, endsAt: null, timer: null, rooms };
        break;
      }
      case 'assign':
        try {
          moveToRoom(need().rooms, input.userIds, input.roomId);
        } catch {
          throw new BadRequestException('Unknown room');
        }
        break;
      case 'rename': {
        const room = need().rooms.find((r) => r.id === input.roomId);
        if (!room) throw new BadRequestException('Unknown room');
        room.name = input.name;
        break;
      }
      case 'open': {
        const br = need();
        br.open = true;
        if (br.timer) clearTimeout(br.timer);
        const minutes = input.minutes ?? null;
        br.endsAt = minutes ? new Date(Date.now() + minutes * 60_000) : null;
        br.timer = minutes
          ? setTimeout(() => void this.closeBreakouts(live).catch((e) => this.logger.warn(`breakout timer: ${e}`)), minutes * 60_000)
          : null;
        break;
      }
      case 'close':
        need();
        await this.closeBreakouts(live);
        break;
      case 'broadcast': {
        const from = (await this.usersById([me])).get(me)?.displayName ?? 'Organizer';
        const event: MeetingBroadcastEvent = { meetingId: m.id, sessionId, from, text: input.text };
        this.realtime.toUsers(this.audience(m, live), WS_EVENTS.meetingBroadcast, event);
        return this.state(live);
      }
      case 'delete':
        await this.closeBreakouts(live, true);
        break;
    }
    this.audit.log({ actorId: me, action: `meeting.breakout.${input.action}`, targetType: 'meeting', targetId: m.id });
    await this.broadcast(live);
    return this.state(live);
  }

  /** Recording on/off (organizers and presenters). Everyone sees the notice through the live state. */
  async setRecording(me: string, sessionId: string, on: boolean): Promise<MeetingLiveState> {
    const live = await this.requireInSession(me, sessionId);
    const m = await this.load(live.meetingId);
    if (!canRunMeeting(this.roleOf(m, me))) throw new ForbiddenException('Only organizers and presenters can record');
    if (on && !live.recording) await this.startRecording(m, live, me);
    if (!on && live.recording) {
      await this.recordings.stop(live.recording.id);
      live.recording = null;
      await this.chat.postSystemMessage(m.conversationId, me, '{actor} stopped recording.');
      this.audit.log({ actorId: me, action: 'meeting.recording.stop', targetType: 'meeting', targetId: m.id });
    }
    await this.broadcast(live);
    return this.state(live);
  }

  async listRecordings(me: string, meetingId: string) {
    await this.access(me, meetingId);
    return this.recordings.list(meetingId);
  }

  /** New meetings start from the defaults, with the organizer's meeting policy picking who skips the lobby. */
  private async defaultOptions(me: string) {
    const policy = await this.policies.effective(me);
    if (!policy.apps.meetings) throw new ForbiddenException('Your organization’s policy doesn’t allow you to schedule meetings');
    return { ...DEFAULT_MEETING_OPTIONS, lobbyBypass: policy.meeting.lobbyDefault };
  }

  private async startRecording(m: MeetingRow, live: Live, by: string) {
    await this.policies.assert(by, (p) => p.meeting.allowRecording, 'Your organization’s policy doesn’t allow recording meetings');
    const rec = await this.recordings.start(m.id, live.sessionId, live.roomName, by);
    live.recording = { id: rec.id, startedAt: rec.startedAt, startedBy: by };
    await this.chat.postSystemMessage(m.conversationId, by, '{actor} started recording. It will be listed with the meeting details.');
    this.audit.log({ actorId: by, action: 'meeting.recording.start', targetType: 'meeting', targetId: m.id });
  }

  /**
   * Closes breakout rooms: people get the new state first (their client moves back to the main room), then the
   * LiveKit rooms are torn down after a grace period. `remove` drops the rooms altogether (recreate / delete).
   */
  private async closeBreakouts(live: Live, remove = false) {
    const b = live.breakouts;
    if (!b) return;
    if (b.timer) clearTimeout(b.timer);
    const wasOpen = b.open;
    Object.assign(b, { open: false, endsAt: null, timer: null });
    if (remove) live.breakouts = null;
    if (!wasOpen) return;
    await this.broadcast(live);
    const names = b.rooms.map((r) => r.roomName);
    setTimeout(() => void Promise.all(names.map((n) => this.livekit.closeRoom(n))).catch(() => undefined), BREAKOUT_CLOSE_GRACE_MS);
  }

  /** Leaving the lobby or the meeting (the room itself is tracked through LiveKit). */
  async leave(me: string, sessionId: string): Promise<void> {
    const live = this.lives.get(sessionId);
    if (!live) return;
    live.lobby.delete(me);
    live.hands = live.hands.filter((h) => h.userId !== me);
    await this.broadcast(live);
  }

  async lobbyDecision(me: string, sessionId: string, userIds: string[], admit: boolean): Promise<MeetingLiveState> {
    const { m, live } = await this.requireHost(me, sessionId);
    for (const uid of userIds) {
      if (!live.lobby.has(uid)) continue;
      live.lobby.delete(uid);
      if (admit) live.admitted.add(uid);
      const event: MeetingLobbyEvent = { meetingId: m.id, sessionId, kind: admit ? 'admitted' : 'denied' };
      this.realtime.toUsers([uid], WS_EVENTS.meetingLobby, event);
    }
    await this.broadcast(live);
    return this.state(live);
  }

  async hostAction(me: string, sessionId: string, input: HostActionInput): Promise<MeetingLiveState> {
    const { m, live } = await this.requireHost(me, sessionId);
    switch (input.action) {
      case 'mute_all':
        await this.livekit.muteAllMics(live.roomName, [me]);
        break;
      case 'lock':
        live.locked = input.locked;
        await this.prisma.meetingSession.update({ where: { id: sessionId }, data: { locked: input.locked } });
        break;
      case 'attendee_mic':
        live.allowAttendeeMic = input.allowed;
        await this.applyPermissions(m, live);
        break;
      case 'attendee_camera':
        live.allowAttendeeCamera = input.allowed;
        await this.applyPermissions(m, live);
        break;
      case 'remove':
        if (input.userId === m.organizerId || input.userId === me) throw new BadRequestException('You can’t remove the organizer');
        live.removed.add(input.userId);
        live.admitted.delete(input.userId);
        live.hands = live.hands.filter((h) => h.userId !== input.userId);
        await this.livekit.removeParticipant(live.roomName, input.userId);
        break;
      case 'lower_hand':
        live.hands = live.hands.filter((h) => h.userId !== input.userId);
        break;
      case 'end':
        await this.endSession(sessionId);
        this.audit.log({ actorId: me, action: 'meeting.end', targetType: 'meeting', targetId: m.id });
        return this.state(live);
    }
    this.audit.log({ actorId: me, action: `meeting.host.${input.action}`, targetType: 'meeting', targetId: m.id });
    await this.broadcast(live);
    return this.state(live);
  }

  async hand(me: string, sessionId: string, raised: boolean): Promise<MeetingLiveState> {
    const live = await this.requireInSession(me, sessionId);
    live.hands = live.hands.filter((h) => h.userId !== me);
    if (raised) live.hands.push({ userId: me, at: new Date() });
    await this.broadcast(live);
    return this.state(live);
  }

  async liveState(me: string, sessionId: string): Promise<MeetingLiveState> {
    return this.state(await this.requireInSession(me, sessionId));
  }

  // ------------------------------------------------------------------ attendance

  async attendance(me: string, id: string): Promise<AttendanceReport[]> {
    const m = await this.load(id);
    this.requireOrganizer(m, me);
    const sessions = await this.prisma.meetingSession.findMany({ where: { meetingId: id }, include: { attendance: true }, orderBy: { startedAt: 'desc' }, take: 50 });
    const users = await this.usersById(sessions.flatMap((s) => s.attendance.map((a) => a.userId)));
    const now = new Date();
    return sessions.map((s) => ({
      sessionId: s.id, occurrence: s.occurrenceStart.toISOString(), startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null,
      records: summarizeAttendance(s.attendance, s.endedAt ?? now).map((r) => ({
        user: toCallUser(users.get(r.userId) ?? { id: r.userId, displayName: 'Unknown user', avatarKey: null }),
        role: r.role, firstJoinAt: r.firstJoinAt.toISOString(), lastLeaveAt: r.lastLeaveAt?.toISOString() ?? null, durationSec: r.durationSec,
        intervals: r.intervals.map((i) => ({ joinedAt: i.joinedAt.toISOString(), leftAt: i.leftAt?.toISOString() ?? null })),
      })),
    }));
  }

  // ------------------------------------------------------------------ LiveKit sync

  async onWebhook(event: WebhookEvent) {
    const roomName = event.room?.name;
    if (!roomName?.startsWith('meeting-')) return;
    const session = await this.prisma.meetingSession.findUnique({ where: { roomName } });
    if (!session || session.endedAt) return;
    if (event.event === 'room_finished') await this.reconcile(session.id, []);
    else if (event.event === 'participant_joined' || event.event === 'participant_left') await this.reconcile(session.id);
  }

  private async reconcileAll() {
    const sessions = await this.prisma.meetingSession.findMany({ where: { endedAt: null }, select: { id: true } });
    for (const s of sessions) await this.reconcile(s.id);
  }

  /** Brings attendance rows in line with who is actually in the room; ends sessions that stay empty. */
  private async reconcile(sessionId: string, known?: string[]) {
    const session = await this.prisma.meetingSession.findUnique({ where: { id: sessionId }, include: { meeting: { include: MEETING_INCLUDE }, attendance: { where: { leftAt: null } } } });
    if (!session || session.endedAt) return;
    const pre = await this.live(sessionId);
    // A "room finished" webhook only covers the main room; people may still be in breakout rooms.
    const main = known && !pre.breakouts?.open ? known : await this.livekit.participantIds(session.roomName);
    if (main === null) return; // LiveKit unreachable: change nothing
    const ids = [...main];
    for (const room of pre.breakouts?.open ? pre.breakouts.rooms : []) {
      room.present = new Set((await this.livekit.participantIds(room.roomName)) ?? room.present);
      ids.push(...room.present);
    }
    const ended = !!known && !pre.breakouts?.open;
    const now = new Date();
    const present = new Set(ids);
    const open = new Set(session.attendance.map((a) => a.userId));
    const joined = [...present].filter((id) => !open.has(id));
    const left = session.attendance.filter((a) => !present.has(a.userId));
    if (joined.length) {
      await this.prisma.meetingAttendance.createMany({ data: joined.map((userId) => ({ sessionId, userId, role: this.roleOf(session.meeting, userId), joinedAt: now })) });
    }
    if (left.length) await this.prisma.meetingAttendance.updateMany({ where: { id: { in: left.map((a) => a.id) } }, data: { leftAt: now } });

    const live = await this.live(sessionId);
    live.inRoom = present;
    live.hands = live.hands.filter((h) => present.has(h.userId));
    // People waiting in the lobby keep an empty meeting open (they wait for an organizer).
    if (!present.size && !live.lobby.size) {
      const lastLeft = await this.prisma.meetingAttendance.aggregate({ where: { sessionId }, _max: { leftAt: true } });
      const lastActivity = Math.max(session.startedAt.getTime(), lastLeft._max.leftAt?.getTime() ?? 0);
      if (now.getTime() - lastActivity >= EMPTY_SESSION_MS || ended) {
        await this.endSession(sessionId);
        return;
      }
    }
    if (joined.length || left.length) {
      await this.broadcast(live);
      if (open.size === 0 && joined.length) {
        this.changed(session.meeting); // went live
        if (this.options(session.meeting).autoRecord && !live.recording) {
          await this.startRecording(session.meeting, live, session.meeting.organizerId).catch((e) => this.logger.warn(`auto-record: ${e}`));
          await this.broadcast(live);
        }
      }
    }
  }

  private async endSession(sessionId: string) {
    const session = await this.prisma.meetingSession.findUnique({ where: { id: sessionId }, include: { meeting: { include: MEETING_INCLUDE } } });
    if (!session || session.endedAt) return;
    const now = new Date();
    await this.prisma.meetingSession.update({ where: { id: sessionId }, data: { endedAt: now } });
    await this.prisma.meetingAttendance.updateMany({ where: { sessionId, leftAt: null }, data: { leftAt: now } });
    await this.livekit.closeRoom(session.roomName);
    const live = this.lives.get(sessionId);
    if (live?.recording) await this.recordings.stop(live.recording.id);
    if (live?.breakouts) {
      if (live.breakouts.timer) clearTimeout(live.breakouts.timer);
      await Promise.all(live.breakouts.rooms.map((r) => this.livekit.closeRoom(r.roomName)));
    }
    // Guest accounts are single-use: they end with the meeting session.
    const guests = await this.prisma.user.findMany({ where: { guestMeetingId: session.meetingId, isActive: true }, select: { id: true } });
    if (guests.length) {
      const ids = guests.map((g) => g.id);
      await this.prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
      await this.prisma.session.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
    }
    if (live) {
      const state = await this.state(live, now);
      this.realtime.toUsers([...this.audience(session.meeting, live), ...live.lobby.keys()], WS_EVENTS.meetingUpdated, state);
      this.lives.delete(sessionId);
    }
    this.changed(session.meeting);
  }

  // ------------------------------------------------------------------ reminders

  async sendReminders(now = new Date()) {
    const horizon = new Date(now.getTime() + MEETING_REMINDER_MINUTES * 60_000);
    const rows = await this.prisma.meeting.findMany({
      where: { cancelledAt: null, isInstant: false, startAt: { lte: horizon }, OR: [{ recurrence: { not: Prisma.DbNull } }, { startAt: { gt: now } }] },
      include: MEETING_INCLUDE,
    });
    for (const m of rows) {
      for (const o of expandOccurrences(this.series(m), now, horizon)) {
        if (o.cancelled || o.startAt <= now) continue;
        const key = `${m.id}:${o.occurrence.toISOString()}`;
        if (this.reminded.has(key)) continue;
        this.reminded.set(key, o.endAt.getTime());
        const ex = this.exceptions(m)[o.occurrence.toISOString()];
        const to = m.attendees.filter((a) => (ex?.rsvp?.[a.userId] ?? a.rsvp) !== 'declined').map((a) => a.userId);
        const event: MeetingReminderEvent = { meetingId: m.id, occurrence: o.occurrence.toISOString(), title: m.title, startAt: o.startAt.toISOString() };
        this.realtime.toUsers(to, WS_EVENTS.meetingReminder, event);
      }
    }
    for (const [key, end] of this.reminded) if (end < now.getTime()) this.reminded.delete(key);
  }

  // ------------------------------------------------------------------ helpers

  private async activeSession(m: MeetingRow, occurrence?: string) {
    const existing = await this.prisma.meetingSession.findFirst({ where: { meetingId: m.id, endedAt: null }, orderBy: { startedAt: 'desc' } });
    if (existing) return existing;
    const now = new Date();
    let occ = now;
    if (occurrence && isOccurrenceOf(this.series(m), new Date(occurrence))) occ = new Date(occurrence);
    else {
      // The occurrence closest to now (today's instance of a recurring meeting).
      const near = expandOccurrences(this.series(m), new Date(now.getTime() - 12 * 3600_000), new Date(now.getTime() + 12 * 3600_000)).filter((o) => !o.cancelled);
      near.sort((a, b) => Math.abs(a.startAt.getTime() - now.getTime()) - Math.abs(b.startAt.getTime() - now.getTime()));
      occ = near[0]?.occurrence ?? (m.recurrence ? now : m.startAt);
    }
    return this.prisma.meetingSession.create({ data: { meetingId: m.id, occurrenceStart: occ, roomName: `meeting-${randomUUID()}` } });
  }

  private async live(sessionId: string): Promise<Live> {
    const cached = this.lives.get(sessionId);
    if (cached) return cached;
    const s = await this.prisma.meetingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { meeting: true, attendance: { where: { leftAt: null } } } });
    const options = this.options(s.meeting);
    const rec = await this.prisma.recording.findFirst({ where: { sessionId, status: 'recording' }, orderBy: { startedAt: 'desc' } });
    const live: Live = {
      sessionId, meetingId: s.meetingId, roomName: s.roomName, locked: s.locked, startedAt: s.startedAt,
      allowAttendeeMic: options.allowAttendeeMic, allowAttendeeCamera: options.allowAttendeeCamera,
      lobby: new Map(), admitted: new Set(s.attendance.map((a) => a.userId)), removed: new Set(), hands: [],
      inRoom: new Set(s.attendance.map((a) => a.userId)),
      recording: rec ? { id: rec.id, startedAt: rec.startedAt, startedBy: rec.startedById } : null,
      breakouts: null,
    };
    this.lives.set(sessionId, live);
    return live;
  }

  private async state(live: Live, endedAt: Date | null = null): Promise<MeetingLiveState> {
    const m = await this.load(live.meetingId);
    const users = await this.usersById([...live.inRoom, ...(live.recording ? [live.recording.startedBy] : [])]);
    return {
      meetingId: live.meetingId, sessionId: live.sessionId, locked: live.locked,
      allowAttendeeMic: live.allowAttendeeMic, allowAttendeeCamera: live.allowAttendeeCamera,
      lobby: [...live.lobby.values()].map((l) => ({ ...l.user, since: l.since.toISOString() })),
      hands: live.hands.map((h) => ({ userId: h.userId, at: h.at.toISOString() })),
      participants: [...live.inRoom].filter((id) => users.has(id)).map((id) => ({ ...toCallUser(users.get(id)!), role: this.roleOf(m, id) })),
      endedAt: endedAt?.toISOString() ?? null,
      recording: live.recording ? { startedAt: live.recording.startedAt.toISOString(), startedBy: users.get(live.recording.startedBy)?.displayName ?? 'Someone' } : null,
      breakouts: live.breakouts ? breakoutState(live.breakouts) : null,
    };
  }

  /** People who get live-state updates: whoever is in or admitted, plus organizers (for the lobby list). */
  private audience(m: MeetingRow, live: Live): string[] {
    return [...new Set([...live.inRoom, ...live.admitted, ...this.organizerIds(m)])];
  }

  private async broadcast(live: Live) {
    const m = await this.load(live.meetingId);
    this.realtime.toUsers(this.audience(m, live), WS_EVENTS.meetingUpdated, await this.state(live));
  }

  private async applyPermissions(m: MeetingRow, live: Live) {
    const options = this.options(m);
    await Promise.all([...live.inRoom].map((uid) =>
      this.livekit.setPublishSources(live.roomName, uid, publishSources(this.roleOf(m, uid), options, live).map((s) => SOURCES[s]))));
  }

  private async requireHost(me: string, sessionId: string) {
    const session = await this.prisma.meetingSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt) throw new NotFoundException('The meeting has ended');
    const m = await this.load(session.meetingId);
    if (!isOrganizerRole(this.roleOf(m, me))) throw new ForbiddenException('Only organizers can do that');
    return { m, live: await this.live(sessionId) };
  }

  private async requireInSession(me: string, sessionId: string) {
    const session = await this.prisma.meetingSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt) throw new NotFoundException('The meeting has ended');
    const live = await this.live(sessionId);
    const m = await this.load(session.meetingId);
    if (!live.admitted.has(me) && !live.inRoom.has(me) && !isOrganizerRole(this.roleOf(m, me))) throw new ForbiddenException('You are not in this meeting');
    return live;
  }

  private roleOf(m: MeetingRow, userId: string): MeetingRole {
    if (this.guestIds.has(userId)) return 'attendee';
    return effectiveRole(m.attendees.find((a) => a.userId === userId)?.role, m.organizerId === userId, this.options(m));
  }

  private organizerIds(m: MeetingRow) {
    return [m.organizerId, ...m.attendees.filter((a) => a.role === 'coorganizer').map((a) => a.userId)];
  }

  private requireOrganizer(m: MeetingRow, me: string) {
    if (!isOrganizerRole(this.roleOf(m, me)) || !(m.organizerId === me || m.attendees.some((a) => a.userId === me))) {
      throw new ForbiddenException('Only organizers can change this meeting');
    }
  }

  /** On the attendee list, in the meeting chat, or a member of the meeting's channel. */
  private async isInvited(m: MeetingRow, me: string): Promise<boolean> {
    if (m.organizerId === me || m.attendees.some((a) => a.userId === me)) return true;
    const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: m.conversationId, userId: me } } });
    if (member) return true;
    if (!m.channelId) return false;
    return this.teams.requireChannel(me, m.channelId).then(() => true, () => false);
  }

  private isRelated(m: MeetingRow, me: string) {
    return this.isInvited(m, me);
  }

  private async load(id: string): Promise<MeetingRow> {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: MEETING_INCLUDE });
    if (!m) throw new NotFoundException('Meeting not found');
    return m;
  }

  private series(m: MeetingRow | { startAt: Date; endAt: Date; timeZone: string; recurrence: Prisma.JsonValue; exceptions: Prisma.JsonValue }): SeriesInput {
    return { startAt: m.startAt, endAt: m.endAt, timeZone: m.timeZone, recurrence: (m.recurrence as Recurrence | null) ?? null, exceptions: this.exceptions(m) };
  }

  private exceptions(m: { exceptions: Prisma.JsonValue }): Record<string, MeetingException> {
    return { ...((m.exceptions as Record<string, MeetingException> | null) ?? {}) };
  }

  private options(m: { options: Prisma.JsonValue }): MeetingOptions {
    const parsed = meetingOptionsSchema.safeParse(m.options ?? {});
    return parsed.success ? parsed.data : DEFAULT_MEETING_OPTIONS;
  }

  private otherAttendees(m: MeetingRow, me: string) {
    return m.attendees.map((a) => a.userId).filter((id) => id !== me);
  }

  private async toInfo(m: MeetingRow, me: string, full: boolean): Promise<MeetingInfo> {
    const users = await this.usersById([m.organizerId, ...m.attendees.map((a) => a.userId)]);
    const session = await this.prisma.meetingSession.findFirst({ where: { meetingId: m.id, endedAt: null }, select: { id: true } });
    const channel = m.channelId ? await this.prisma.channel.findUnique({ where: { id: m.channelId }, select: { name: true } }) : null;
    const u = (id: string) => toCallUser(users.get(id) ?? { id, displayName: 'Unknown user', avatarKey: null });
    const mine = m.attendees.find((a) => a.userId === me);
    return {
      id: m.id, title: m.title, description: full ? m.description : '', location: full ? m.location : '', organizer: u(m.organizerId),
      startAt: m.startAt.toISOString(), endAt: m.endAt.toISOString(), timeZone: m.timeZone,
      recurrence: (m.recurrence as Recurrence | null) ?? null, exceptions: full ? this.exceptions(m) : {}, joinCode: m.joinCode,
      options: this.options(m), conversationId: m.conversationId, channelId: m.channelId, channelName: channel?.name ?? null,
      isInstant: m.isInstant, cancelledAt: m.cancelledAt?.toISOString() ?? null,
      attendees: full
        ? m.attendees.map((a) => ({
          user: u(a.userId), role: a.userId === m.organizerId ? 'organizer' : a.role, required: a.required,
          rsvp: a.userId === m.organizerId ? 'accepted' : a.rsvp, proposedStartAt: a.proposedStartAt?.toISOString() ?? null,
          proposedEndAt: a.proposedEndAt?.toISOString() ?? null, rsvpNote: a.rsvpNote,
        }))
        : [],
      myRole: mine || m.organizerId === me ? this.roleOf(m, me) : null,
      liveSessionId: session?.id ?? null, createdAt: m.createdAt.toISOString(),
    };
  }

  private async usersById(ids: string[]): Promise<Map<string, UserRow>> {
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: USER_SELECT });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async channelNames(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map<string, string>();
    const rows = await this.prisma.channel.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async liveMeetingIds(ids: string[]) {
    const rows = await this.prisma.meetingSession.findMany({ where: { meetingId: { in: ids }, endedAt: null }, select: { meetingId: true } });
    return new Set(rows.map((r) => r.meetingId));
  }

  private async notify(userIds: string[], type: ActivityItem['type'], actorId: string, m: MeetingRow, preview: string) {
    for (const userId of new Set(userIds)) {
      if (userId === actorId) continue;
      const n = await this.prisma.notification.create({
        data: { userId, type, actorId, conversationId: m.conversationId, preview: preview.slice(0, 280) },
        include: NOTIFICATION_INCLUDE,
      });
      this.realtime.toUsers([userId], WS_EVENTS.notificationNew, toActivityItem(n));
    }
  }

  /** Tells everyone involved to refresh their calendars. */
  private changed(m: MeetingRow, extra: string[] = []) {
    const ids = [m.organizerId, ...m.attendees.map((a) => a.userId), ...extra];
    this.realtime.toUsers(ids, WS_EVENTS.meetingChanged, { meetingId: m.id });
  }

  private async announceInChannel(me: string, channelId: string, body: string) {
    await this.posts.post(me, channelId, createPostSchema.parse({ body })).catch((e) => this.logger.warn(`channel announce failed: ${e}`));
  }

  private joinUrl(id: string) {
    return `${this.env.WEB_ORIGIN}/meetings/${id}`;
  }

  private fmt(d: Date, tz: string) {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d) + ` (${tz})`;
    } catch {
      return d.toISOString();
    }
  }

  private whenText(m: MeetingRow) {
    const r = m.recurrence as Recurrence | null;
    return this.fmt(m.startAt, m.timeZone) + (r ? ` · repeats ${r.freq}` : '');
  }

  private async newJoinCode(): Promise<string> {
    for (;;) {
      const code = String(randomInt(1e9, 1e10));
      if (!(await this.prisma.meeting.findUnique({ where: { joinCode: code }, select: { id: true } }))) return code;
    }
  }

  private async assertActiveUsers(ids: string[]) {
    if (!ids.length) return;
    const count = await this.prisma.user.count({ where: { id: { in: [...new Set(ids)] }, isActive: true } });
    if (count !== new Set(ids).size) throw new BadRequestException('Some people could not be found');
  }
}

function breakoutState(b: Breakouts): BreakoutState {
  return {
    open: b.open, endsAt: b.endsAt?.toISOString() ?? null,
    rooms: b.rooms.map((r) => ({ id: r.id, name: r.name, userIds: [...r.userIds], presentIds: b.open ? [...r.present] : [] })),
  };
}
