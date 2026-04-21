import { Inject, Injectable } from '@nestjs/common';
import type { AuthorAutoEnrichmentConfig } from '@bookorbit/types';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { APP_SETTING_KEYS, DEFAULT_AUTHOR_ENRICHMENT_CONFIG } from '../../common/constants/app-settings.constants';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export { DEFAULT_AUTHOR_ENRICHMENT_CONFIG };

@Injectable()
export class AuthorEnrichmentConfigService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getConfig(): Promise<AuthorAutoEnrichmentConfig> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_CONFIG),
    });
    if (!row?.value) return { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG, conditions: { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions } };
    try {
      const stored = JSON.parse(row.value) as Partial<AuthorAutoEnrichmentConfig>;
      return {
        ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG,
        ...stored,
        conditions: { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions, ...(stored.conditions ?? {}) },
      };
    } catch {
      return { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG, conditions: { ...DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions } };
    }
  }

  async setConfig(config: AuthorAutoEnrichmentConfig): Promise<void> {
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
