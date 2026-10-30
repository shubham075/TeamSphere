import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@teamsphere/shared';

export interface AuthUser {
  id: string;
  role: UserRole;
  sessionId: string;
  /** Anonymous meeting guests: the one meeting they may use (see `GuestAllowed`). */
  guestMeetingId: string | null;
}

export const IS_PUBLIC = 'isPublic';
/** Skips the global access-token guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const GUEST_ALLOWED = 'guestAllowed';
/** Lets anonymous meeting guests call this route (they get 403 everywhere else). The service checks the meeting. */
export const GuestAllowed = () => SetMetadata(GUEST_ALLOWED, true);

export const ROLES = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
