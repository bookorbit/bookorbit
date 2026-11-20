import { Inject, Injectable } from '@nestjs/common';
import type { AuthorAutoEnrichmentConfig } from '@bookorbit/types';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { APP_SETTING_KEYS, DEFAULT_AUTHOR_ENRICHMENT_CONFIG } from '../../common/constants/app-settings.constants';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { AuthorMetadataPreferencesService } from './author-metadata-preferences.service';

type Db = NodePgDatabase<typeof schema>;

export { DEFAULT_AUTHOR_ENRICHMENT_CONFIG };

@Injectable()
export class AuthorEnrichmentConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly metadataPreferences: AuthorMetadataPreferencesService,
  ) {}

  async getConfig(): Promise<AuthorAutoEnrichmentConfig> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_CONFIG),
    });
    if (!row?.value) return { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG, conditions: { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions } };
    try {
      const stored = JSON.parse(row.value) as Partial<AuthorAutoEnrichmentConfig> | null;
      const defaults = DEFAULT_AUTHOR_ENRICHMENT_CONFIG;
      return {
        enabled: stored?.enabled ?? defaults.enabled,
        triggerOnImport: stored?.triggerOnImport ?? defaults.triggerOnImport,
        conditions: {
          neverEnriched: stored?.conditions?.neverEnriched ?? defaults.conditions.neverEnriched,
          missingBio: stored?.conditions?.missingBio ?? defaults.conditions.missingBio,
          missingPhoto: stored?.conditions?.missingPhoto ?? defaults.conditions.missingPhoto,
        },
      };
    } catch {
      return { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG, conditions: { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions } };
    }
  }

  async setConfig(config: AuthorAutoEnrichmentConfig): Promise<void> {
    // First read migrates the legacy write mode before this update replaces the stored config.
    await this.metadataPreferences.getPreferences();
    const value = JSON.stringify(config);
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_CONFIG, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }

  async isPaused(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_ENRICHMENT_PAUSED),
    });
    return row?.value === 'true';
  }

  async setPaused(paused: boolean): Promise<void> {
    const value = paused ? 'true' : 'false';
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.AUTHORS_ENRICHMENT_PAUSED, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }
}
