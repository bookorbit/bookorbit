import { parseIntoClientConfig } from 'pg-connection-string';
import { isAbsolute } from 'node:path';
import { isIP } from 'node:net';
import { z } from 'zod';

import { APP_FEATURES } from '@bookorbit/types';

import { DEV_CLIENT_ORIGIN } from './dev-client-origin';

const BOOLEAN_ENV_VALUES = ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'];
const TRUST_PROXY_BOOLEAN_VALUES = ['true', 'false', 'yes', 'no', 'on', 'off'];

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

function booleanEnvFlag(name: string) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((val) => BOOLEAN_ENV_VALUES.includes(val), {
      message: `${name} must be one of ${BOOLEAN_ENV_VALUES.join('/')}`,
    })
    .optional();
}

function trustProxyEnv() {
  return z
    .string()
    .trim()
    .refine((value) => value === '' || TRUST_PROXY_BOOLEAN_VALUES.includes(value.toLowerCase()) || Number.isNaN(Number(value)), {
      message: 'TRUST_PROXY must be a boolean value or trusted proxy IP/CIDR; numeric hop counts are not supported',
    })
    .optional();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z
    .string()
    .trim()
    .refine((value) => value === '' || isIP(value) !== 0, 'HOST must be an IPv4 or IPv6 address without a port or brackets')
    .optional(),
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
  DISABLE_LOCAL_AUTH: booleanEnvFlag('DISABLE_LOCAL_AUTH'),
  APP_DATA_PATH: z.string().default('/data'),
  COVER_SLOTS_BACKFILL_MODE: z.enum(['background', 'sync', 'skip']).optional(),
  BOOK_DOCK_PATH: z
    .string()
    .transform((val) => val.trim())
    .optional(),
  LIBRARY_BROWSE_ROOT: z
    .string()
    .transform((val) => val.trim())
    .optional(),
  FILE_WRITE_DEBOUNCE_MS: z.coerce.number().int().positive().optional(),
  FILE_WRITE_MAX_CONCURRENT_WRITES: z.coerce.number().int().positive().optional(),
  AUDIOLESS_EPUB_MAX_CONCURRENT_BUILDS: z.coerce.number().int().positive().max(32).optional(),
  AUDIOLESS_EPUB_MAX_SOURCE_ENTRIES: z.coerce.number().int().positive().optional(),
  AUDIOLESS_EPUB_MAX_METADATA_BYTES: z.coerce.number().int().positive().optional(),
  AUDIOLESS_EPUB_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().optional(),
  CLIENT_URL: z.string().url().optional(),
  APP_URL: z.string().url().default(DEV_CLIENT_ORIGIN),
  TRUST_PROXY: trustProxyEnv(),
  EMAIL_ENCRYPTION_KEY: z.string().optional(),
  MIGRATION_ENCRYPTION_KEY: z.string().optional(),
  BOOK_REQUEST_ENCRYPTION_KEY: z.string().optional(),
  MIGRATION_IMPORT_ROOT: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val === '' || isAbsolute(val), 'MIGRATION_IMPORT_ROOT must be an absolute path')
    .optional(),
  PODCAST_ENCRYPTION_KEY: z.string().trim().min(16).optional(),
  PODCAST_MAX_FEED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024)
    .optional(),
  PODCAST_MAX_EPISODE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024 * 1024)
    .optional(),
  PODCAST_MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().positive().max(32).optional(),
  PODCAST_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(10 * 60_000)
    .optional(),
  PODCAST_MAX_DOWNLOAD_DURATION_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60_000)
    .optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  OIDC_ALLOW_LOCAL_ISSUERS: booleanEnvFlag('OIDC_ALLOW_LOCAL_ISSUERS'),
  CSP_ALLOW_CLOUDFLARE_INSIGHTS: booleanEnvFlag('CSP_ALLOW_CLOUDFLARE_INSIGHTS'),
  SWAGGER_ENABLED: booleanEnvFlag('SWAGGER_ENABLED'),
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
  // Only gate startup on the key once podcast controllers are actually registered. Requiring it
  // while the feature is off turns every existing deployment's upgrade into a boot failure for a
  // feature its users cannot reach, and podcastConfig already falls back when it is absent.
  if (APP_FEATURES.podcasts && result.data.NODE_ENV === 'production' && !result.data.PODCAST_ENCRYPTION_KEY) {
    throw new Error('Environment validation failed:\n  PODCAST_ENCRYPTION_KEY: PODCAST_ENCRYPTION_KEY is required in production');
  }
  return result.data;
}
