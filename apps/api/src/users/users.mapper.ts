import type { User } from '@prisma/client';
import type { PublicUser } from '@teamsphere/shared';

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarKey ? `/api/users/${u.id}/avatar` : null,
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
