import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:4001'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6380'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  S3_ENDPOINT: z.string().url().default('http://127.0.0.1:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default('teamsphere'),

  ENTRA_ENABLED: bool,
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_REDIRECT_URI: z.string().optional(),

  LDAP_ENABLED: bool,
  LDAP_LABEL: z.string().default('Company directory'),
  LDAP_URL: z.string().optional(),
  LDAP_BIND_DN: z.string().optional(),
  LDAP_BIND_PASSWORD: z.string().optional(),
  LDAP_BASE_DN: z.string().optional(),
  LDAP_USER_FILTER: z.string().default('(&(objectClass=user)(sAMAccountName={{username}}))'),
  LDAP_ADMIN_GROUP_DN: z.string().optional(),
  LDAP_TLS_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  LINK_PREVIEWS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Allow previews of intranet links (private IP ranges). Off by default so chat links can't probe internal services. */
  LINK_PREVIEW_ALLOW_PRIVATE: bool,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: Record<string, unknown> = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.ENTRA_ENABLED) {
    for (const key of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI'] as const) {
      if (!env[key]) throw new Error(`ENTRA_ENABLED=true requires ${key}`);
    }
  }
  if (env.LDAP_ENABLED) {
    for (const key of ['LDAP_URL', 'LDAP_BIND_DN', 'LDAP_BIND_PASSWORD', 'LDAP_BASE_DN'] as const) {
      if (!env[key]) throw new Error(`LDAP_ENABLED=true requires ${key}`);
    }
  }
  return env;
}
