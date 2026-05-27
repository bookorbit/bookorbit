import { registerAs } from '@nestjs/config';
import { resolve } from 'path';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  version: process.env.APP_VERSION ?? 'Local build',
  oidcAllowLocalIssuers: parseBooleanFlag(process.env.OIDC_ALLOW_LOCAL_ISSUERS, false),
}));

export const dbConfig = registerAs('db', () => ({
  url: process.env.DATABASE_URL ?? 'postgres://bookorbit:bookorbit@localhost:5432/bookorbit',
}));

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  setupBootstrapToken: process.env.SETUP_BOOTSTRAP_TOKEN ?? '',
}));

export const storageConfig = registerAs('storage', () => ({
  appDataPath: resolve(process.env.APP_DATA_PATH ?? '/data'),
}));

export const fileWriteConfig = registerAs('fileWrite', () => ({
  debounceMs: parsePositiveInteger(process.env.FILE_WRITE_DEBOUNCE_MS, 3_000),
  maxConcurrentWrites: parsePositiveInteger(process.env.FILE_WRITE_MAX_CONCURRENT_WRITES, 2),
}));

export const emailConfig = registerAs('email', () => ({
  encryptionKey: process.env.EMAIL_ENCRYPTION_KEY ?? '',
}));

export const migrationConfig = registerAs('migration', () => ({
  encryptionKey: process.env.MIGRATION_ENCRYPTION_KEY ?? '',
}));

export const oidcRuntimeConfig = registerAs('oidcRuntime', () => ({
  stateTtlMs: parsePositiveInteger(process.env.OIDC_STATE_TTL_SECS, 300) * 1000,
  discoveryCacheTtlMs: parsePositiveInteger(process.env.OIDC_DISCOVERY_CACHE_TTL_SECS, 3600) * 1000,
  jwksCacheTtlMs: parsePositiveInteger(process.env.OIDC_JWKS_CACHE_TTL_SECS, 21600) * 1000,
  clockToleranceSecs: parsePositiveInteger(process.env.OIDC_CLOCK_TOLERANCE_SECS, 30),
  tokenExchangeTimeoutMs: parsePositiveInteger(process.env.OIDC_TOKEN_EXCHANGE_TIMEOUT_MS, 10_000),
}));

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
