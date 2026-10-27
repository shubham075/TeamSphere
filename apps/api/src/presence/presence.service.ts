import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PresenceInfo, PresenceStatus, WS_EVENTS } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../infra/redis';
import { RealtimeService } from '../realtime/realtime.service';

const connKey = (userId: string) => `presence:conns:${userId}`;

interface PresenceFields {
  id: string;
  presenceStatus: string | null;
  presenceExpiresAt: Date | null;
  statusMessage: string | null;
  statusExpiresAt: Date | null;
}

/** A manual status wins while it hasn't expired; otherwise online → available, no connections → offline. */
export function computePresence(u: PresenceFields, online: boolean, now = new Date()): PresenceInfo {
  const manual = u.presenceStatus && (!u.presenceExpiresAt || u.presenceExpiresAt > now) ? u.presenceStatus : null;
  const message = u.statusMessage && (!u.statusExpiresAt || u.statusExpiresAt > now) ? u.statusMessage : null;
  let status: PresenceStatus = online ? 'available' : 'offline';
  if (manual && online) status = manual as PresenceStatus;
  else if (manual === 'offline') status = 'offline';
  return { userId: u.id, status, statusMessage: message };
}

const PRESENCE_SELECT = {
  id: true,
  presenceStatus: true,
  presenceExpiresAt: true,
  statusMessage: true,
  statusExpiresAt: true,
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
    // Connections from a previous run are gone; clear their counters.
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'presence:conns:*', 'COUNT', 500);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
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
    const [users, counts] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: PRESENCE_SELECT }),
      this.redis.mget(ids.map(connKey)),
    ]);
    const online = new Set(ids.filter((_, i) => Number(counts[i] ?? 0) > 0));
    for (const u of users) result.set(u.id, computePresence(u, online.has(u.id)));
    return result;
  }

  async get(userId: string): Promise<PresenceInfo> {
    return (await this.getMany([userId])).get(userId) ?? { userId, status: 'offline', statusMessage: null };
  }

  async broadcast(userId: string) {
    this.realtime.toAll(WS_EVENTS.presenceChanged, await this.get(userId));
  }
}
