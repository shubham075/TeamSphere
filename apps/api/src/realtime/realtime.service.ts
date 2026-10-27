import { Global, Injectable, Module } from '@nestjs/common';
import type { Server } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

/** Emits Socket.IO events to users. The gateway attaches the server instance once it starts. */
@Injectable()
export class RealtimeService {
  server: Server | null = null;

  toUsers(userIds: Iterable<string>, event: string, payload: unknown) {
    if (!this.server) return;
    const rooms = [...new Set(userIds)].map(userRoom);
    if (rooms.length) this.server.to(rooms).emit(event, payload);
  }

  toAll(event: string, payload: unknown) {
    this.server?.emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeCoreModule {}
