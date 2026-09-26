import { registerAs } from '@nestjs/config';
import { join, resolve } from 'path';

import { DEV_CLIENT_ORIGIN } from './dev-client-origin';
export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST?.trim() || '0.0.0.0',
  appUrl: process.env.APP_URL ?? DEV_CLIENT_ORIGIN,
  // Private-use scheme the iOS app registers with ASWebAuthenticationSession. Compiled into the
  // client binary, so it is the same for every provider on every deployment; configurable only so
  // a rebranded fork can change it.
  nativeRedirectUri: process.env.NATIVE_REDIRECT_URI?.trim() || 'bookorbit://oauth2-callback',
  version: process.env.APP_VERSION ?? 'Local build',
  githubReleasesRepo: process.env.GITHUB_RELEASES_REPO?.trim() || 'bookorbit/bookorbit',
  githubReleasesToken: process.env.GITHUB_RELEASES_TOKEN?.trim() || undefined,
  oidcAllowLocalIssuers: parseBooleanFlag(process.env.OIDC_ALLOW_LOCAL_ISSUERS, false),
  swaggerEnabled: parseBooleanFlag(process.env.SWAGGER_ENABLED, false),
  koboCloudscraperPython: process.env.KOBO_CLOUDSCRAPER_PYTHON?.trim() || undefined,
  koreaderPluginSourcePath: process.env.KOREADER_PLUGIN_PATH?.trim() || undefined,
}));

export const dbConfig = registerAs('db', () => ({
  url: process.env.DATABASE_URL ?? 'postgres://bookorbit:bookorbit@localhost:5432/bookorbit',
}));

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  setupBootstrapToken: process.env.SETUP_BOOTSTRAP_TOKEN ?? '',
  refreshRotationGraceMs: parsePositiveInteger(process.env.AUTH_REFRESH_ROTATION_GRACE_MS, 30_000),
  passwordLoginEnabled: !parseBooleanFlag(process.env.DISABLE_LOCAL_AUTH, false),
}));

export const storageConfig = registerAs('storage', () => {
  const appDataPath = resolve(process.env.APP_DATA_PATH ?? '/data');
  const bookDockPath = process.env.BOOK_DOCK_PATH?.trim();
  const libraryBrowseRoot = process.env.LIBRARY_BROWSE_ROOT?.trim();

  return {
    appDataPath,
    bookDockPath: resolve(bookDockPath || join(appDataPath, 'book-dock')),
    libraryBrowseRoot: resolve(libraryBrowseRoot || '/'),
  };
});

export const coverSlotsConfig = registerAs('coverSlots', () => ({
  backfillMode: process.env.COVER_SLOTS_BACKFILL_MODE?.trim().toLowerCase() || (process.env.NODE_ENV === 'test' ? 'skip' : 'background'),
}));

export const fileWriteConfig = registerAs('fileWrite', () => ({
  debounceMs: parsePositiveInteger(process.env.FILE_WRITE_DEBOUNCE_MS, 3_000),
  maxConcurrentWrites: parsePositiveInteger(process.env.FILE_WRITE_MAX_CONCURRENT_WRITES, 2),
}));

export const audiolessEpubConfig = registerAs('audiolessEpub', () => ({
  maxConcurrentBuilds: parsePositiveInteger(process.env.AUDIOLESS_EPUB_MAX_CONCURRENT_BUILDS, 2),
  maxSourceEntries: parsePositiveInteger(process.env.AUDIOLESS_EPUB_MAX_SOURCE_ENTRIES, 50_000),
  maxMetadataBytes: parsePositiveInteger(process.env.AUDIOLESS_EPUB_MAX_METADATA_BYTES, 16 * 1024 * 1024),
  maxOutputBytes: parsePositiveInteger(process.env.AUDIOLESS_EPUB_MAX_OUTPUT_BYTES, 2 * 1024 * 1024 * 1024),
}));

export const emailConfig = registerAs('email', () => ({
  encryptionKey: process.env.EMAIL_ENCRYPTION_KEY ?? '',
}));

export const migrationConfig = registerAs('migration', () => ({
  encryptionKey: process.env.MIGRATION_ENCRYPTION_KEY ?? '',
  importRoot: process.env.MIGRATION_IMPORT_ROOT?.trim() ? resolve(process.env.MIGRATION_IMPORT_ROOT) : undefined,
}));

/**
 * Download-client and (from phase 3) indexer credentials. Unlike the email and migration keys,
 * `RequestCredentialService` refuses to store a secret when this is unset rather than falling
 * back to plaintext.
 */
export const bookRequestConfig = registerAs('bookRequest', () => ({
  encryptionKey: process.env.BOOK_REQUEST_ENCRYPTION_KEY ?? '',
}));

export const podcastConfig = registerAs('podcast', () => ({
  encryptionKey: process.env.PODCAST_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET || 'change-me-in-production',
  maxFeedBytes: parsePositiveInteger(process.env.PODCAST_MAX_FEED_BYTES, 10 * 1024 * 1024),
  maxEpisodeBytes: parsePositiveInteger(process.env.PODCAST_MAX_EPISODE_BYTES, 2 * 1024 * 1024 * 1024),
  maxConcurrentDownloads: parsePositiveInteger(process.env.PODCAST_MAX_CONCURRENT_DOWNLOADS, 2),
  requestTimeoutMs: parsePositiveInteger(process.env.PODCAST_REQUEST_TIMEOUT_MS, 30_000),
  maxDownloadDurationMs: parsePositiveInteger(process.env.PODCAST_MAX_DOWNLOAD_DURATION_MS, 6 * 60 * 60_000),
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
