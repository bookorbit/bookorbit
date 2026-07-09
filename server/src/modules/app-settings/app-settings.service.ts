import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AuthorAutoEnrichmentWriteMode,
  type DefaultLibraryAccessConfig,
  DEFAULT_DOWNLOAD_PATTERN,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  DEFAULT_METADATA_SCORE_WEIGHTS,
  type MetadataScoreWeights,
  type BookDockAutoFinalizeMetadataMode,
} from '@bookorbit/types';

import {
  APP_SETTING_KEYS,
  DEFAULT_LIBRARY_ACCESS_CONFIG,
  DEFAULT_OIDC_CONFIG,
  type OidcFullConfig,
} from '../../common/constants/app-settings.constants';
import { ensureSafeUrl } from '../../common/utils/ssrf.utils';
import { AppSettingsRepository } from './app-settings.repository';

const OIDC_TEST_TIMEOUT_MS = 10_000;

function parseSafe<T>(key: string, val: string | undefined, fallback: T, logger: Logger): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    logger.warn(`[app-settings.parse] [fail] key=${key} error="invalid JSON stored" - falling back to defaults`);
    return fallback;
  }
}

function parseBooleanSetting(value: string | undefined, defaultValue: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
}

@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);

  constructor(
    private readonly repo: AppSettingsRepository,
    private readonly config: ConfigService,
  ) {}

  listSettings() {
    return this.repo.listPublic();
  }

  async getValue(key: string): Promise<string | null> {
    const row = await this.repo.findByKey(key);
    return row?.value ?? null;
  }

  async setValue(key: string, value: string): Promise<void> {
    await this.repo.upsert(key, value);
  }

  async update(key: string, value: string) {
    if (key === APP_SETTING_KEYS.MAX_UPLOAD_SIZE_MB) {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new BadRequestException('Upload size limit must be an integer greater than 0');
      }
    }
    const setting = await this.repo.updateByKey(key, value);
    if (!setting) throw new NotFoundException(`Setting '${key}' not found`);
    return setting;
  }

  async isBookDockAutoFetchEnabled(): Promise<boolean> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.BOOK_DOCK_AUTO_FETCH_METADATA);
    return parseBooleanSetting(row?.value, true);
  }

  async isBookDockPaused(): Promise<boolean> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.BOOK_DOCK_PAUSED);
    return parseBooleanSetting(row?.value, false);
  }

  async setBookDockPaused(paused: boolean): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.BOOK_DOCK_PAUSED, String(paused));
  }

  async getAuthorsAutoEnrichmentWriteMode(): Promise<AuthorAutoEnrichmentWriteMode> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_WRITE_MODE);
    const mode = row?.value?.trim();
    if (mode === AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH) return mode;
    return AuthorAutoEnrichmentWriteMode.MISSING_ONLY;
  }

  async isAuthorsProviderAudnexusEnabled(): Promise<boolean> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.AUTHORS_PROVIDER_AUDNEXUS_ENABLED);
    return parseBooleanSetting(row?.value, true);
  }

  async getOidcConfig(): Promise<OidcFullConfig> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.OIDC_CONFIG);
    const stored = parseSafe<Partial<OidcFullConfig>>(APP_SETTING_KEYS.OIDC_CONFIG, row?.value, {}, this.logger);
    return mergeOidcConfig(DEFAULT_OIDC_CONFIG, stored);
  }

  async getUploadPattern(): Promise<string> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.UPLOAD_FILE_PATTERN);
    return row?.value ?? DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE;
  }

  async setUploadPattern(pattern: string): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.UPLOAD_FILE_PATTERN, pattern);
  }

  async getUploadPatternBookPerFolder(): Promise<string> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.UPLOAD_FILE_PATTERN_BOOK_PER_FOLDER);
    return row?.value ?? DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER;
  }

  async setUploadPatternBookPerFolder(pattern: string): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.UPLOAD_FILE_PATTERN_BOOK_PER_FOLDER, pattern);
  }

  async getDownloadPattern(): Promise<string> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.DOWNLOAD_FILE_PATTERN);
    return row?.value ?? DEFAULT_DOWNLOAD_PATTERN;
  }

  async setDownloadPattern(pattern: string): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.DOWNLOAD_FILE_PATTERN, pattern);
  }

  async isCrossPlatformPathSanitizationEnabled(): Promise<boolean> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.CROSS_PLATFORM_PATH_SANITIZATION_ENABLED);
    return parseBooleanSetting(row?.value, true);
  }

  async setCrossPlatformPathSanitizationEnabled(enabled: boolean): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.CROSS_PLATFORM_PATH_SANITIZATION_ENABLED, String(enabled));
  }

  async updateOidcConfig(config: Partial<OidcFullConfig>): Promise<OidcFullConfig> {
    const current = await this.getOidcConfig();
    const merged = mergeOidcConfig(current, config);
    await this.repo.upsert(APP_SETTING_KEYS.OIDC_CONFIG, JSON.stringify(merged));
    return merged;
  }

  async getDefaultLibraryAccess(): Promise<DefaultLibraryAccessConfig> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.DEFAULT_LIBRARY_ACCESS);
    const stored = parseSafe<unknown>(APP_SETTING_KEYS.DEFAULT_LIBRARY_ACCESS, row?.value, DEFAULT_LIBRARY_ACCESS_CONFIG, this.logger);
    const normalized = normalizeDefaultLibraryAccess(stored);
    if (normalized.libraryIds.length === 0) return normalized;
    const existingIds = await this.repo.findExistingLibraryIds(normalized.libraryIds);
    return { libraryIds: normalized.libraryIds.filter((id) => existingIds.includes(id)) };
  }

  async getDefaultLibraryAccessLibraryIds(): Promise<number[]> {
    return (await this.getDefaultLibraryAccess()).libraryIds;
  }

  async setDefaultLibraryAccess(config: DefaultLibraryAccessConfig): Promise<DefaultLibraryAccessConfig> {
    const normalized = normalizeDefaultLibraryAccess(config);
    await this.assertKnownLibraryIds(normalized.libraryIds);
    await this.repo.upsert(APP_SETTING_KEYS.DEFAULT_LIBRARY_ACCESS, JSON.stringify(normalized));
    return normalized;
  }

  private async assertKnownLibraryIds(libraryIds: number[]): Promise<void> {
    if (libraryIds.length === 0) return;
    const existingIds = await this.repo.findExistingLibraryIds(libraryIds);
    const existingSet = new Set(existingIds);
    const missing = libraryIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown library IDs: ${missing.join(', ')}`);
    }
  }

  async testOidcConnection(issuerUri?: string): Promise<{
    success: boolean;
    issuer?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    userinfoEndpoint?: string;
    jwksUri?: string;
    supportedScopes?: string[];
    supportedGrantTypes?: string[];
    codeChallengeMethodsSupported?: string[];
    backchannelLogoutSupported?: boolean;
    error?: string;
  }> {
    const uri = issuerUri || (await this.getOidcConfig()).issuerUri;
    if (!uri) {
      throw new BadRequestException('Issuer URI is not configured');
    }

    const isProduction = this.config.get<string>('app.nodeEnv') === 'production';
    const allowPrivateOidcIssuers = !isProduction || this.config.get<boolean>('app.oidcAllowLocalIssuers') === true;
    const parsedIssuer = await ensureSafeUrl(uri, { allowLocal: allowPrivateOidcIssuers, allowPrivate: allowPrivateOidcIssuers });
    const normalizedIssuer = parsedIssuer.href.replace(/\/$/, '');
    const discoveryUrl = `${normalizedIssuer}/.well-known/openid-configuration`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OIDC_TEST_TIMEOUT_MS);

    const start = Date.now();
    try {
      const res = await fetch(discoveryUrl, { signal: controller.signal, redirect: 'manual' });
      if (!res.ok) {
        throw new BadRequestException(`Provider returned HTTP ${res.status}`);
      }
      const json: unknown = await res.json();
      if (!isOidcDiscoveryDoc(json)) {
        throw new BadRequestException('Provider returned an invalid discovery document');
      }
      this.logger.log(`[app-settings.oidc_test] [end] issuerUri=${uri} durationMs=${Date.now() - start} - OIDC connection test succeeded`);
      return {
        success: true,
        issuer: json.issuer,
        authorizationEndpoint: json.authorization_endpoint,
        tokenEndpoint: (json as Record<string, unknown>).token_endpoint as string | undefined,
        userinfoEndpoint: (json as Record<string, unknown>).userinfo_endpoint as string | undefined,
        jwksUri: (json as Record<string, unknown>).jwks_uri as string | undefined,
        supportedScopes: (json as Record<string, unknown>).scopes_supported as string[] | undefined,
        supportedGrantTypes: (json as Record<string, unknown>).grant_types_supported as string[] | undefined,
        codeChallengeMethodsSupported: (json as Record<string, unknown>).code_challenge_methods_supported as string[] | undefined,
        backchannelLogoutSupported: (json as Record<string, unknown>).backchannel_logout_supported as boolean | undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `[app-settings.oidc_test] [fail] issuerUri=${uri} durationMs=${durationMs} errorClass=${errorClass} error="${message}" - OIDC test rejected by provider`,
        );
        throw err;
      }
      this.logger.warn(
        `[app-settings.oidc_test] [fail] issuerUri=${uri} durationMs=${durationMs} errorClass=${errorClass} error="${message}" - OIDC connection test failed`,
      );
      throw new BadRequestException(`OIDC connection test failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAutoFinalizeSettings(): Promise<{
    enabled: boolean;
    threshold: number;
    libraryId: number | null;
    folderId: number | null;
    metadataMode: BookDockAutoFinalizeMetadataMode;
  }> {
    const keys = [
      APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_ENABLED,
      APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_THRESHOLD,
      APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_LIBRARY_ID,
      APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_FOLDER_ID,
      APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_METADATA_MODE,
    ];
    const rows = await this.repo.findMany(keys);
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const libVal = map.get(APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_LIBRARY_ID);
    const folderVal = map.get(APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_FOLDER_ID);
    const libId = libVal ? parseInt(libVal, 10) : null;
    const folderId = folderVal ? parseInt(folderVal, 10) : null;

    return {
      enabled: parseBooleanSetting(map.get(APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_ENABLED), false),
      threshold: parseInt(map.get(APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_THRESHOLD) ?? '85', 10),
      libraryId: libId && !isNaN(libId) ? libId : null,
      folderId: folderId && !isNaN(folderId) ? folderId : null,
      metadataMode: parseAutoFinalizeMetadataMode(map.get(APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_METADATA_MODE)),
    };
  }

  async getMetadataScoreWeights(): Promise<MetadataScoreWeights> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.METADATA_SCORE_WEIGHTS);
    const stored = parseSafe<Partial<MetadataScoreWeights>>(APP_SETTING_KEYS.METADATA_SCORE_WEIGHTS, row?.value, {}, this.logger);
    return { ...DEFAULT_METADATA_SCORE_WEIGHTS, ...stored };
  }

  async setMetadataScoreWeights(weights: MetadataScoreWeights): Promise<MetadataScoreWeights> {
    await this.repo.upsert(APP_SETTING_KEYS.METADATA_SCORE_WEIGHTS, JSON.stringify(weights));
    return weights;
  }

  async isUpdateCheckEnabled(): Promise<boolean> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.UPDATE_CHECK_ENABLED);
    return parseBooleanSetting(row?.value, true);
  }

  async getMaxUploadSizeMb(): Promise<number> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.MAX_UPLOAD_SIZE_MB);
    const size = row?.value ? parseInt(row.value, 10) : 500;
    return isNaN(size) || size <= 0 ? 500 : size;
  }
}

function parseAutoFinalizeMetadataMode(value: string | undefined): BookDockAutoFinalizeMetadataMode {
  if (value === 'fetched_only' || value === 'embedded_only') return value;
  return 'safe_merge';
}

function mergeOidcConfig(base: OidcFullConfig, patch: Partial<OidcFullConfig>): OidcFullConfig {
  return {
    ...base,
    ...patch,
    claimMapping: { ...base.claimMapping, ...(patch.claimMapping ?? {}) },
    autoProvision: { ...base.autoProvision, ...(patch.autoProvision ?? {}) },
  };
}

function normalizeDefaultLibraryAccess(value: unknown): DefaultLibraryAccessConfig {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { libraryIds?: unknown }).libraryIds)) {
    return { ...DEFAULT_LIBRARY_ACCESS_CONFIG };
  }

  const libraryIds = (value as { libraryIds: unknown[] }).libraryIds.filter(
    (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
  );
  return { libraryIds: Array.from(new Set(libraryIds)) };
}

function isOidcDiscoveryDoc(val: unknown): val is { issuer: string; authorization_endpoint: string } {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Record<string, unknown>)['issuer'] === 'string' &&
    typeof (val as Record<string, unknown>)['authorization_endpoint'] === 'string'
  );
}
