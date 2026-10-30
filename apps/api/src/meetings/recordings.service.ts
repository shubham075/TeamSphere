import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, type WebhookEvent } from 'livekit-server-sdk';
import { MeetingActivityEvent, RecordingInfo, WS_EVENTS } from '@teamsphere/shared';
import { toCallUser } from '../calls/calls.mapper';
import { LivekitService } from '../calls/livekit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { StorageService } from '../infra/storage';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { isRecordingExpired, recordingExpiry, recordingKey, recordingStatusFromEgress } from './advanced.logic';

/** How often running recordings are checked with Egress (webhooks may not reach this API) and expired ones purged. */
const SWEEP_MS = 30_000;

/**
 * Meeting recordings through LiveKit Egress (room composite → MP4 uploaded straight to S3). The Egress service is
 * optional in dev (heavy image); without it starting a recording fails with a clear message.
 */
@Injectable()
export class RecordingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly egress: EgressClient;
  private timer: NodeJS.Timeout | null = null;
  /** Called when a recording stops by itself (egress ended/failed) so the live meeting state drops the indicator. */
  onStopped: (meetingId: string, recordingId: string) => void = () => undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly livekit: LivekitService,
    private readonly realtime: RealtimeService,
  ) {
    this.egress = new EgressClient(env.LIVEKIT_URL.replace(/^ws(s?):/, 'http$1:'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  onModuleInit() {
    this.livekit.onWebhookEvent((e) => this.onWebhook(e));
    if (process.env.VITEST) return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`recordings sweep: ${e}`)), SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async start(meetingId: string, sessionId: string, roomName: string, startedById: string) {
    const now = new Date();
    const row = await this.prisma.recording.create({
      data: { meetingId, sessionId, startedById, storageKey: '', startedAt: now, expiresAt: recordingExpiry(now, this.env.RECORDING_RETENTION_DAYS) },
    });
    const key = recordingKey(meetingId, row.id);
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: key,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: this.env.S3_ACCESS_KEY, secret: this.env.S3_SECRET_KEY, bucket: this.env.S3_BUCKET, region: this.env.S3_REGION,
          endpoint: this.env.EGRESS_S3_ENDPOINT ?? this.env.S3_ENDPOINT, forcePathStyle: true,
        }),
      },
    });
    try {
      const info = await this.egress.startRoomCompositeEgress(roomName, output, { layout: 'grid' });
      const rec = await this.prisma.recording.update({ where: { id: row.id }, data: { egressId: info.egressId, storageKey: key } });
      this.changed(meetingId);
      return rec;
    } catch (e) {
      await this.prisma.recording.delete({ where: { id: row.id } });
      this.logger.warn(`egress start failed: ${e}`);
      throw new ServiceUnavailableException('Recording isn’t available on this server right now');
    }
  }

  /** Stops the egress; the file finishes uploading in the background (status → processing → ready). */
  async stop(recordingId: string) {
    const rec = await this.prisma.recording.findUnique({ where: { id: recordingId } });
    if (!rec || rec.status !== 'recording') return;
    await this.prisma.recording.update({ where: { id: rec.id }, data: { status: 'processing', endedAt: new Date() } });
    if (rec.egressId) await this.egress.stopEgress(rec.egressId).catch((e) => this.logger.warn(`egress stop: ${e}`));
    this.changed(rec.meetingId);
  }

  async list(meetingId: string): Promise<RecordingInfo[]> {
    const rows = await this.prisma.recording.findMany({ where: { meetingId, expiresAt: { gt: new Date() } }, orderBy: { startedAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.startedById) } }, select: { id: true, displayName: true, avatarKey: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id, status: r.status, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
      durationSec: r.durationSec, size: r.size === null ? null : Number(r.size), expiresAt: r.expiresAt.toISOString(),
      startedBy: toCallUser(byId.get(r.startedById) ?? { id: r.startedById, displayName: 'Unknown user', avatarKey: null }),
      url: r.status === 'ready' ? `/api/meetings/recordings/${r.id}/content?${this.storage.sign(`rec:${r.id}`)}` : null,
    }));
  }

  verifyUrl(id: string, exp: string | undefined, sig: string | undefined) {
    return this.storage.verify(`rec:${id}`, exp, sig);
  }

  async content(id: string) {
    const rec = await this.prisma.recording.findUnique({ where: { id } });
    if (!rec || rec.status !== 'ready' || isRecordingExpired(rec)) return null;
    return rec;
  }

  object(key: string) {
    return this.storage.get(key);
  }

  range(key: string, range: string) {
    return this.storage.getRange(key, range);
  }

  async onWebhook(event: WebhookEvent) {
    const info = event.egressInfo;
    if (!info?.egressId || !event.event.startsWith('egress_')) return;
    await this.applyEgress(info.egressId, info.status, info);
  }

  /** Syncs running recordings with Egress and deletes expired recordings (row + file). */
  async sweep(now = new Date()) {
    const running = await this.prisma.recording.findMany({ where: { status: { in: ['recording', 'processing'] }, egressId: { not: null } } });
    for (const r of running) {
      const [info] = await this.egress.listEgress({ egressId: r.egressId! }).catch(() => []);
      if (info) await this.applyEgress(r.egressId!, info.status, info);
    }
    const expired = await this.prisma.recording.findMany({ where: { expiresAt: { lte: now } }, take: 100 });
    for (const r of expired) {
      if (r.storageKey) await this.storage.remove(r.storageKey);
      await this.prisma.recording.delete({ where: { id: r.id } });
      this.changed(r.meetingId);
    }
    return expired.length;
  }

  private async applyEgress(egressId: string, status: number, info: { fileResults?: { size?: bigint; duration?: bigint }[]; error?: string }) {
    const next = recordingStatusFromEgress(status);
    const rec = await this.prisma.recording.findUnique({ where: { egressId } });
    if (!next || !rec || rec.status === next || rec.status === 'ready' || rec.status === 'failed') return;
    const file = info.fileResults?.[0];
    await this.prisma.recording.update({
      where: { id: rec.id },
      data: {
        status: next, endedAt: rec.endedAt ?? new Date(), error: next === 'failed' ? (info.error || 'Recording failed') : null,
        // Egress reports duration in nanoseconds.
        ...(file?.size ? { size: file.size } : {}), ...(file?.duration ? { durationSec: Number(file.duration / 1_000_000_000n) } : {}),
      },
    });
    if (rec.status === 'recording') this.onStopped(rec.meetingId, rec.id);
    this.changed(rec.meetingId);
  }

  /** Everyone related to the meeting refetches its recordings list. */
  private changed(meetingId: string) {
    void this.prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: { select: { userId: true } } } }).then((m) => {
      if (!m) return;
      const event: MeetingActivityEvent = { meetingId, kind: 'recordings' };
      this.realtime.toUsers([m.organizerId, ...m.attendees.map((a) => a.userId)], WS_EVENTS.meetingActivity, event);
    });
  }
}
