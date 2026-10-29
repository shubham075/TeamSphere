import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PresenceInfo, PresenceStatus, WS_EVENTS } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../infra/redis';
import { RealtimeService } from '../realtime/realtime.service';

const connKey = (userId: string) => `presence:conns:${userId}`;
/** Set while the user is connected to a call (value: call id). Maintained by CallsService. */
const inCallKey = (userId: string) => `presence:incall:${userId}`;

interface PresenceFields {
  id: string;
  presenceStatus: string | null;
  presenceExpiresAt: Date | null;
  statusMessage: string | null;
  statusExpiresAt: Date | null;
  oooEnabled: boolean;
  oooMessage: string | null;
  oooStartAt: Date | null;
  oooEndAt: Date | null;
}

export function isOutOfOffice(u: Pick<PresenceFields, 'oooEnabled' | 'oooStartAt' | 'oooEndAt'>, now = new Date()) {
  return u.oooEnabled && (!u.oooStartAt || u.oooStartAt <= now) && (!u.oooEndAt || u.oooEndAt > now);
}

/**
 * A manual status wins while it hasn't expired; otherwise online → available, no connections → offline.
 * Out of office shows over everything except "Appear offline", so colleagues see it even when the person is online.
 * Being in a call shows "In a call" over everything except Do not disturb and Appear offline.
 */
export function computePresence(u: PresenceFields, online: boolean, now = new Date(), inCall = false): PresenceInfo {
  const manual = u.presenceStatus && (!u.presenceExpiresAt || u.presenceExpiresAt > now) ? u.presenceStatus : null;
  const message = u.statusMessage && (!u.statusExpiresAt || u.statusExpiresAt > now) ? u.statusMessage : null;
  const ooo = isOutOfOffice(u, now);
  let status: PresenceStatus = online ? 'available' : 'offline';
  if (manual && online) status = manual as PresenceStatus;
  else if (manual === 'offline') status = 'offline';
  if (ooo && manual !== 'offline') status = 'ooo';
  if (inCall && status !== 'dnd' && status !== 'offline') status = 'in_call';
  return {
    userId: u.id,
    status,
    statusMessage: message,
    statusExpiresAt: message ? (u.statusExpiresAt?.toISOString() ?? null) : null,
    presenceExpiresAt: manual ? (u.presenceExpiresAt?.toISOString() ?? null) : null,
    outOfOffice: ooo ? { message: u.oooMessage, until: u.oooEndAt?.toISOString() ?? null } : null,
  };
}

export const PRESENCE_SELECT = {
  id: true,
  presenceStatus: true,
  presenceExpiresAt: true,
  statusMessage: true,
  statusExpiresAt: true,
  oooEnabled: true,
  oooMessage: true,
  oooStartAt: true,
  oooEndAt: true,
} as const;

/**
 * Tracks live socket connections per user in Redis and broadcasts presence changes.
 * (Single API instance for now; with several instances, swap the startup reset for per-instance keys.)
 */
@Injectable()
export class PresenceService implements OnModuleInit {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
  ) {}

  async onModuleInit() {
    // Connections from a previous run are gone; clear their counters. (CallsService restores in-call flags.)
    try {
      for (const pattern of ['presence:conns:*', 'presence:incall:*']) {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
          cursor = next;
          if (keys.length) await this.redis.del(...keys);
        } while (cursor !== '0');
      }
    } catch (e) {
      this.logger.error(`Could not reset presence counters: ${e}`);
    }
  }

  async connected(userId: string) {
    if ((await this.redis.incr(connKey(userId))) === 1) await this.broadcast(userId);
  }

  async disconnected(userId: string) {
    const left = await this.redis.decr(connKey(userId));
    if (left <= 0) {
      await this.redis.del(connKey(userId));
      await this.broadcast(userId);
    }
  }

  async getMany(userIds: string[]): Promise<Map<string, PresenceInfo>> {
    const ids = [...new Set(userIds)];
    const result = new Map<string, PresenceInfo>();
    if (!ids.length) return result;
    const [users, counts, calls] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: PRESENCE_SELECT }),
      this.redis.mget(ids.map(connKey)),
      this.redis.mget(ids.map(inCallKey)),
    ]);
    const online = new Set(ids.filter((_, i) => Number(counts[i] ?? 0) > 0));
    const inCall = new Set(ids.filter((_, i) => !!calls[i]));
    for (const u of users) result.set(u.id, computePresence(u, online.has(u.id), new Date(), inCall.has(u.id)));
    return result;
  }

  async get(userId: string): Promise<PresenceInfo> {
    return (
      (await this.getMany([userId])).get(userId) ?? {
        userId,
        status: 'offline',
        statusMessage: null,
        statusExpiresAt: null,
        presenceExpiresAt: null,
        outOfOffice: null,
      }
    );
  }

  async isInCall(userId: string) {
    return !!(await this.redis.get(inCallKey(userId)));
  }

  /** Marks the user as in a call (or not) and broadcasts the change. */
  async setInCall(userId: string, callId: string | null) {
    const was = await this.redis.get(inCallKey(userId));
    if (callId) await this.redis.set(inCallKey(userId), callId);
    else await this.redis.del(inCallKey(userId));
    if (!!was !== !!callId) await this.broadcast(userId);
  }

  /** Clears "In a call" only if it still refers to this call (the user may already be in the next one, e.g. after a transfer). */
  async clearInCall(userId: string, callId: string) {
    if ((await this.redis.get(inCallKey(userId))) === callId) await this.setInCall(userId, null);
  }

  async broadcast(userId: string) {
    this.realtime.toAll(WS_EVENTS.presenceChanged, await this.get(userId));
  }
}
