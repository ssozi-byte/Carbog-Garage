import { z } from 'zod'

/**
 * Environment validation — the app refuses to boot with an invalid env.
 * Secrets stay server-side (Spec §36); nothing here is ever shipped to the frontend.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Empty-string or zero PORT is treated as unset (CI/sandbox quirk; use default)
  PORT: z.preprocess(
    (v) => {
      if (v === '' || v == null) return undefined
      if (typeof v === 'string' && v.trim() !== '' && Number(v) === 0) return undefined
      if (typeof v === 'number' && v === 0) return undefined
      return v
    },
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),

  // CORS — explicit allow-list, never "*" in production (Spec §34)
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  EXTRA_CORS_ORIGINS: z.string().optional(), // comma-separated additional origins

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('debug'),

  // Phase 2+ (validated now so prod misconfig fails fast, not at first query)
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://motora:motora@localhost:5432/motora?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-32chars-min'),
  JWT_REFRESH_SECRET: z.string().min(32).default('dev-only-refresh-secret-change-me-32chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Phase 3 auth — encrypts TOTP secrets at rest (AES-256-GCM).
  // Required (≥32 chars) before any MFA enroll/login; optional at boot so
  // non-MFA flows keep working in fresh checkouts.
  MFA_ENCRYPTION_KEY: z.string().optional(),

  // Phase 3 — invite code letting a seeded staff account claim credentials
  // via POST /auth/register { staffInviteCode }. Unset = staff claiming off.
  STAFF_INVITE_CODE: z.string().optional(),

  // Phase 7+ — M-Pesa Daraja (sandbox in dev; never real creds in code, §14/§15)
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().url().optional(),

  // Phase 8+ — notifications
  SMS_API_KEY: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),

  // Phase 5B+ — object storage (S3/MinIO; presigned uploads)
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): Env {
  // Empty-string env vars mean "unset" everywhere (docker/shell convention)
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== ''),
  )
  const parsed = envSchema.safeParse(cleaned)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
