import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MetadataProviderKey, ProviderConfigurations, ProviderStatus } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const PROVIDER_CONFIG_KEY = 'metadata_provider_config';

const DEFAULT_CONFIG: ProviderConfigurations = {
  google: { enabled: true, apiKey: '' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: true },
};

const PROVIDER_LABELS: Record<MetadataProviderKey, string> = {
  [MetadataProviderKey.GOOGLE]: 'Google Books',
  [MetadataProviderKey.AMAZON]: 'Amazon',
  [MetadataProviderKey.GOODREADS]: 'Goodreads',
  [MetadataProviderKey.HARDCOVER]: 'Hardcover',
  [MetadataProviderKey.OPEN_LIBRARY]: 'Open Library',
};

@Injectable()
export class ProviderConfigService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getConfig(): Promise<ProviderConfigurations> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, PROVIDER_CONFIG_KEY),
    });
    if (!row) return { ...DEFAULT_CONFIG };
    try {
      const stored = JSON.parse(row.value) as Partial<ProviderConfigurations>;
      return {
        google: { ...DEFAULT_CONFIG.google, ...stored.google },
        amazon: { ...DEFAULT_CONFIG.amazon, ...stored.amazon },
        goodreads: { ...DEFAULT_CONFIG.goodreads, ...stored.goodreads },
        hardcover: { ...DEFAULT_CONFIG.hardcover, ...stored.hardcover },
        openLibrary: { ...DEFAULT_CONFIG.openLibrary, ...stored.openLibrary },
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async updateConfig(patch: Partial<ProviderConfigurations>): Promise<ProviderConfigurations> {
    const current = await this.getConfig();
    const next: ProviderConfigurations = {
      google: { ...current.google, ...(patch.google ?? {}) },
      amazon: { ...current.amazon, ...(patch.amazon ?? {}) },
      goodreads: { ...current.goodreads, ...(patch.goodreads ?? {}) },
      hardcover: { ...current.hardcover, ...(patch.hardcover ?? {}) },
      openLibrary: { ...current.openLibrary, ...(patch.openLibrary ?? {}) },
    };
    const value = JSON.stringify(next);
    await this.db
      .insert(schema.appSettings)
      .values({ key: PROVIDER_CONFIG_KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return next;
  }

  async getProviderStatuses(config?: ProviderConfigurations): Promise<ProviderStatus[]> {
    const cfg = config ?? (await this.getConfig());
    return [
      {
        key: MetadataProviderKey.GOOGLE,
        label: PROVIDER_LABELS[MetadataProviderKey.GOOGLE],
        enabled: cfg.google.enabled,
        configured: true,
        hint: !cfg.google.apiKey ? 'API key recommended for higher rate limits' : undefined,
      },
      {
        key: MetadataProviderKey.AMAZON,
        label: PROVIDER_LABELS[MetadataProviderKey.AMAZON],
        enabled: cfg.amazon.enabled,
        configured: true,
        hint: !cfg.amazon.cookie ? 'Cookie recommended to avoid bot detection' : undefined,
      },
      {
        key: MetadataProviderKey.GOODREADS,
        label: PROVIDER_LABELS[MetadataProviderKey.GOODREADS],
        enabled: cfg.goodreads.enabled,
        configured: true,
      },
      {
        key: MetadataProviderKey.HARDCOVER,
        label: PROVIDER_LABELS[MetadataProviderKey.HARDCOVER],
        enabled: cfg.hardcover.enabled,
        configured: !!cfg.hardcover.apiKey,
      },
      {
        key: MetadataProviderKey.OPEN_LIBRARY,
        label: PROVIDER_LABELS[MetadataProviderKey.OPEN_LIBRARY],
        enabled: cfg.openLibrary.enabled,
        configured: true,
      },
    ];
  }
}
