import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WebhookEvent } from 'livekit-server-sdk';
import {
  CallEndedEvent, CallEndReason, CallHistoryPage, CallInfo, CallJoinInfo, CallKind, CallParticipantStatus,
  CallSettingsInfo, CallSettingsInput, CallStatus, CallTransferredEvent, MAX_CALL_PARTICIPANTS, MAX_VOICEMAIL_SECONDS,
  RING_TIMEOUT_MS, SpeedDialEntry, VoicemailInfo, WS_EVENTS,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../admin/policy.service';
import { MESSAGE_INCLUDE, toMessageInfo } from '../chat/chat.mapper';
import { StorageService } from '../infra/storage';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  callDurationSec, canTransition, defaultEndReason, formatDuration, historyDirection, isFinal, nextCallStatus,
} from './call-state';
import {
  CALL_INCLUDE, CallRow, NOTIFICATION_INCLUDE, toActivityItem, toCallInfo, toCallUser, toVoicemailInfo,
  VOICEMAIL_INCLUDE,
} from './calls.mapper';
import { LivekitService } from './livekit.service';

const ACTIVE: CallStatus[] = ['ringing', 'active'];
const FINAL: CallStatus[] = ['ended', 'missed', 'declined'];
/** How often unanswered rings are checked; a ring lasts RING_TIMEOUT_MS plus at most this. */
const RING_SWEEP_MS = 2_000;
/** How often call state is compared with the LiveKit rooms (backs up webhooks, e.g. a closed tab). */
const RECONCILE_MS = 20_000;
/** Time a client gets to connect to LiveKit after joining before we treat it as gone. */
const CONNECT_GRACE_MS = 30_000;

interface Ring {
  userId: string;
  status: CallParticipantStatus;
  forwardedForId?: string;
}

/**
 * Call lifecycle (SOURCE_OF_TRUTH §6 "Call flow"). State changes for one call are serialized with an
 * in-process lock; like presence, this assumes a single API instance for now.
 */
@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name);
  private readonly locks = new Map<string, Promise<unknown>>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly livekit: LivekitService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
  ) {}

  async onModuleInit() {
    // Calls outlive API restarts: restore "In a call" for people still connected.
    const joined = await this.prisma.callParticipant.findMany({
      where: { status: 'joined', call: { status: { in: ACTIVE } } },
      select: { userId: true, callId: true },
    });
    for (const p of joined) await this.presence.setInCall(p.userId, p.callId);
    const sweep = (fn: () => Promise<void>, name: string) => () => fn().catch((e) => this.logger.error(`${name}: ${e}`));
    this.timers = [
      setInterval(sweep(() => this.expireRings(), 'ring sweep'), RING_SWEEP_MS),
      setInterval(sweep(() => this.reconcileAll(), 'reconcile'), RECONCILE_MS),
    ];
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  // ------------------------------------------------------------------ lifecycle

  async start(me: string, input: { conversationId?: string; userId?: string; kind: CallKind }): Promise<CallJoinInfo> {
    const policy = await this.policies.effective(me);
    if (!policy.calling.allowCalls || !policy.apps.calls) throw new ForbiddenException('Your organization’s policy doesn’t allow you to make calls');
    if (input.kind === 'video' && !policy.calling.allowVideo) throw new ForbiddenException('Your organization’s policy allows audio calls only');
    const conversation = input.userId ? await this.directConversation(me, input.userId) : await this.memberConversation(me, input.conversationId!);
    if (conversation.type === 'self') throw new BadRequestException("You can't call yourself");
    if (conversation.type !== 'direct' && conversation.type !== 'group') {
      throw new BadRequestException('Calls start from a 1:1 or group chat; channel meetings come with Meetings');
    }
    const calleeIds = conversation.members.map((m) => m.userId).filter((id) => id !== me);
    if (!calleeIds.length) throw new BadRequestException('There is nobody else in this chat to call');
    if (calleeIds.length + 1 > MAX_CALL_PARTICIPANTS) {
      throw new BadRequestException(`Calls are limited to ${MAX_CALL_PARTICIPANTS} people; schedule a meeting instead`);
    }

    // Already a call in this chat (a running group call, or both people pressed call at once): join it.
    const running = await this.prisma.call.findFirst({ where: { conversationId: conversation.id, status: { in: ACTIVE } } });
    if (running) return this.join(me, running.id);

    await this.leaveOtherCalls(me);
    const row = await this.createCall(me, conversation.id, input.kind, calleeIds);
    this.audit.log({ actorId: me, action: 'call.start', targetType: 'call', targetId: row.id, meta: { conversationId: conversation.id, kind: input.kind } });
    return this.joinInfo(row, me);
  }

  /** Accept a ring, join a running call from the chat, or reconnect after a reload. */
  async join(me: string, callId: string): Promise<CallJoinInfo> {
    await this.leaveOtherCalls(me, callId);
    return this.withLock(callId, async () => {
      const call = await this.load(callId);
      if (isFinal(call.status)) throw new GoneException('This call has ended');
      const now = new Date();
      const p = call.participants.find((x) => x.userId === me);
      if (!p) {
        // Anyone in the chat can join a running call from the chat header.
        const member = call.conversationId
          ? await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: call.conversationId, userId: me } } })
          : null;
        if (!member) throw new NotFoundException('Call not found');
        await this.prisma.callParticipant.create({ data: { callId, userId: me, status: 'joined', joinedAt: now } });
      } else {
        if (p.status !== 'joined' && !canTransition(p.status, 'joined')) throw new ConflictException('You can no longer join this call');
        // Re-joining while already joined (page reload) just restarts the connect grace period.
        await this.prisma.callParticipant.update({
          where: { callId_userId: { callId, userId: me } },
          data: { status: 'joined', joinedAt: now, leftAt: null, onHold: false },
        });
        if (p.status === 'ringing') {
          // Answered on one ring of this person: stop their other rings (forwarding / simultaneous ring).
          const owner = p.forwardedForId ?? me;
          await this.prisma.callParticipant.updateMany({
            where: { callId, status: 'ringing', userId: { not: me }, OR: [{ userId: owner }, { forwardedForId: owner }] },
            data: { status: 'left' },
          });
        }
      }
      if (!call.answeredAt && !p?.isCaller) {
        await this.prisma.call.update({ where: { id: callId }, data: { answeredAt: now } });
      }
      await this.presence.setInCall(me, callId);
      return this.joinInfo(await this.settle(callId), me);
    });
  }

  async decline(me: string, callId: string): Promise<void> {
    await this.withLock(callId, async () => {
      const call = await this.load(callId);
      const p = this.requireParticipant(call, me);
      if (p.status !== 'ringing') return;
      await this.prisma.callParticipant.update({ where: { callId_userId: { callId, userId: me } }, data: { status: 'declined' } });
      if (!p.forwardedForId) {
        // Declining your own call also stops the rings forwarded on your behalf.
        await this.prisma.callParticipant.updateMany({ where: { callId, status: 'ringing', forwardedForId: me }, data: { status: 'left' } });
      }
      await this.settle(callId);
    });
  }

  async leave(me: string, callId: string): Promise<void> {
    await this.withLock(callId, async () => {
      const call = await this.load(callId);
      const p = this.requireParticipant(call, me);
      if (p.status !== 'joined' || isFinal(call.status)) return;
      await this.markLeft(callId, me);
      await this.settle(callId);
    });
  }

  /** Ends the call for everyone. In group calls only the person who started it may do this. */
  async end(me: string, callId: string): Promise<void> {
    await this.withLock(callId, async () => {
      const call = await this.load(callId);
      const p = this.requireParticipant(call, me);
      if (isFinal(call.status)) return;
      if (call.conversation?.type === 'group' && !p.isCaller) {
        throw new ForbiddenException('Only the person who started the call can end it for everyone');
      }
      await this.finalize(call, call.answeredAt ? 'ended' : 'missed', call.answeredAt ? 'hangup' : 'cancelled');
    });
  }

  /** Adds people to a running call (rings them). */
  async invite(me: string, callId: string, userIds: string[]): Promise<CallInfo> {
    return this.withLock(callId, async () => {
      const call = await this.load(callId);
      const p = this.requireParticipant(call, me);
      if (isFinal(call.status) || p.status !== 'joined') throw new ConflictException('Join the call to add people');
      const current = new Map(call.participants.map((x) => [x.userId, x.status]));
      const ids = [...new Set(userIds)].filter((id) => id !== me && !['joined', 'ringing'].includes(current.get(id) ?? ''));
      if (!ids.length) return toCallInfo(call);
      if (call.participants.length + ids.length > MAX_CALL_PARTICIPANTS) {
        throw new BadRequestException(`Calls are limited to ${MAX_CALL_PARTICIPANTS} people`);
      }
      await this.assertActiveUsers(ids);
      // Forwarding can point at someone already in the call; leave them be.
      const rings = (await this.route(me, ids)).rings.filter((r) => !['joined', 'ringing'].includes(current.get(r.userId) ?? ''));
      const now = new Date();
      for (const r of rings) {
        const data = { status: r.status, invitedAt: now, forwardedForId: r.forwardedForId ?? null };
        await this.prisma.callParticipant.upsert({
          where: { callId_userId: { callId, userId: r.userId } },
          create: { callId, userId: r.userId, ...data },
          update: data,
        });
      }
      const row = await this.load(callId);
      await this.ringOrNotify(row, rings);
      this.audit.log({ actorId: me, action: 'call.invite', targetType: 'call', targetId: callId, meta: { userIds: ids } });
      return toCallInfo(await this.settle(callId));
    });
  }

  async hold(me: string, callId: string, onHold: boolean): Promise<CallInfo> {
    return this.withLock(callId, async () => {
      const call = await this.load(callId);
      const p = this.requireParticipant(call, me);
      if (p.status !== 'joined' || isFinal(call.status)) throw new ConflictException('You are not in this call');
      await this.prisma.callParticipant.update({ where: { callId_userId: { callId, userId: me } }, data: { onHold } });
      return toCallInfo(await this.settle(callId));
    });
  }

  /**
   * Blind transfer: the other person in a 1:1 call is moved to a new call that rings the target,
   * and this call ends for the person transferring.
   */
  async transfer(me: string, callId: string, targetId: string): Promise<void> {
    await this.withLock(callId, async () => {
      const call = await this.load(callId);
      const p = this.requireParticipant(call, me);
      if (call.status !== 'active' || p.status !== 'joined') throw new ConflictException('You can only transfer a connected call');
      const others = call.participants.filter((x) => x.status === 'joined' && x.userId !== me);
      if (others.length !== 1) throw new BadRequestException('Transfer works in calls with one other person');
      const transferee = others[0];
      if (targetId === me || targetId === transferee.userId) throw new BadRequestException('Pick someone else to transfer to');
      await this.assertActiveUsers([targetId]);

      const conversation = await this.directConversation(transferee.userId, targetId);
      const next = await this.createCall(transferee.userId, conversation.id, call.kind, [targetId], {
        transferredById: me,
        transferredFromId: callId,
      });
      const event: CallTransferredEvent = { fromCallId: callId, join: await this.joinInfo(next, transferee.userId) };
      this.realtime.toUsers([transferee.userId], WS_EVENTS.callTransferred, event);
      await this.finalize(call, 'ended', 'transferred');
      this.audit.log({ actorId: me, action: 'call.transfer', targetType: 'call', targetId: callId, meta: { to: targetId, newCallId: next.id } });
    });
  }

  // ------------------------------------------------------------------ queries

  async get(me: string, callId: string): Promise<CallInfo> {
    const call = await this.load(callId);
    if (!call.participants.some((p) => p.userId === me)) {
      const member = call.conversationId
        ? await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: call.conversationId, userId: me } } })
        : null;
      if (!member) throw new NotFoundException('Call not found');
    }
    return toCallInfo(call);
  }

  /** Calls ringing me or that I'm in, plus running calls in my chats (for "Join" buttons). Used after a reload. */
  async active(me: string): Promise<CallInfo[]> {
    const rows = await this.prisma.call.findMany({
      where: {
        status: { in: ACTIVE },
        OR: [
          { participants: { some: { userId: me, status: { in: ['ringing', 'joined'] } } } },
          { conversation: { members: { some: { userId: me } } } },
        ],
      },
      include: CALL_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toCallInfo);
  }

  async history(me: string, before?: string, take = 30): Promise<CallHistoryPage> {
    const limit = Math.min(Math.max(take, 1), 100);
    const cursor = before ? new Date(before) : null;
    const rows = await this.prisma.call.findMany({
      where: {
        status: { in: FINAL },
        participants: { some: { userId: me } },
        ...(cursor && !Number.isNaN(cursor.getTime()) ? { createdAt: { lt: cursor } } : {}),
      },
      include: CALL_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((c) => {
        const mine = c.participants.find((p) => p.userId === me)!;
        return {
          call: toCallInfo(c),
          direction: historyDirection(c, mine),
          durationSec: callDurationSec(c.answeredAt, c.endedAt),
        };
      }),
      nextCursor: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  // ------------------------------------------------------------------ voicemail

  async leaveVoicemail(
    me: string,
    callId: string,
    file: { mimetype: string; size: number },
    durationSec: number,
    store: (key: string) => Promise<void>,
  ): Promise<VoicemailInfo> {
    const call = await this.load(callId);
    if (call.startedById !== me) throw new NotFoundException('Call not found');
    const target = this.voicemailTarget(call);
    if (!target) throw new BadRequestException('Voicemail is only available for missed one-to-one calls');
    if (await this.prisma.voicemail.findFirst({ where: { callId } })) throw new ConflictException('You already left a voicemail for this call');
    const mimeType = file.mimetype.split(';')[0].trim();
    if (!/^(audio\/[\w.+-]+|video\/webm)$/.test(mimeType)) throw new BadRequestException('Voicemail must be an audio recording');

    const storageKey = `voicemails/${randomUUID()}`;
    await store(storageKey);
    const durationMs = Math.round(Math.min(Math.max(durationSec, 0), MAX_VOICEMAIL_SECONDS) * 1000);
    const vm = await this.prisma.voicemail.create({
      data: { userId: target.id, fromUserId: me, callId, storageKey, mimeType, size: file.size, durationMs },
      include: VOICEMAIL_INCLUDE,
    });
    const info = toVoicemailInfo(vm, this.storage);
    const n = await this.prisma.notification.create({
      data: {
        userId: target.id,
        type: 'voicemail',
        actorId: me,
        conversationId: call.conversationId,
        preview: `Voicemail · ${formatDuration(info.durationSec)}`,
      },
      include: NOTIFICATION_INCLUDE,
    });
    this.realtime.toUsers([target.id], WS_EVENTS.notificationNew, toActivityItem(n));
    this.realtime.toUsers([target.id], WS_EVENTS.voicemailNew, info);
    return info;
  }

  async voicemails(me: string): Promise<VoicemailInfo[]> {
    const rows = await this.prisma.voicemail.findMany({
      where: { userId: me },
      include: VOICEMAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((v) => toVoicemailInfo(v, this.storage));
  }

  async markVoicemailListened(me: string, id: string): Promise<VoicemailInfo> {
    const vm = await this.ownVoicemail(me, id);
    const row = await this.prisma.voicemail.update({
      where: { id: vm.id },
      data: { listenedAt: vm.listenedAt ?? new Date() },
      include: VOICEMAIL_INCLUDE,
    });
    return toVoicemailInfo(row, this.storage);
  }

  async deleteVoicemail(me: string, id: string): Promise<void> {
    const vm = await this.ownVoicemail(me, id);
    await this.prisma.voicemail.delete({ where: { id: vm.id } });
    await this.storage.remove(vm.storageKey);
    this.audit.log({ actorId: me, action: 'voicemail.delete', targetType: 'voicemail', targetId: id });
  }

  // ------------------------------------------------------------------ settings & speed dial

  async settings(me: string): Promise<CallSettingsInfo> {
    const s = await this.prisma.callSettings.findUnique({
      where: { userId: me },
      include: { forwardTo: { select: { id: true, displayName: true, avatarKey: true } }, alsoRing: { select: { id: true, displayName: true, avatarKey: true } } },
    });
    return {
      forwardMode: s?.forwardMode ?? 'off',
      forwardTo: s?.forwardTo ? toCallUser(s.forwardTo) : null,
      alsoRing: s?.alsoRing ? toCallUser(s.alsoRing) : null,
    };
  }

  async updateSettings(me: string, input: Required<CallSettingsInput>): Promise<CallSettingsInfo> {
    const forwardToId = input.forwardMode === 'user' ? input.forwardToId : null;
    const alsoRingId = input.forwardMode === 'off' ? input.alsoRingId : null;
    const ids = [forwardToId, alsoRingId].filter((x): x is string => !!x);
    if (ids.includes(me)) throw new BadRequestException("You can't forward calls to yourself");
    await this.assertActiveUsers(ids);
    const data = { forwardMode: input.forwardMode, forwardToId, alsoRingId };
    await this.prisma.callSettings.upsert({ where: { userId: me }, create: { userId: me, ...data }, update: data });
    this.audit.log({ actorId: me, action: 'call.settings', targetType: 'user', targetId: me, meta: data });
    return this.settings(me);
  }

  async speedDial(me: string): Promise<SpeedDialEntry[]> {
    const rows = await this.prisma.speedDial.findMany({
      where: { userId: me, contact: { isActive: true } },
      include: { contact: { select: { id: true, displayName: true, avatarKey: true, jobTitle: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ user: { ...toCallUser(r.contact), jobTitle: r.contact.jobTitle }, createdAt: r.createdAt.toISOString() }));
  }

  async addSpeedDial(me: string, contactId: string): Promise<SpeedDialEntry[]> {
    if (contactId === me) throw new BadRequestException("You can't add yourself");
    await this.assertActiveUsers([contactId]);
    await this.prisma.speedDial.upsert({ where: { userId_contactId: { userId: me, contactId } }, create: { userId: me, contactId }, update: {} });
    return this.speedDial(me);
  }

  async removeSpeedDial(me: string, contactId: string): Promise<SpeedDialEntry[]> {
    await this.prisma.speedDial.deleteMany({ where: { userId: me, contactId } });
    return this.speedDial(me);
  }

  // ------------------------------------------------------------------ LiveKit sync

  async onWebhook(event: WebhookEvent) {
    const roomName = event.room?.name;
    if (!roomName) return;
    const call = await this.prisma.call.findUnique({ where: { roomName }, select: { id: true, status: true } });
    if (!call || isFinal(call.status)) return;
    if (event.event === 'room_finished') {
      await this.withLock(call.id, async () => {
        const row = await this.load(call.id);
        if (!isFinal(row.status)) await this.finalize(row, row.answeredAt ? 'ended' : 'missed', row.answeredAt ? 'hangup' : 'cancelled');
      });
    } else if (event.event === 'participant_left' || event.event === 'participant_joined') {
      await this.reconcile(call.id);
    }
  }

  /** Ends rings that nobody answered within RING_TIMEOUT_MS. */
  async expireRings(now = new Date()) {
    const expired = await this.prisma.callParticipant.findMany({
      where: { status: 'ringing', invitedAt: { lte: new Date(now.getTime() - RING_TIMEOUT_MS) } },
      select: { callId: true },
      distinct: ['callId'],
    });
    for (const { callId } of expired) {
      await this.withLock(callId, async () => {
        const call = await this.load(callId);
        const cutoff = now.getTime() - RING_TIMEOUT_MS;
        const timedOut = call.participants.filter((p) => p.status === 'ringing' && p.invitedAt.getTime() <= cutoff);
        if (!timedOut.length) return;
        if (isFinal(call.status)) {
          await this.prisma.callParticipant.updateMany({ where: { callId, status: 'ringing' }, data: { status: 'missed' } });
          return;
        }
        await this.prisma.callParticipant.updateMany({
          where: { callId, userId: { in: timedOut.map((p) => p.userId) }, status: 'ringing' },
          data: { status: 'missed' },
        });
        // Unanswered calls report missed calls when they end (finalize); here only for people added to a live call.
        if (call.answeredAt) await Promise.all(timedOut.map((p) => this.notifyMissed(call, p.userId)));
        await this.settle(callId);
      });
    }
  }

  private async reconcileAll() {
    const calls = await this.prisma.call.findMany({ where: { status: { in: ACTIVE } }, select: { id: true } });
    for (const c of calls) await this.reconcile(c.id);
  }

  /** Marks people as left when LiveKit says they're no longer in the room (closed tab, lost network…). */
  private async reconcile(callId: string) {
    await this.withLock(callId, async () => {
      const call = await this.load(callId);
      if (isFinal(call.status)) return;
      const inRoom = await this.livekit.participantIds(call.roomName);
      if (!inRoom) return; // LiveKit unreachable: don't guess.
      const cutoff = Date.now() - CONNECT_GRACE_MS;
      const gone = call.participants.filter(
        (p) => p.status === 'joined' && !inRoom.includes(p.userId) && (p.joinedAt?.getTime() ?? 0) < cutoff,
      );
      if (!gone.length) return;
      for (const p of gone) await this.markLeft(callId, p.userId);
      await this.settle(callId);
    });
  }

  // ------------------------------------------------------------------ internals

  private async createCall(
    callerId: string,
    conversationId: string,
    kind: CallKind,
    calleeIds: string[],
    extra: { transferredById?: string; transferredFromId?: string } = {},
  ): Promise<CallRow> {
    const { rings, reason } = await this.route(callerId, calleeIds);
    const now = new Date();
    const created = await this.prisma.call.create({
      data: {
        conversationId,
        kind,
        roomName: `call-${randomUUID()}`,
        startedById: callerId,
        ...extra,
        participants: {
          create: [
            { userId: callerId, status: 'joined', isCaller: true, joinedAt: now },
            ...rings.map((r) => ({ userId: r.userId, status: r.status, forwardedForId: r.forwardedForId ?? null })),
          ],
        },
      },
      include: CALL_INCLUDE,
    });
    await this.presence.setInCall(callerId, created.id);
    await this.ringOrNotify(created, rings);
    // Nobody could be rung (busy, DND, forwarded to voicemail): this ends the call at once.
    return this.settle(created.id, rings.some((r) => r.status === 'ringing') ? undefined : reason);
  }

  /**
   * Decides who actually rings: applies each callee's forwarding / simultaneous ring settings,
   * Do-not-disturb rejection and busy-on-busy.
   */
  private async route(callerId: string, calleeIds: string[]): Promise<{ rings: Ring[]; reason: CallEndReason }> {
    const settings = await this.prisma.callSettings.findMany({ where: { userId: { in: calleeIds } } });
    const byUser = new Map(settings.map((s) => [s.userId, s]));
    const everyone = [...new Set([...calleeIds, ...settings.flatMap((s) => [s.forwardToId, s.alsoRingId]).filter((x): x is string => !!x)])];
    const [presence, busy] = await Promise.all([this.presence.getMany(everyone), this.usersInCalls(everyone)]);
    const unavailable = (id: string) => presence.get(id)?.status === 'dnd' || busy.has(id);

    const rings: Ring[] = [];
    const add = (r: Ring) => {
      if (r.userId !== callerId && !rings.some((x) => x.userId === r.userId)) rings.push(r);
    };
    let reason: CallEndReason = 'busy';
    for (const id of calleeIds) {
      const s = byUser.get(id);
      if (s?.forwardMode === 'voicemail') {
        add({ userId: id, status: 'forwarded' });
        reason = 'voicemail';
      } else if (s?.forwardMode === 'user' && s.forwardToId && s.forwardToId !== callerId) {
        add({ userId: id, status: 'forwarded' });
        add({ userId: s.forwardToId, status: unavailable(s.forwardToId) ? 'busy' : 'ringing', forwardedForId: id });
      } else if (unavailable(id)) {
        add({ userId: id, status: 'busy' });
        if (presence.get(id)?.status === 'dnd' && reason === 'busy') reason = 'dnd';
      } else {
        add({ userId: id, status: 'ringing' });
        if (s?.alsoRingId && !unavailable(s.alsoRingId)) add({ userId: s.alsoRingId, status: 'ringing', forwardedForId: id });
      }
    }
    return { rings, reason };
  }

  private async ringOrNotify(call: CallRow, rings: Ring[]) {
    const info = toCallInfo(call);
    this.realtime.toUsers(rings.filter((r) => r.status === 'ringing').map((r) => r.userId), WS_EVENTS.callIncoming, info);
    // Busy / DND people get a missed-call entry straight away.
    await Promise.all(rings.filter((r) => r.status === 'busy').map((r) => this.notifyMissed(call, r.userId)));
  }

  /** Recomputes the call status from its participants, persists it and tells everyone. */
  private async settle(callId: string, reason?: CallEndReason): Promise<CallRow> {
    let row = await this.load(callId);
    if (isFinal(row.status)) return row;
    const states = row.participants.map((p) => ({ status: p.status, isCaller: p.isCaller }));
    const group = row.conversation?.type === 'group' || row.participants.filter((p) => p.joinedAt).length > 2;
    const next = nextCallStatus({ status: row.status, answered: !!row.answeredAt, group }, states);
    if (isFinal(next)) return this.finalize(row, next, reason ?? defaultEndReason(next, states));
    if (next !== row.status) {
      row = await this.prisma.call.update({ where: { id: callId }, data: { status: next }, include: CALL_INCLUDE });
    }
    this.realtime.toUsers(row.participants.map((p) => p.userId), WS_EVENTS.callUpdated, toCallInfo(row));
    return row;
  }

  private async finalize(row: CallRow, status: CallStatus, reason: CallEndReason | null): Promise<CallRow> {
    const now = new Date();
    const { count } = await this.prisma.call.updateMany({
      where: { id: row.id, status: { in: ACTIVE } },
      data: { status, endReason: reason, endedAt: now },
    });
    if (!count) return this.load(row.id);
    const stillRinging = row.participants.filter((p) => p.status === 'ringing').map((p) => p.userId);
    const connected = row.participants.filter((p) => p.status === 'joined').map((p) => p.userId);
    await this.prisma.callParticipant.updateMany({ where: { callId: row.id, status: 'ringing' }, data: { status: 'missed' } });
    await this.prisma.callParticipant.updateMany({
      where: { callId: row.id, status: 'joined' },
      data: { status: 'left', leftAt: now, onHold: false },
    });
    await Promise.all(connected.map((id) => this.presence.clearInCall(id, row.id)));
    void this.livekit.closeRoom(row.roomName);

    const final = await this.load(row.id);
    // Missed-call entries: everyone who never picked up an unanswered call; in answered calls, whoever was still ringing.
    const missed = final.answeredAt
      ? stillRinging
      : final.participants.filter((p) => !p.isCaller && (p.status === 'missed' || p.status === 'forwarded')).map((p) => p.userId);
    await Promise.all(missed.map((id) => this.notifyMissed(final, id)));
    await this.postSummary(final);

    const info = toCallInfo(final);
    const voicemailFor = this.voicemailTarget(final);
    for (const p of final.participants) {
      const event: CallEndedEvent = { call: info, voicemailFor: p.isCaller && voicemailFor ? voicemailFor : null };
      this.realtime.toUsers([p.userId], WS_EVENTS.callEnded, event);
    }
    return final;
  }

  /** The person a caller can leave a voicemail for: the callee of an unanswered 1:1 call. */
  private voicemailTarget(call: CallRow) {
    if (call.answeredAt || !['missed', 'declined'].includes(call.status) || call.endReason === 'cancelled') return null;
    if (call.conversation && call.conversation.type !== 'direct') return null;
    const callees = call.participants.filter((p) => !p.isCaller && !p.forwardedForId);
    return callees.length === 1 ? toCallUser(callees[0].user) : null;
  }

  /** "Call ended · 3m 12s" / "Missed call from …" in the chat the call belongs to. */
  private async postSummary(call: CallRow) {
    if (!call.conversationId) return;
    const video = call.kind === 'video';
    const body = call.answeredAt
      ? `${video ? 'Video call' : 'Call'} ended · ${formatDuration(callDurationSec(call.answeredAt, call.endedAt))}`
      : `Missed ${call.conversation?.type === 'group' ? 'group ' : ''}${video ? 'video ' : ''}call from ${call.startedBy.displayName}`;
    const message = await this.prisma.message.create({
      data: { conversationId: call.conversationId, authorId: call.startedById, type: 'system', body },
      include: MESSAGE_INCLUDE,
    });
    await this.prisma.conversation.update({ where: { id: call.conversationId }, data: { lastMessageAt: message.createdAt } });
    const members = await this.prisma.conversationMember.findMany({ where: { conversationId: call.conversationId }, select: { userId: true } });
    this.realtime.toUsers(members.map((m) => m.userId), WS_EVENTS.messageNew, toMessageInfo(message, this.storage));
  }

  private async notifyMissed(call: CallRow, userId: string) {
    const n = await this.prisma.notification.create({
      data: { userId, type: 'missed_call', actorId: call.startedById, conversationId: call.conversationId, preview: `Missed ${call.kind} call` },
      include: NOTIFICATION_INCLUDE,
    });
    this.realtime.toUsers([userId], WS_EVENTS.notificationNew, toActivityItem(n));
  }

  private async markLeft(callId: string, userId: string) {
    await this.prisma.callParticipant.update({
      where: { callId_userId: { callId, userId } },
      data: { status: 'left', leftAt: new Date(), onHold: false },
    });
    await this.presence.clearInCall(userId, callId);
  }

  /** Hangs up any other call the user is connected to (one call at a time). */
  private async leaveOtherCalls(userId: string, exceptCallId?: string) {
    const rows = await this.prisma.callParticipant.findMany({
      where: { userId, status: 'joined', call: { status: { in: ACTIVE } }, ...(exceptCallId ? { callId: { not: exceptCallId } } : {}) },
      select: { callId: true },
    });
    for (const r of rows) await this.leave(userId, r.callId);
  }

  private async usersInCalls(userIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.callParticipant.findMany({
      where: { userId: { in: userIds }, status: 'joined', call: { status: { in: ACTIVE } } },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private async joinInfo(call: CallRow, userId: string): Promise<CallJoinInfo> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, displayName: true } });
    return { call: toCallInfo(call), url: this.livekit.publicUrl, token: await this.livekit.token(call.roomName, user) };
  }

  private load(callId: string): Promise<CallRow> {
    return this.prisma.call.findUnique({ where: { id: callId }, include: CALL_INCLUDE }).then((c) => {
      if (!c) throw new NotFoundException('Call not found');
      return c;
    });
  }

  private requireParticipant(call: CallRow, userId: string) {
    const p = call.participants.find((x) => x.userId === userId);
    if (!p) throw new NotFoundException('Call not found');
    return p;
  }

  private async memberConversation(me: string, id: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id }, include: { members: { select: { userId: true } } } });
    if (!conversation || !conversation.members.some((m) => m.userId === me)) throw new NotFoundException('Chat not found');
    return conversation;
  }

  /** The 1:1 chat between two people, created if needed (same key scheme as the chat module). */
  private async directConversation(a: string, b: string) {
    if (a === b) throw new BadRequestException("You can't call yourself");
    await this.assertActiveUsers([b]);
    const directKey = [a, b].sort().join(':');
    const include = { members: { select: { userId: true } } } satisfies Prisma.ConversationInclude;
    const existing = await this.prisma.conversation.findUnique({ where: { directKey }, include });
    if (existing) return existing;
    try {
      return await this.prisma.conversation.create({
        data: { type: 'direct', directKey, createdById: a, members: { create: [a, b].map((userId) => ({ userId, lastReadAt: new Date() })) } },
        include,
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      return this.prisma.conversation.findUniqueOrThrow({ where: { directKey }, include });
    }
  }

  private async ownVoicemail(me: string, id: string) {
    const vm = await this.prisma.voicemail.findUnique({ where: { id } });
    if (!vm || vm.userId !== me) throw new NotFoundException('Voicemail not found');
    return vm;
  }

  private async assertActiveUsers(ids: string[]) {
    if (!ids.length) return;
    const count = await this.prisma.user.count({ where: { id: { in: ids }, isActive: true } });
    if (count !== new Set(ids).size) throw new BadRequestException('Some people could not be found');
  }

  /** Runs state changes for one call one at a time. */
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}
