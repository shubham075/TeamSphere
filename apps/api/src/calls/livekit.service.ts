import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccessToken, RoomServiceClient, WebhookEvent, WebhookReceiver } from 'livekit-server-sdk';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** Tokens are only needed to connect; LiveKit refreshes them itself while the client stays connected. */
const TOKEN_TTL = '4h';

/** Thin wrapper around the LiveKit server SDK: access tokens, room admin and webhook verification. */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  /** URL clients connect to. */
  readonly publicUrl: string;
  private readonly rooms: RoomServiceClient;
  private readonly receiver: WebhookReceiver;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.publicUrl = env.LIVEKIT_PUBLIC_URL || env.LIVEKIT_URL;
    // The room service speaks HTTP (Twirp) on the same port as the WebSocket signalling.
    const httpUrl = env.LIVEKIT_URL.replace(/^ws(s?):/, 'http$1:');
    this.rooms = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    this.receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  /** A token that lets one user publish and subscribe in one room. Identity = user id, so webhooks map back to users. */
  token(roomName: string, user: { id: string; displayName: string }): Promise<string> {
    const at = new AccessToken(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET, {
      identity: user.id,
      name: user.displayName,
      ttl: TOKEN_TTL,
    });
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    return at.toJwt();
  }

  /** Identities currently in the room; empty when the room doesn't exist; null when LiveKit can't be reached. */
  async participantIds(roomName: string): Promise<string[] | null> {
    try {
      return (await this.rooms.listParticipants(roomName)).map((p) => p.identity);
    } catch (e) {
      const err = e as { status?: number; code?: string };
      if (err.status === 404 || err.code === 'not_found') return [];
      this.logger.warn(`LiveKit unreachable: ${e}`);
      return null;
    }
  }

  /** Disconnects everyone still in the room (e.g. "end call for everyone"). */
  async closeRoom(roomName: string) {
    await this.rooms.deleteRoom(roomName).catch(() => undefined);
  }

  /** Verifies the webhook's signed Authorization header against the raw body; throws if it doesn't match. */
  receive(rawBody: string, authHeader: string | undefined): Promise<WebhookEvent> {
    return this.receiver.receive(rawBody, authHeader);
  }
}
