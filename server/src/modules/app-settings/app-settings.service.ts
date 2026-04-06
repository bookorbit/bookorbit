import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  AuthorAutoEnrichmentWriteMode,
  DEFAULT_DOWNLOAD_PATTERN,
  DEFAULT_UPLOAD_PATTERN,
  DEFAULT_METADATA_SCORE_WEIGHTS,
  type MetadataScoreWeights,
  type BookBucketAutoFinalizeMetadataMode,
} from '@projectx/types';

import { APP_SETTING_KEYS, DEFAULT_OIDC_CONFIG, type OidcFullConfig } from '../../common/constants/app-settings.constants';
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

  constructor(private readonly repo: AppSettingsRepository) {}

  listSettings() {
    return this.repo.listPublic();
  }

  async getValue(key: string): Promise<string | null> {
    const row = await this.repo.findByKey(key);
    return row?.value ?? null;
  }

  async update(key: string, value: string) {
    const setting = await this.repo.updateByKey(key, value);
    if (!setting) throw new NotFoundException(`Setting '${key}' not found`);
    return setting;
  }

  async isBookBucketAutoFetchEnabled(): Promise<boolean> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FETCH_METADATA);
    return parseBooleanSetting(row?.value, true);
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
    return row?.value ?? DEFAULT_UPLOAD_PATTERN;
  }

  async setUploadPattern(pattern: string): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.UPLOAD_FILE_PATTERN, pattern);
  }

  async getDownloadPattern(): Promise<string> {
    const row = await this.repo.findByKey(APP_SETTING_KEYS.DOWNLOAD_FILE_PATTERN);
    return row?.value ?? DEFAULT_DOWNLOAD_PATTERN;
  }

  async setDownloadPattern(pattern: string): Promise<void> {
    await this.repo.upsert(APP_SETTING_KEYS.DOWNLOAD_FILE_PATTERN, pattern);
  }

  async updateOidcConfig(config: Partial<OidcFullConfig>): Promise<OidcFullConfig> {
    const current = await this.getOidcConfig();
    const merged = mergeOidcConfig(current, config);
    await this.repo.upsert(APP_SETTING_KEYS.OIDC_CONFIG, JSON.stringify(merged));
    return merged;
  }

  async testOidcConnection(issuerUri?: string): Promise<{ success: boolean; issuer?: string; authorizationEndpoint?: string; error?: string }> {
    const uri = issuerUri || (await this.getOidcConfig()).issuerUri;
    if (!uri) {
      throw new BadRequestException('Issuer URI is not configured');
    }

    const url = `${uri.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OIDC_TEST_TIMEOUT_MS);

    const start = Date.now();
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new BadRequestException(`Provider returned HTTP ${res.status}`);
      }
      const json: unknown = await res.json();
      if (!isOidcDiscoveryDoc(json)) {
        throw new BadRequestException('Provider returned an invalid discovery document');
      }
      this.logger.log(`[app-settings.oidc_test] [end] issuerUri=${uri} durationMs=${Date.now() - start} - OIDC connection test succeeded`);
      return { success: true, issuer: json.issuer, authorizationEndpoint: json.authorization_endpoint };
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
    metadataMode: BookBucketAutoFinalizeMetadataMode;
  }> {
    const keys = [
      APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_ENABLED,
      APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_THRESHOLD,
      APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_LIBRARY_ID,
      APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_FOLDER_ID,
      APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_METADATA_MODE,
    ];
    const rows = await this.repo.findMany(keys);
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const libVal = map.get(APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_LIBRARY_ID);
    const folderVal = map.get(APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_FOLDER_ID);
    const libId = libVal ? parseInt(libVal, 10) : null;
    const folderId = folderVal ? parseInt(folderVal, 10) : null;

    return {
      enabled: parseBooleanSetting(map.get(APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_ENABLED), false),
      threshold: parseInt(map.get(APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_THRESHOLD) ?? '85', 10),
      libraryId: libId && !isNaN(libId) ? libId : null,
      folderId: folderId && !isNaN(folderId) ? folderId : null,
      metadataMode: parseAutoFinalizeMetadataMode(map.get(APP_SETTING_KEYS.BOOK_BUCKET_AUTO_FINALIZE_METADATA_MODE)),
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
}

function parseAutoFinalizeMetadataMode(value: string | undefined): BookBucketAutoFinalizeMetadataMode {
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

function isOidcDiscoveryDoc(val: unknown): val is { issuer: string; authorization_endpoint: string } {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Record<string, unknown>)['issuer'] === 'string' &&
    typeof (val as Record<string, unknown>)['authorization_endpoint'] === 'string'
  );
}
