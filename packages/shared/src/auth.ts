import { z } from 'zod';

export const AUTH_PROVIDERS = ['local', 'entra', 'ldap'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const USER_ROLES = ['admin', 'user', 'guest'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Password login. `provider` picks the TeamSphere account store or the company directory (AD/LDAP). */
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
  provider: z.enum(['local', 'ldap']).default('local'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore');

export const passwordSchema = z.string().min(8).max(256);

export const createUserSchema = z.object({
  username: usernameSchema,
  email: z.email().optional(),
  displayName: z.string().trim().min(1).max(128),
  password: passwordSchema,
  role: z.enum(USER_ROLES).default('user'),
  jobTitle: z.string().max(128).optional(),
  department: z.string().max(128).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(128).optional(),
  jobTitle: z.string().max(128).nullable().optional(),
  department: z.string().max(128).nullable().optional(),
  office: z.string().max(128).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.email().nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  department: string | null;
  office: string | null;
  phone: string | null;
  role: UserRole;
  authProvider: AuthProvider;
  isActive: boolean;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

/** Which login methods the server has enabled; drives the login screen. */
export interface AuthProvidersInfo {
  local: boolean;
  ldap: { enabled: boolean; label: string };
  entra: { enabled: boolean; label: string };
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
