import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthorAutoEnrichmentWriteMode, AuthorMetadataPreferences } from '@bookorbit/types';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { AuthorMetadataPreferenceResolver } from './metadata/author-metadata-preference-resolver';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AuthorMetadataPreferencesService {
  private readonly logger = new Logger(AuthorMetadataPreferencesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly resolver: AuthorMetadataPreferenceResolver,
  ) {}

  async getPreferences(): Promise<AuthorMetadataPreferences> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_METADATA_PREFERENCES),
    });

    if (row?.value) {
      try {
        return this.resolver.resolve(JSON.parse(row.value) as Partial<AuthorMetadataPreferences>);
      } catch (error) {
        const errorClass = error instanceof Error ? error.name : 'UnknownError';
        const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
        this.logger.warn(
          `[author_metadata_preferences.parse] [fail] key=${APP_SETTING_KEYS.AUTHORS_METADATA_PREFERENCES} errorClass=${errorClass} error="${message}" - falling back to defaults`,
        );
        return this.resolver.getDefaultPreferences();
      }
    }

    return this.migrateFromLegacyWriteMode();
  }

  async setPreferences(preferences: AuthorMetadataPreferences): Promise<AuthorMetadataPreferences> {
    const normalized = this.resolver.resolve(preferences);
    await this.persist(normalized);
    return normalized;
  }

  // Author enrichment was governed by one global write mode before preferences
  // became per-field. Seed every field from it on first read so an existing
  // install keeps its overwrite behaviour instead of silently adopting the
  // default.
  private async migrateFromLegacyWriteMode(): Promise<AuthorMetadataPreferences> {
    const writeMode = await this.readLegacyWriteMode();
    const migrated = this.resolver.fromLegacyWriteMode(writeMode);
    await this.persist(migrated, { onlyIfAbsent: true });
    this.logger.log(`[author_metadata_preferences.migrate] [end] writeMode=${writeMode} - seeded per-field preferences from the legacy write mode`);
    return migrated;
  }

  private async readLegacyWriteMode(): Promise<AuthorAutoEnrichmentWriteMode> {
    const [standalone, config] = await Promise.all([
      this.db.query.appSettings.findFirst({
        where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_WRITE_MODE),
      }),
      this.db.query.appSettings.findFirst({
        where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_CONFIG),
      }),
    ]);

    if (standalone?.value?.trim() === AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH) {
      return AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH;
    }

    if (config?.value) {
      try {
        const parsed = JSON.parse(config.value) as { writeMode?: string };
        if (parsed.writeMode === AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH) {
          return AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH;
        }
      } catch {
        // A malformed legacy blob just means we cannot learn anything from it.
      }
    }

    return AuthorAutoEnrichmentWriteMode.MISSING_ONLY;
  }

  private async persist(preferences: AuthorMetadataPreferences, options?: { onlyIfAbsent?: boolean }): Promise<void> {
    const value = JSON.stringify(preferences);
    const insert = this.db.insert(schema.appSettings).values({ key: APP_SETTING_KEYS.AUTHORS_METADATA_PREFERENCES, value });

    if (options?.onlyIfAbsent) {
      await insert.onConflictDoNothing({ target: schema.appSettings.key });
      return;
    }

    await insert.onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }
}
