import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { toPlainText, UrgentReminderEvent, WS_EVENTS } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../infra/redis';
import { PresenceService } from '../presence/presence.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatService } from './chat.service';

const TICK_MS = 15_000;
const URGENT_EVERY_MS = 2 * 60 * 1000;
const URGENT_FOR_MS = 20 * 60 * 1000;

/**
 * Background chat jobs on a short interval: scheduled send, urgent-message re-notification and presence broadcasts
 * when a timed status (manual status, status message, out of office) starts or ends.
 * A Redis lock keeps ticks single-run if several API instances are started.
 */
@Injectable()
export class ChatScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = new Date();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly chat: ChatService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const locked = await this.redis.set('chat:scheduler:lock', '1', 'PX', TICK_MS - 1000, 'NX');
      if (!locked) return;
      const now = new Date();
      const since = this.lastTick;
      this.lastTick = now;
      await this.sendDue(now);
      await this.remindUrgent(now);
      await this.presenceTransitions(since, now);
    } catch (e) {
      this.logger.error(`Scheduler tick failed: ${e}`);
    } finally {
      this.running = false;
    }
  }

  private async sendDue(now: Date) {
    const due = await this.prisma.scheduledMessage.findMany({ where: { sendAt: { lte: now } }, orderBy: { sendAt: 'asc' }, take: 50 });
    for (const row of due) {
      try {
        await this.chat.deliverScheduled(row);
      } catch (e) {
        // Usually the author left the chat or the message was emptied; the row is already claimed, so drop it.
        this.logger.warn(`Scheduled message ${row.id} not sent: ${e}`);
      }
    }
  }

  /** Re-notifies recipients who haven't read an urgent message, every 2 minutes for 20 minutes. */
  private async remindUrgent(now: Date) {
    const messages = await this.prisma.message.findMany({
      where: {
        importance: 'urgent',
        type: 'text',
        deletedAt: null,
        createdAt: { gte: new Date(now.getTime() - URGENT_FOR_MS), lte: new Date(now.getTime() - URGENT_EVERY_MS) },
      },
      include: {
        author: { select: { displayName: true } },
        conversation: { select: { members: { select: { userId: true, lastReadAt: true } } } },
      },
      take: 200,
    });
    for (const m of messages) {
      const round = Math.floor((now.getTime() - m.createdAt.getTime()) / URGENT_EVERY_MS);
      const key = `chat:urgent:${m.id}`;
      const last = Number((await this.redis.get(key)) ?? 0);
      if (round <= last) continue;
      await this.redis.set(key, String(round), 'PX', URGENT_FOR_MS + URGENT_EVERY_MS);
      const unread = m.conversation.members
        .filter((x) => x.userId !== m.authorId && (!x.lastReadAt || x.lastReadAt < m.createdAt))
        .map((x) => x.userId);
      if (!unread.length) continue;
      const event: UrgentReminderEvent = {
        conversationId: m.conversationId,
        messageId: m.id,
        authorName: m.author?.displayName ?? 'Someone',
        preview: toPlainText(m.body).slice(0, 200) || 'Sent a file',
      };
      this.realtime.toUsers(unread, WS_EVENTS.messageUrgentReminder, event);
    }
  }

  private async presenceTransitions(since: Date, now: Date) {
    const window = { gt: since, lte: now };
    const users = await this.prisma.user.findMany({
      where: {
        OR: [{ presenceExpiresAt: window }, { statusExpiresAt: window }, { oooStartAt: window, oooEnabled: true }, { oooEndAt: window, oooEnabled: true }],
      },
      select: { id: true },
      take: 500,
    });
    for (const u of users) await this.presence.broadcast(u.id);
  }
}
