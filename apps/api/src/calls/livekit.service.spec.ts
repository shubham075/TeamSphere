import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env';
import { LivekitService } from './livekit.service';

const env = {
  LIVEKIT_URL: 'ws://127.0.0.1:7880',
  LIVEKIT_PUBLIC_URL: 'wss://livekit.company.local',
  LIVEKIT_API_KEY: 'testkey',
  LIVEKIT_API_SECRET: 'test-secret-that-is-at-least-32-chars',
} as Env;

describe('LivekitService', () => {
  const livekit = new LivekitService(env);

  it('hands clients the public URL', () => {
    expect(livekit.publicUrl).toBe('wss://livekit.company.local');
    expect(new LivekitService({ ...env, LIVEKIT_PUBLIC_URL: '' }).publicUrl).toBe('ws://127.0.0.1:7880');
  });

  it('issues a token for exactly one room, with the user id as identity', async () => {
    const token = await livekit.token('call-123', { id: 'user1', displayName: 'Priya Sharma' });
    const claims = decodeJwt(token) as { sub: string; name: string; iss: string; exp: number; video: Record<string, unknown> };
    expect(claims.sub).toBe('user1');
    expect(claims.name).toBe('Priya Sharma');
    expect(claims.iss).toBe('testkey');
    expect(claims.video).toMatchObject({ room: 'call-123', roomJoin: true, canPublish: true, canSubscribe: true });
    expect(claims.video.roomAdmin).toBeUndefined();
    expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(4 * 3600 + 5);
  });

  async function signedWebhook(body: string, secret = env.LIVEKIT_API_SECRET) {
    const at = new AccessToken(env.LIVEKIT_API_KEY, secret);
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return at.toJwt();
  }

  it('accepts webhooks signed with our key', async () => {
    const body = JSON.stringify({ event: 'room_finished', room: { name: 'call-123' }, id: 'EV_1', createdAt: '1' });
    const event = await livekit.receive(body, await signedWebhook(body));
    expect(event.event).toBe('room_finished');
    expect(event.room?.name).toBe('call-123');
  });

  it('rejects webhooks with a tampered body or a foreign signature', async () => {
    const body = JSON.stringify({ event: 'room_finished', room: { name: 'call-123' } });
    const auth = await signedWebhook(body);
    await expect(livekit.receive(body.replace('123', '999'), auth)).rejects.toThrow();
    await expect(livekit.receive(body, await signedWebhook(body, 'another-secret-that-is-32-chars-long!'))).rejects.toThrow();
    await expect(livekit.receive(body, undefined)).rejects.toThrow();
  });
});
