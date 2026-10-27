import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TypingEvent, WS_EVENTS } from '@teamsphere/shared';
import type { AccessTokenPayload } from '../common/guards';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { RealtimeService, userRoom } from './realtime.service';

interface SocketData {
  userId: string;
  displayName: string;
}

/**
 * Authenticated with the access token in the handshake (`auth: { token }`), not cookies,
 * so any origin may connect without CSRF risk.
 */
@WebSocketGateway({ cors: { origin: true }, pingInterval: 20_000, pingTimeout: 20_000 })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server) {
    this.realtime.server = server;
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('no token');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { revokedAt: true, expiresAt: true, user: { select: { id: true, isActive: true, displayName: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
        throw new Error('session ended');
      }
      (client.data as SocketData) = { userId: session.user.id, displayName: session.user.displayName };
      await client.join(userRoom(session.user.id));
      await this.presence.connected(session.user.id);
    } catch {
      client.emit('auth_error');
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const { userId } = (client.data ?? {}) as Partial<SocketData>;
    if (userId) await this.presence.disconnected(userId).catch((e) => this.logger.error(e));
  }

  @SubscribeMessage(WS_EVENTS.typing)
  async onTyping(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string }) {
    const { userId, displayName } = client.data as SocketData;
    if (!userId || typeof body?.conversationId !== 'string') return;
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: body.conversationId },
      select: { userId: true },
    });
    if (!members.some((m) => m.userId === userId)) return;
    const event: TypingEvent = { conversationId: body.conversationId, userId, displayName };
    this.realtime.toUsers(
      members.map((m) => m.userId).filter((id) => id !== userId),
      WS_EVENTS.typing,
      event,
    );
  }
}
