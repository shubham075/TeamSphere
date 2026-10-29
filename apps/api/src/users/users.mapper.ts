import type { User } from '@prisma/client';
import type { PublicUser } from '@teamsphere/shared';

/**
 * Avatars are stored at `avatars/<userId>/<random token>`; the token in the URL acts as a capability (unguessable,
 * changes with every upload) so `<img>` tags can load it without an auth header and browsers can cache it forever.
 */
export const avatarUrl = (u: { id: string; avatarKey: string | null }) =>
  u.avatarKey ? `/api/users/${u.id}/avatar?v=${u.avatarKey.slice(u.avatarKey.lastIndexOf('/') + 1)}` : null;

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: avatarUrl(u),
    jobTitle: u.jobTitle,
    department: u.department,
    office: u.office,
    phone: u.phone,
    role: u.role,
    authProvider: u.authProvider,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  };
}
