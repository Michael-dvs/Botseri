import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(44),
  ENCRYPTION_KEY_PREVIOUS: z.string().min(44).optional(),
  INTERNAL_API_TOKEN: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  SETUP_TOKEN: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url(),
  TZ_DEFAULT: z.string().default('Asia/Jakarta'),
  WAHA_API_KEY: z.string().min(16),
  WAHA_SESSION: z.string().default('default'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
