import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Socket } from 'socket.io';
import * as Y from 'yjs';
import { WS_EVENTS } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MeetingsService } from './meetings.service';

/** Debounce for writing the document to the database after edits. */
const SAVE_MS = 2_000;
/** Access is re-checked at most this often per socket (removed people lose the board quickly). */
const RECHECK_MS = 30_000;
const MAX_UPDATE_BYTES = 512 * 1024;

const room = (meetingId: string) => `wb:${meetingId}`;
type Ack = (r: { ok: true; state?: Uint8Array } | { ok: false; error: string }) => void;

/**
 * Meeting whiteboard: a Yjs document per meeting, synced over the existing authenticated Socket.IO connection
 * (no extra service or port) and saved to `MeetingWhiteboard`. Only people who may use the meeting can join.
 */
@Injectable()
export class WhiteboardService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WhiteboardService.name);
  private readonly docs = new Map<string, { doc: Y.Doc; timer: NodeJS.Timeout | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly meetings: MeetingsService,
  ) {}

  onApplicationBootstrap() {
    const attach = () => {
      if (!this.realtime.server) return void setTimeout(attach, 500);
      this.realtime.server.on('connection', (socket: Socket) => this.bind(socket));
    };
    attach();
  }

  async onModuleDestroy() {
    for (const id of [...this.docs.keys()]) await this.save(id);
  }

  private bind(socket: Socket) {
    const checked = new Map<string, number>();
    const allowed = async (meetingId: unknown): Promise<string | null> => {
      const userId = (socket.data as { userId?: string } | undefined)?.userId;
      if (!userId || typeof meetingId !== 'string') return null;
      if (Date.now() - (checked.get(meetingId) ?? 0) < RECHECK_MS) return userId;
      try {
        const { m } = await this.meetings.access(userId, meetingId);
        if (!this.meetings.optionsOf(m).allowWhiteboard) return null;
      } catch {
        checked.delete(meetingId);
        void socket.leave(room(meetingId));
        return null;
      }
      checked.set(meetingId, Date.now());
      return userId;
    };

    socket.on(WS_EVENTS.whiteboardJoin, async (body: { meetingId?: string }, ack?: Ack) => {
      if (typeof ack !== 'function') return;
      if (!(await allowed(body?.meetingId))) return ack({ ok: false, error: 'You can’t open this whiteboard' });
      const doc = await this.doc(body.meetingId!);
      await socket.join(room(body.meetingId!));
      ack({ ok: true, state: Y.encodeStateAsUpdate(doc) });
    });

    socket.on(WS_EVENTS.whiteboardUpdate, async (body: { meetingId?: string; update?: Uint8Array | ArrayBuffer }) => {
      const meetingId = body?.meetingId;
      if (!meetingId || !socket.rooms.has(room(meetingId)) || !body.update || body.update.byteLength > MAX_UPDATE_BYTES) return;
      if (!(await allowed(meetingId))) return;
      const update = new Uint8Array(body.update as ArrayBuffer);
      try {
        Y.applyUpdate(await this.doc(meetingId), update);
      } catch {
        return; // malformed update: drop it
      }
      socket.to(room(meetingId)).emit(WS_EVENTS.whiteboardUpdate, { meetingId, update });
      this.scheduleSave(meetingId);
    });

    // Cursor/selection presence: relayed only, never stored.
    socket.on(WS_EVENTS.whiteboardAwareness, (body: { meetingId?: string; update?: Uint8Array }) => {
      const meetingId = body?.meetingId;
      if (!meetingId || !socket.rooms.has(room(meetingId)) || !body.update || body.update.byteLength > 64 * 1024) return;
      socket.to(room(meetingId)).emit(WS_EVENTS.whiteboardAwareness, { meetingId, update: body.update });
    });

    socket.on(WS_EVENTS.whiteboardLeave, (body: { meetingId?: string }) => {
      if (typeof body?.meetingId === 'string') void socket.leave(room(body.meetingId));
    });
  }

  private async doc(meetingId: string): Promise<Y.Doc> {
    const cached = this.docs.get(meetingId);
    if (cached) return cached.doc;
    const doc = new Y.Doc();
    const row = await this.prisma.meetingWhiteboard.findUnique({ where: { meetingId } });
    // Another join may have loaded it while we waited.
    const again = this.docs.get(meetingId);
    if (again) return again.doc;
    if (row) Y.applyUpdate(doc, new Uint8Array(row.state));
    this.docs.set(meetingId, { doc, timer: null });
    return doc;
  }

  private scheduleSave(meetingId: string) {
    const entry = this.docs.get(meetingId);
    if (!entry || entry.timer) return;
    entry.timer = setTimeout(() => void this.save(meetingId).catch((e) => this.logger.warn(`whiteboard save: ${e}`)), SAVE_MS);
  }

  /** Writes the document; drops it from memory once nobody has it open. */
  private async save(meetingId: string) {
    const entry = this.docs.get(meetingId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    const state = Buffer.from(Y.encodeStateAsUpdate(entry.doc));
    await this.prisma.meetingWhiteboard.upsert({ where: { meetingId }, create: { meetingId, state }, update: { state } });
    if (!this.realtime.server?.sockets.adapter.rooms.get(room(meetingId))?.size) {
      entry.doc.destroy();
      this.docs.delete(meetingId);
    }
  }
}
