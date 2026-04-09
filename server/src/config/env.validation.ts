import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').optional(),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters')
    .refine(
      (val) => process.env.NODE_ENV !== 'production' || val !== 'change-me-in-production',
      'JWT_SECRET must be changed from the default value in production',
    ),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  SETUP_BOOTSTRAP_TOKEN: z.string().optional(),
  APP_DATA_PATH: z.string().default('/data'),
  FILE_WRITE_DEBOUNCE_MS: z.coerce.number().int().positive().optional(),
  FILE_WRITE_MAX_CONCURRENT_WRITES: z.coerce.number().int().positive().optional(),
  CLIENT_URL: z.string().url().optional(),
  APP_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.string().optional(),
  EMAIL_ENCRYPTION_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  if (result.data.NODE_ENV === 'production' && !result.data.SETUP_BOOTSTRAP_TOKEN?.trim()) {
    throw new Error('Environment validation failed:\n  SETUP_BOOTSTRAP_TOKEN: SETUP_BOOTSTRAP_TOKEN is required in production');
  }
  return result.data;
}
