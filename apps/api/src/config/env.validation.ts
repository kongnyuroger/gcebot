import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),

  MOMO_API_USER: z.string().min(1),
  MOMO_API_KEY: z.string().min(1),

  // Signs both the short-lived TOTP tempToken and the 4h admin session JWT -
  // a separate secret from anything WhatsApp/payment-related, so rotating it
  // can never affect the student-facing bot.
  ADMIN_JWT_SECRET: z.string().min(32),
  // The admin portal (apps/admin) runs on its own origin - its browser-side
  // fetch() calls (e.g. the login page's direct call to /admin/auth/login,
  // before any session/token exists to attach) need this API's CORS policy
  // to explicitly allow it, or the browser blocks the response outright.
  ADMIN_PORTAL_URL: z.string().url().default('http://localhost:3001'),

  SENTRY_DSN: z.string().url().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}
