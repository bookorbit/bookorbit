import { parseIntoClientConfig } from 'pg-connection-string';
import { z } from 'zod';

function isValidPostgresConnectionString(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    return false;
  }

  try {
    parseIntoClientConfig(value);
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().refine(isValidPostgresConnectionString, 'DATABASE_URL must be a valid PostgreSQL connection string').optional(),
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
  BOOK_DOCK_PATH: z
    .string()
    .transform((val) => val.trim())
    .optional(),
  FILE_WRITE_DEBOUNCE_MS: z.coerce.number().int().positive().optional(),
  FILE_WRITE_MAX_CONCURRENT_WRITES: z.coerce.number().int().positive().optional(),
  CLIENT_URL: z.string().url().optional(),
  APP_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.string().optional(),
  EMAIL_ENCRYPTION_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  OIDC_ALLOW_LOCAL_ISSUERS: z
    .string()
    .trim()
    .toLowerCase()
    .refine((val) => ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(val), {
      message: 'OIDC_ALLOW_LOCAL_ISSUERS must be one of true/false/1/0/yes/no/on/off',
    })
    .optional(),
  CSP_ALLOW_CLOUDFLARE_INSIGHTS: z
    .string()
    .trim()
    .toLowerCase()
    .refine((val) => ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(val), {
      message: 'CSP_ALLOW_CLOUDFLARE_INSIGHTS must be one of true/false/1/0/yes/no/on/off',
    })
    .optional(),
  KOBO_CLOUDSCRAPER_PYTHON: z
    .string()
    .transform((val) => val.trim())
    .optional(),
  GITHUB_RELEASES_REPO: z
    .string()
    .transform((val) => val.trim())
    .optional(),
  GITHUB_RELEASES_TOKEN: z
    .string()
    .transform((val) => val.trim())
    .optional(),
  KOREADER_PLUGIN_PATH: z
    .string()
    .transform((val) => val.trim())
    .optional(),
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
