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

import { DB } from '../../db';
import * as schema from '../../db/schema';

const APP_SETTING_KEYS = {
  OIDC_CONFIG: 'oidc_config',
  UPLOAD_FILE_PATTERN: 'upload_file_pattern',
  DOWNLOAD_FILE_PATTERN: 'download_file_pattern',
  STAGING_AUTO_FETCH_METADATA: 'staging_auto_fetch_metadata',
  STAGING_AUTO_FINALIZE_ENABLED: 'staging_auto_finalize_enabled',
  STAGING_AUTO_FINALIZE_THRESHOLD: 'staging_auto_finalize_threshold',
  STAGING_AUTO_FINALIZE_LIBRARY_ID: 'staging_auto_finalize_library_id',
  STAGING_AUTO_FINALIZE_FOLDER_ID: 'staging_auto_finalize_folder_id',
  STAGING_AUTO_FINALIZE_METADATA_MODE: 'staging_auto_finalize_metadata_mode',
  FILE_WRITE_SETTINGS: 'file_write_settings',
  METADATA_SCORE_WEIGHTS: 'metadata_score_weights',
  AUTHORS_AUTO_ENRICHMENT_ENABLED: 'authors_auto_enrichment_enabled',
  AUTHORS_AUTO_ENRICHMENT_WRITE_MODE: 'authors_auto_enrichment_write_mode',
  AUTHORS_PROVIDER_AUDNEXUS_ENABLED: 'authors_provider_audnexus_enabled',
  AUTHORS_ENRICHMENT_PAUSED: 'authors_enrichment_paused',
} as const;

type Db = NodePgDatabase<typeof schema>;
const DEFAULT_DOWNLOAD_PATTERN = '{originalFilename}';

export interface OidcFullConfig {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimMapping: {
    username: string;
    name: string;
    email: string;
    groups: string;
  };
  autoProvision: {
    enabled: boolean;
    allowLocalLinking: boolean;
    defaultPermissionNames: string[];
  };
}

const DEFAULT_OIDC_CONFIG: OidcFullConfig = {
  enabled: false,
  providerName: '',
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
};

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
    return parseSafe<OidcFullConfig>(row?.value, { ...DEFAULT_OIDC_CONFIG });
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
    const merged: OidcFullConfig = {
      ...current,
      ...config,
      claimMapping: { ...current.claimMapping, ...(config.claimMapping ?? {}) },
      autoProvision: { ...current.autoProvision, ...(config.autoProvision ?? {}) },
    };
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
