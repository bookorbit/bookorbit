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
  booksPath: process.env.BOOKS_PATH ?? '/data',
  stagingPath: process.env.STAGING_PATH,
}));

export const emailConfig = registerAs('email', () => ({
  encryptionKey: process.env.EMAIL_ENCRYPTION_KEY ?? '',
}));
