import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { guestRouteAllowed } from '../meetings/advanced.logic';
import { AuthUser, GUEST_ALLOWED, IS_PUBLIC, ROLES } from './auth.decorators';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  sid: string;
}

/**
 * Global guard: requires a valid `Authorization: Bearer <access token>` unless the route is @Public().
 * Also checks the session is still live, so revoking a session or deactivating a user takes effect at once.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true, user: { select: { isActive: true, role: true, guestMeetingId: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException();
    }

    const guestOk = this.reflector.getAllAndOverride<boolean>(GUEST_ALLOWED, [ctx.getHandler(), ctx.getClass()]) ?? false;
    if (!guestRouteAllowed(session.user, guestOk)) throw new ForbiddenException('Guests can only use the meeting they joined');
    req.user = { id: payload.sub, role: session.user.role, sessionId: payload.sid, guestMeetingId: session.user.guestMeetingId } satisfies AuthUser;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
