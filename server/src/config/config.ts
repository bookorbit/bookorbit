import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
}));

export const dbConfig = registerAs('db', () => ({
  url: process.env.DATABASE_URL ?? 'postgres://projectx:projectx@localhost:5432/projectx',
}));

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  setupBootstrapToken: process.env.SETUP_BOOTSTRAP_TOKEN ?? '',
}));

export const storageConfig = registerAs('storage', () => ({
  appDataPath: process.env.APP_DATA_PATH ?? '/data',
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}
