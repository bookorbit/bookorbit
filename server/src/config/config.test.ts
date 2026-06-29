import { resolve } from 'path';

import { appConfig, authConfig, dbConfig, emailConfig, fileWriteConfig, migrationConfig, oidcRuntimeConfig, storageConfig } from './config';

const ORIGINAL_ENV = process.env;

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.APP_URL;
  delete process.env.APP_VERSION;
  delete process.env.OIDC_ALLOW_LOCAL_ISSUERS;
  delete process.env.SWAGGER_ENABLED;
  delete process.env.KOBO_CLOUDSCRAPER_PYTHON;
  delete process.env.KOREADER_PLUGIN_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.JWT_REFRESH_EXPIRES_IN;
  delete process.env.SETUP_BOOTSTRAP_TOKEN;
  delete process.env.APP_DATA_PATH;
  delete process.env.BOOK_DOCK_PATH;
  delete process.env.FILE_WRITE_DEBOUNCE_MS;
  delete process.env.FILE_WRITE_MAX_CONCURRENT_WRITES;
  delete process.env.EMAIL_ENCRYPTION_KEY;
  delete process.env.MIGRATION_ENCRYPTION_KEY;
  delete process.env.OIDC_STATE_TTL_SECS;
  delete process.env.OIDC_DISCOVERY_CACHE_TTL_SECS;
  delete process.env.OIDC_JWKS_CACHE_TTL_SECS;
  delete process.env.OIDC_CLOCK_TOLERANCE_SECS;
  delete process.env.OIDC_TOKEN_EXCHANGE_TIMEOUT_MS;
}

describe('config', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses app defaults, including local-build fallback version', () => {
    expect(appConfig()).toEqual({
      nodeEnv: 'development',
      appUrl: 'http://localhost:5173',
      version: 'Local build',
      githubReleasesRepo: 'bookorbit/bookorbit',
      githubReleasesToken: undefined,
      oidcAllowLocalIssuers: false,
      swaggerEnabled: false,
      koboCloudscraperPython: undefined,
      koreaderPluginSourcePath: undefined,
    });
  });

  it('reads app values from environment when provided', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://bookorbit.local';
    process.env.APP_VERSION = 'v2.3.4';
    process.env.OIDC_ALLOW_LOCAL_ISSUERS = 'true';
    process.env.SWAGGER_ENABLED = 'true';
    process.env.KOBO_CLOUDSCRAPER_PYTHON = '/opt/bookorbit-python/bin/python';
    process.env.KOREADER_PLUGIN_PATH = '/opt/koreader/bookorbit.koplugin';
    process.env.GITHUB_RELEASES_REPO = 'acme/app';
    process.env.GITHUB_RELEASES_TOKEN = 'ghp_example';

    expect(appConfig()).toEqual({
      nodeEnv: 'production',
      appUrl: 'https://bookorbit.local',
      version: 'v2.3.4',
      githubReleasesRepo: 'acme/app',
      githubReleasesToken: 'ghp_example',
      oidcAllowLocalIssuers: true,
      swaggerEnabled: true,
      koboCloudscraperPython: '/opt/bookorbit-python/bin/python',
      koreaderPluginSourcePath: '/opt/koreader/bookorbit.koplugin',
    });
  });

  it('falls back to false when OIDC_ALLOW_LOCAL_ISSUERS is invalid', () => {
    process.env.OIDC_ALLOW_LOCAL_ISSUERS = 'maybe';
    expect(appConfig().oidcAllowLocalIssuers).toBe(false);
  });

  it('uses defaults for database, auth, email, and migration config', () => {
    expect(dbConfig().url).toBe('postgres://bookorbit:bookorbit@localhost:5432/bookorbit');
    expect(authConfig()).toEqual({
      jwtSecret: 'change-me-in-production',
      jwtExpiresIn: '15m',
      jwtRefreshExpiresIn: '7d',
      setupBootstrapToken: '',
      refreshRotationGraceMs: 30_000,
    });
    expect(emailConfig().encryptionKey).toBe('');
    expect(migrationConfig().encryptionKey).toBe('');
  });

  it('resolves storage path from APP_DATA_PATH', () => {
    process.env.APP_DATA_PATH = './tmp/bookorbit-data';
    expect(storageConfig().appDataPath).toBe(resolve('./tmp/bookorbit-data'));
    expect(storageConfig().bookDockPath).toBe(resolve('./tmp/bookorbit-data/book-dock'));
  });

  it('falls back storage path to /data when APP_DATA_PATH is not set', () => {
    expect(storageConfig().appDataPath).toBe(resolve('/data'));
    expect(storageConfig().bookDockPath).toBe(resolve('/data/book-dock'));
  });

  it('uses BOOK_DOCK_PATH as the Book Dock storage path when provided', () => {
    process.env.APP_DATA_PATH = '/data';
    process.env.BOOK_DOCK_PATH = '/books/bookdrop';

    expect(storageConfig().bookDockPath).toBe(resolve('/books/bookdrop'));
  });

  it('ignores blank BOOK_DOCK_PATH values from compose defaults', () => {
    process.env.APP_DATA_PATH = '/custom/data';
    process.env.BOOK_DOCK_PATH = '';

    expect(storageConfig().bookDockPath).toBe(resolve('/custom/data/book-dock'));
  });

  it('parses positive integers for file-write config and floors decimal values', () => {
    process.env.FILE_WRITE_DEBOUNCE_MS = '1234.99';
    process.env.FILE_WRITE_MAX_CONCURRENT_WRITES = '4.2';

    expect(fileWriteConfig()).toEqual({
      debounceMs: 1234,
      maxConcurrentWrites: 4,
    });
  });

  it('uses file-write fallbacks for zero, negatives, NaN, and Infinity', () => {
    process.env.FILE_WRITE_DEBOUNCE_MS = '0';
    process.env.FILE_WRITE_MAX_CONCURRENT_WRITES = '-7';
    expect(fileWriteConfig()).toEqual({
      debounceMs: 3000,
      maxConcurrentWrites: 2,
    });

    process.env.FILE_WRITE_DEBOUNCE_MS = 'nope';
    process.env.FILE_WRITE_MAX_CONCURRENT_WRITES = 'Infinity';
    expect(fileWriteConfig()).toEqual({
      debounceMs: 3000,
      maxConcurrentWrites: 2,
    });
  });

  it('computes OIDC runtime values from seconds with millisecond conversion', () => {
    process.env.OIDC_STATE_TTL_SECS = '11';
    process.env.OIDC_DISCOVERY_CACHE_TTL_SECS = '22';
    process.env.OIDC_JWKS_CACHE_TTL_SECS = '33';
    process.env.OIDC_CLOCK_TOLERANCE_SECS = '44';
    process.env.OIDC_TOKEN_EXCHANGE_TIMEOUT_MS = '5555';

    expect(oidcRuntimeConfig()).toEqual({
      stateTtlMs: 11000,
      discoveryCacheTtlMs: 22000,
      jwksCacheTtlMs: 33000,
      clockToleranceSecs: 44,
      tokenExchangeTimeoutMs: 5555,
    });
  });

  it('uses OIDC defaults when values are missing or invalid', () => {
    process.env.OIDC_STATE_TTL_SECS = '';
    process.env.OIDC_DISCOVERY_CACHE_TTL_SECS = '0';
    process.env.OIDC_JWKS_CACHE_TTL_SECS = '-1';
    process.env.OIDC_CLOCK_TOLERANCE_SECS = 'abc';
    process.env.OIDC_TOKEN_EXCHANGE_TIMEOUT_MS = 'Infinity';

    expect(oidcRuntimeConfig()).toEqual({
      stateTtlMs: 300000,
      discoveryCacheTtlMs: 3600000,
      jwksCacheTtlMs: 21600000,
      clockToleranceSecs: 30,
      tokenExchangeTimeoutMs: 10000,
    });
  });
});
