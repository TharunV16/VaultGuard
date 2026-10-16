// @ts-check
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  CLIENT_ORIGIN: z
    .string()
    .url('CLIENT_ORIGIN must be a URL')
    .default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(isProd ? 64 : 1, 'JWT_ACCESS_SECRET must be ≥ 64 chars in production'),
  SERVER_ENCRYPTION_KEY: z
    .string()
    .min(1, 'SERVER_ENCRYPTION_KEY is required')
    .refine(
      (v) => {
        try {
          const buf = Buffer.from(v, 'base64');
          return buf.length === 32;
        } catch {
          return false;
        }
      },
      'SERVER_ENCRYPTION_KEY must be base64 of exactly 32 bytes'
    ),
  DECOY_SECRET: z
    .string()
    .min(isProd ? 32 : 1, 'DECOY_SECRET must be ≥ 32 chars in production'),
  RP_ID: z.string().default(process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'),
  RP_NAME: z.string().default('VaultGuard'),
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z
    .string()
    .transform((s) => s.replace(/^["']|["']$/g, ''))
    .default('VaultGuard <no-reply@vaultguard.local>'),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  const errs = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
  process.stderr.write(`[config] Invalid environment variables:\n${errs}\n`);
  process.exit(1);
}

export const config = result.data;
