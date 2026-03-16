import { Inject, Injectable } from '@nestjs/common';
import type { AuthorAutoEnrichmentConfig } from '@projectx/types';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const KEY_CONFIG = 'authors_auto_enrichment_config';
const KEY_PAUSED = 'authors_enrichment_paused';

export const DEFAULT_AUTHOR_ENRICHMENT_CONFIG: AuthorAutoEnrichmentConfig = {
  enabled: false,
  triggerOnImport: true,
  writeMode: 'missing_only',
  conditions: {
    neverEnriched: true,
    missingBio: false,
    missingPhoto: false,
  },
};

@Injectable()
export class AuthorEnrichmentConfigService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getConfig(): Promise<AuthorAutoEnrichmentConfig> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, KEY_CONFIG),
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
      .values({ key: KEY_CONFIG, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }

  async isPaused(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, KEY_PAUSED),
    });
    return row?.value === 'true';
  }

  async setPaused(paused: boolean): Promise<void> {
    const value = paused ? 'true' : 'false';
    await this.db
      .insert(schema.appSettings)
      .values({ key: KEY_PAUSED, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }
}
