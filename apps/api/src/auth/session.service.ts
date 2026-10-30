import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import type { AuthResponse } from '@teamsphere/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../common/guards';
import { toPublicUser } from '../users/users.mapper';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface IssuedSession extends AuthResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Sessions = one row per signed-in device. The refresh token is random, stored only as a hash,
 * and rotated on every refresh. Access tokens are short-lived JWTs carrying the session id.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(user: User, client: { ip: string | null; userAgent: string | null }): Promise<IssuedSession> {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();
    const session = await this.prisma.session.create({
      data: { userId: user.id, refreshTokenHash: sha256(refreshToken), expiresAt, ...client },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return {
      accessToken: await this.signAccess(user, session.id),
      user: toPublicUser(user),
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  async rotate(refreshToken: string): Promise<IssuedSession> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Session expired');
    }
    const next = randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: sha256(next), lastUsedAt: new Date(), expiresAt },
    });
    return {
      accessToken: await this.signAccess(session.user, session.id),
      user: toPublicUser(session.user),
      refreshToken: next,
      refreshExpiresAt: expiresAt,
    };
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count > 0;
  }

  async revokeAll(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Session for an anonymous meeting guest: no refresh token (so a signed-in user's cookie in the same browser is
   * left alone); the access token lives as long as the session instead.
   */
  async createGuest(user: User, client: { ip: string | null; userAgent: string | null }, hours: number): Promise<{ accessToken: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    const session = await this.prisma.session.create({
      data: { userId: user.id, refreshTokenHash: sha256(randomBytes(48).toString('base64url')), expiresAt, ...client },
    });
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, sid: session.id };
    return { accessToken: await this.jwt.signAsync(payload, { expiresIn: `${hours}h` }), expiresAt };
  }

  listActive(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  private signAccess(user: User, sid: string) {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, sid };
    return this.jwt.signAsync(payload);
  }

  private refreshExpiry() {
    return new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
