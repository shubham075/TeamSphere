import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Socket } from 'socket.io';
import * as Y from 'yjs';
import { COLLAB_WS_EVENTS, CollabDocKind, CollabJoinResult, CollabRole } from '@teamsphere/shared';
import { RealtimeService } from '../realtime/realtime.service';

/** Debounce for writing a document after edits. */
const SAVE_MS = 2_000;
/** Access is re-checked at most this often per socket and document. */
const RECHECK_MS = 30_000;
const MAX_UPDATE_BYTES = 512 * 1024;

/** What an app (Pages, Boards…) plugs in: who may open a document, and how it is stored. */
export interface CollabProvider {
  kind: CollabDocKind;
  access(userId: string, id: string): Promise<CollabRole | null>;
  load(id: string): Promise<Uint8Array | null>;
  /** `editorId` is the last person whose update is in this save. */
  save(id: string, state: Uint8Array, doc: Y.Doc, editorId: string | null): Promise<void>;
}

const room = (key: string) => `collab:${key}`;
type Ack = (r: CollabJoinResult) => void;

/**
 * Generic Yjs co-editing over the existing authenticated Socket.IO connection, generalizing the meeting whiteboard:
 * one in-memory document per open item, updates relayed to the item's room, debounced saves through the provider,
 * dropped from memory once nobody has it open. Viewers receive updates but their own are ignored.
 */
@Injectable()
export class CollabService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CollabService.name);
  private readonly providers = new Map<CollabDocKind, CollabProvider>();
  private readonly docs = new Map<string, { doc: Y.Doc; timer: NodeJS.Timeout | null; editorId: string | null }>();

  constructor(private readonly realtime: RealtimeService) {}

  register(provider: CollabProvider) {
    this.providers.set(provider.kind, provider);
  }

  onApplicationBootstrap() {
    const attach = () => {
      if (!this.realtime.server) return void setTimeout(attach, 500);
      this.realtime.server.on('connection', (socket: Socket) => this.bind(socket));
    };
    attach();
  }

  async onModuleDestroy() {
    for (const key of [...this.docs.keys()]) await this.save(key);
  }

  /** Disconnects everyone from a deleted item and forgets it without saving. */
  forget(kind: CollabDocKind, id: string) {
    const key = `${kind}:${id}`;
    const entry = this.docs.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    entry?.doc.destroy();
    this.docs.delete(key);
    this.realtime.server?.in(room(key)).socketsLeave(room(key));
  }

  /** Saves pending edits now (e.g. before reading `text` for a list). */
  async flush(kind: CollabDocKind, id: string) {
    const key = `${kind}:${id}`;
    if (this.docs.get(key)?.timer) await this.save(key);
  }

  private parse(key: unknown): { provider: CollabProvider; id: string; key: string } | null {
    if (typeof key !== 'string' || key.length > 100) return null;
    const [kind, id] = key.split(':');
    const provider = this.providers.get(kind as CollabDocKind);
    return provider && id ? { provider, id, key } : null;
  }

  private bind(socket: Socket) {
    const checked = new Map<string, { at: number; role: CollabRole }>();
    const roleFor = async (key: unknown) => {
      const userId = (socket.data as { userId?: string } | undefined)?.userId;
      const target = this.parse(key);
      if (!userId || !target) return null;
      const cached = checked.get(target.key);
      if (cached && Date.now() - cached.at < RECHECK_MS) return { userId, role: cached.role, ...target };
      const role = await target.provider.access(userId, target.id).catch(() => null);
      if (!role) {
        checked.delete(target.key);
        void socket.leave(room(target.key));
        return null;
      }
      checked.set(target.key, { at: Date.now(), role });
      return { userId, role, ...target };
    };

    socket.on(COLLAB_WS_EVENTS.join, async (body: { doc?: string }, ack?: Ack) => {
      if (typeof ack !== 'function') return;
      const access = await roleFor(body?.doc);
      if (!access) return ack({ ok: false, error: 'You can’t open this item' });
      const doc = await this.doc(access.key, access.provider, access.id);
      await socket.join(room(access.key));
      ack({ ok: true, state: Y.encodeStateAsUpdate(doc), readOnly: access.role === 'view' });
    });

    socket.on(COLLAB_WS_EVENTS.update, async (body: { doc?: string; update?: Uint8Array | ArrayBuffer }) => {
      const key = body?.doc;
      if (typeof key !== 'string' || !socket.rooms.has(room(key)) || !body.update || body.update.byteLength > MAX_UPDATE_BYTES) return;
      const access = await roleFor(key);
      if (!access || access.role === 'view') return;
      const update = new Uint8Array(body.update as ArrayBuffer);
      try {
        Y.applyUpdate(await this.doc(key, access.provider, access.id), update);
      } catch {
        return; // malformed update: drop it
      }
      socket.to(room(key)).emit(COLLAB_WS_EVENTS.update, { doc: key, update });
      this.scheduleSave(key, access.userId);
    });

    // Cursors and selections: relayed only, never stored.
    socket.on(COLLAB_WS_EVENTS.awareness, (body: { doc?: string; update?: Uint8Array }) => {
      const key = body?.doc;
      if (typeof key !== 'string' || !socket.rooms.has(room(key)) || !body.update || body.update.byteLength > 64 * 1024) return;
      socket.to(room(key)).emit(COLLAB_WS_EVENTS.awareness, { doc: key, update: body.update });
    });

    socket.on(COLLAB_WS_EVENTS.leave, (body: { doc?: string }) => {
      if (typeof body?.doc === 'string') void socket.leave(room(body.doc));
    });
  }

  private async doc(key: string, provider: CollabProvider, id: string): Promise<Y.Doc> {
    const cached = this.docs.get(key);
    if (cached) return cached.doc;
    const state = await provider.load(id);
    // Another join may have loaded it while we waited.
    const again = this.docs.get(key);
    if (again) return again.doc;
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, state);
    this.docs.set(key, { doc, timer: null, editorId: null });
    return doc;
  }

  private scheduleSave(key: string, editorId: string) {
    const entry = this.docs.get(key);
    if (!entry) return;
    entry.editorId = editorId;
    if (entry.timer) return;
    entry.timer = setTimeout(() => void this.save(key).catch((e) => this.logger.warn(`collab save ${key}: ${e}`)), SAVE_MS);
  }

  private async save(key: string) {
    const entry = this.docs.get(key);
    const target = this.parse(key);
    if (!entry || !target) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    await target.provider.save(target.id, Y.encodeStateAsUpdate(entry.doc), entry.doc, entry.editorId);
    if (!this.realtime.server?.sockets.adapter.rooms.get(room(key))?.size) {
      entry.doc.destroy();
      this.docs.delete(key);
    }
  }
}
