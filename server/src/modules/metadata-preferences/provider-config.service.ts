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
  itunes: { enabled: true },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function mergeGoogleConfig(base: ProviderConfigurations['google'], value: unknown): ProviderConfigurations['google'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    apiKey: asString(next.apiKey, base.apiKey),
  };
}

function mergeAmazonConfig(base: ProviderConfigurations['amazon'], value: unknown): ProviderConfigurations['amazon'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    domain: asString(next.domain, base.domain),
    cookie: asString(next.cookie, base.cookie),
  };
}

type SimpleProviderConfig = { enabled: boolean };

function mergeSimpleConfig<T extends SimpleProviderConfig>(base: T, value: unknown): T {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
  } as T;
}

function mergeHardcoverConfig(base: ProviderConfigurations['hardcover'], value: unknown): ProviderConfigurations['hardcover'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    apiKey: asString(next.apiKey, base.apiKey),
  };
}

function mergeAudibleConfig(base: ProviderConfigurations['audible'], value: unknown): ProviderConfigurations['audible'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    domain: asString(next.domain, base.domain),
  };
}

function mergeComicVineConfig(base: ProviderConfigurations['comicvine'], value: unknown): ProviderConfigurations['comicvine'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    apiKey: asString(next.apiKey, base.apiKey),
  };
}

const PROVIDER_LABELS: Record<MetadataProviderKey, string> = {
  [MetadataProviderKey.GOOGLE]: 'Google Books',
  [MetadataProviderKey.AMAZON]: 'Amazon',
  [MetadataProviderKey.GOODREADS]: 'Goodreads',
  [MetadataProviderKey.HARDCOVER]: 'Hardcover',
  [MetadataProviderKey.OPEN_LIBRARY]: 'Open Library',
  [MetadataProviderKey.ITUNES]: 'iTunes',
  [MetadataProviderKey.AUDIBLE]: 'Audible',
  [MetadataProviderKey.AUDNEXUS]: 'AudNexus',
  [MetadataProviderKey.COMICVINE]: 'ComicVine',
};

@Injectable()
export class ProviderConfigService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private createDefaultConfig(): ProviderConfigurations {
    return {
      google: { ...DEFAULT_CONFIG.google },
      amazon: { ...DEFAULT_CONFIG.amazon },
      goodreads: { ...DEFAULT_CONFIG.goodreads },
      hardcover: { ...DEFAULT_CONFIG.hardcover },
      openLibrary: { ...DEFAULT_CONFIG.openLibrary },
      itunes: { ...DEFAULT_CONFIG.itunes },
      audible: { ...DEFAULT_CONFIG.audible },
      audnexus: { ...DEFAULT_CONFIG.audnexus },
      comicvine: { ...DEFAULT_CONFIG.comicvine },
    };
  }

  async getConfig(): Promise<ProviderConfigurations> {
    const defaults = this.createDefaultConfig();
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, PROVIDER_CONFIG_KEY),
    });
    if (!row) return defaults;
    try {
      const stored = asObject(JSON.parse(row.value));
      return {
        google: mergeGoogleConfig(defaults.google, stored.google),
        amazon: mergeAmazonConfig(defaults.amazon, stored.amazon),
        goodreads: mergeSimpleConfig(defaults.goodreads, stored.goodreads),
        hardcover: mergeHardcoverConfig(defaults.hardcover, stored.hardcover),
        openLibrary: mergeSimpleConfig(defaults.openLibrary, stored.openLibrary),
        itunes: mergeSimpleConfig(defaults.itunes, stored.itunes),
        audible: mergeAudibleConfig(defaults.audible, stored.audible),
        audnexus: mergeSimpleConfig(defaults.audnexus, stored.audnexus),
        comicvine: mergeComicVineConfig(defaults.comicvine, stored.comicvine),
      };
    } catch {
      return defaults;
    }
  }

  async updateConfig(patch: Partial<ProviderConfigurations>): Promise<ProviderConfigurations> {
    const current = await this.getConfig();
    const next: ProviderConfigurations = {
      google: mergeGoogleConfig(current.google, patch.google),
      amazon: mergeAmazonConfig(current.amazon, patch.amazon),
      goodreads: mergeSimpleConfig(current.goodreads, patch.goodreads),
      hardcover: mergeHardcoverConfig(current.hardcover, patch.hardcover),
      openLibrary: mergeSimpleConfig(current.openLibrary, patch.openLibrary),
      itunes: mergeSimpleConfig(current.itunes, patch.itunes),
      audible: mergeAudibleConfig(current.audible, patch.audible),
      audnexus: mergeSimpleConfig(current.audnexus, patch.audnexus),
      comicvine: mergeComicVineConfig(current.comicvine, patch.comicvine),
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
        hint: !cfg.google.apiKey ? 'Recommended for higher rate limits' : undefined,
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
      {
        key: MetadataProviderKey.ITUNES,
        label: PROVIDER_LABELS[MetadataProviderKey.ITUNES],
        enabled: cfg.itunes.enabled,
        configured: true,
      },
      {
        key: MetadataProviderKey.AUDIBLE,
        label: PROVIDER_LABELS[MetadataProviderKey.AUDIBLE],
        enabled: cfg.audible.enabled,
        configured: true,
      },
      {
        key: MetadataProviderKey.AUDNEXUS,
        label: PROVIDER_LABELS[MetadataProviderKey.AUDNEXUS],
        enabled: cfg.audnexus.enabled,
        configured: true,
      },
      {
        key: MetadataProviderKey.COMICVINE,
        label: PROVIDER_LABELS[MetadataProviderKey.COMICVINE],
        enabled: cfg.comicvine.enabled,
        configured: !!cfg.comicvine.apiKey,
      },
    ];
  }
}
