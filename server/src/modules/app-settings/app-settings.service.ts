import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  AuthorAutoEnrichmentWriteMode,
  DEFAULT_UPLOAD_PATTERN,
  DEFAULT_FILE_WRITE_SETTINGS,
  DEFAULT_METADATA_SCORE_WEIGHTS,
  type GlobalFileWriteSettings,
  type MetadataScoreWeights,
  type StagingAutoFinalizeMetadataMode,
} from '@projectx/types';

import { APP_SETTING_KEYS, DEFAULT_OIDC_CONFIG, type OidcFullConfig } from '../../common/constants/app-settings.constants';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
const DEFAULT_DOWNLOAD_PATTERN = '{originalFilename}';

function parseSafe<T>(val: string | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

@Injectable()
export class AppSettingsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db.select().from(schema.appSettings).orderBy(schema.appSettings.key);
  }

  async getValue(key: string): Promise<string | null> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, key) });
    return row?.value ?? null;
  }

  async update(key: string, value: string) {
    const [setting] = await this.db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).returning();

    if (!setting) throw new NotFoundException(`Setting '${key}' not found`);
    return setting;
  }

  async isStagingAutoFetchEnabled(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.STAGING_AUTO_FETCH_METADATA),
    });
    return row?.value !== 'false';
  }

  async isAuthorsAutoEnrichmentEnabled(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_ENABLED),
    });
    return row?.value !== 'false';
  }

  async getAuthorsAutoEnrichmentWriteMode(): Promise<AuthorAutoEnrichmentWriteMode> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_WRITE_MODE),
    });
    const mode = row?.value?.trim();
    if (mode === AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH) return mode;
    return AuthorAutoEnrichmentWriteMode.MISSING_ONLY;
  }

  async isAuthorsProviderAudnexusEnabled(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_PROVIDER_AUDNEXUS_ENABLED),
    });
    return row?.value !== 'false';
  }

  async isAuthorEnrichmentPaused(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_ENRICHMENT_PAUSED),
    });
    return row?.value === 'true';
  }

  async setAuthorEnrichmentPaused(paused: boolean): Promise<void> {
    const value = paused ? 'true' : 'false';
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.AUTHORS_ENRICHMENT_PAUSED, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }

  async getOidcConfig(): Promise<OidcFullConfig> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, APP_SETTING_KEYS.OIDC_CONFIG) });
    const stored = parseSafe<Partial<OidcFullConfig>>(row?.value, {});
    return mergeOidcConfig(DEFAULT_OIDC_CONFIG, stored);
  }

  async getUploadPattern(): Promise<string> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, APP_SETTING_KEYS.UPLOAD_FILE_PATTERN) });
    return row?.value ?? DEFAULT_UPLOAD_PATTERN;
  }

  async setUploadPattern(pattern: string): Promise<void> {
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.UPLOAD_FILE_PATTERN, value: pattern })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: pattern } });
  }

  async getDownloadPattern(): Promise<string> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, APP_SETTING_KEYS.DOWNLOAD_FILE_PATTERN) });
    return row?.value ?? DEFAULT_DOWNLOAD_PATTERN;
  }

  async setDownloadPattern(pattern: string): Promise<void> {
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.DOWNLOAD_FILE_PATTERN, value: pattern })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: pattern } });
  }

  async updateOidcConfig(config: Partial<OidcFullConfig>): Promise<OidcFullConfig> {
    const current = await this.getOidcConfig();
    const merged = mergeOidcConfig(current, config);
    const value = JSON.stringify(merged);

    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.OIDC_CONFIG, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });

    return merged;
  }

  async getAutoFinalizeSettings(): Promise<{
    enabled: boolean;
    threshold: number;
    libraryId: number | null;
    folderId: number | null;
    metadataMode: StagingAutoFinalizeMetadataMode;
  }> {
    const keys = [
      APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_ENABLED,
      APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_THRESHOLD,
      APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_LIBRARY_ID,
      APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_FOLDER_ID,
      APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_METADATA_MODE,
    ];
    const rows = await this.db.select().from(schema.appSettings).where(inArray(schema.appSettings.key, keys));
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const libVal = map.get(APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_LIBRARY_ID);
    const folderVal = map.get(APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_FOLDER_ID);
    const libId = libVal ? parseInt(libVal, 10) : null;
    const folderId = folderVal ? parseInt(folderVal, 10) : null;

    return {
      enabled: map.get(APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_ENABLED) === 'true',
      threshold: parseInt(map.get(APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_THRESHOLD) ?? '85', 10),
      libraryId: libId && !isNaN(libId) ? libId : null,
      folderId: folderId && !isNaN(folderId) ? folderId : null,
      metadataMode: parseAutoFinalizeMetadataMode(map.get(APP_SETTING_KEYS.STAGING_AUTO_FINALIZE_METADATA_MODE)),
    };
  }

  async getFileWriteSettings(): Promise<GlobalFileWriteSettings> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.FILE_WRITE_SETTINGS),
    });
    if (!row?.value) return { ...DEFAULT_FILE_WRITE_SETTINGS };
    const stored = parseSafe<Partial<GlobalFileWriteSettings>>(row.value, {});
    return mergeFileWriteSettings(DEFAULT_FILE_WRITE_SETTINGS, stored);
  }

  async getMetadataScoreWeights(): Promise<MetadataScoreWeights> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.METADATA_SCORE_WEIGHTS),
    });
    const stored = parseSafe<Partial<MetadataScoreWeights>>(row?.value, {});
    return { ...DEFAULT_METADATA_SCORE_WEIGHTS, ...stored };
  }

  async setMetadataScoreWeights(weights: MetadataScoreWeights): Promise<MetadataScoreWeights> {
    const value = JSON.stringify(weights);
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.METADATA_SCORE_WEIGHTS, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return weights;
  }

  async updateFileWriteSettings(patch: Partial<GlobalFileWriteSettings>): Promise<GlobalFileWriteSettings> {
    const current = await this.getFileWriteSettings();
    const merged = mergeFileWriteSettings(current, patch);
    const value = JSON.stringify(merged);
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.FILE_WRITE_SETTINGS, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return merged;
  }
}

function parseAutoFinalizeMetadataMode(value: string | undefined): StagingAutoFinalizeMetadataMode {
  if (value === 'fetched_only' || value === 'embedded_only') return value;
  return 'safe_merge';
}

function mergeFileWriteSettings(base: GlobalFileWriteSettings, patch: Partial<GlobalFileWriteSettings>): GlobalFileWriteSettings {
  return {
    ...base,
    ...patch,
    epub: { ...base.epub, ...(patch.epub ?? {}) },
    pdf: { ...base.pdf, ...(patch.pdf ?? {}) },
    cbx: { ...base.cbx, ...(patch.cbx ?? {}) },
  };
}

function mergeOidcConfig(base: OidcFullConfig, patch: Partial<OidcFullConfig>): OidcFullConfig {
  return {
    ...base,
    ...patch,
    claimMapping: { ...base.claimMapping, ...(patch.claimMapping ?? {}) },
    autoProvision: { ...base.autoProvision, ...(patch.autoProvision ?? {}) },
  };
}
