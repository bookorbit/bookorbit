import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MetadataProviderKey, ProviderConfigurations, ProviderStatus } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type ProviderConfigPatch = {
  [K in keyof ProviderConfigurations]?: Partial<ProviderConfigurations[K]>;
};

const PROVIDER_CONFIG_KEY = 'metadata_provider_config';

const DEFAULT_CONFIG: ProviderConfigurations = {
  google: { enabled: true, apiKey: '' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'high' },
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

function mergeITunesConfig(base: ProviderConfigurations['itunes'], value: unknown): ProviderConfigurations['itunes'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    coverResolution: next.coverResolution === 'standard' || next.coverResolution === 'high' ? next.coverResolution : base.coverResolution,
  };
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
  private readonly logger = new Logger(ProviderConfigService.name);

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

  private mergeConfig(base: ProviderConfigurations, value: unknown): ProviderConfigurations {
    const next = asObject(value);
    return {
      google: mergeGoogleConfig(base.google, next.google),
      amazon: mergeAmazonConfig(base.amazon, next.amazon),
      goodreads: mergeSimpleConfig(base.goodreads, next.goodreads),
      hardcover: mergeHardcoverConfig(base.hardcover, next.hardcover),
      openLibrary: mergeSimpleConfig(base.openLibrary, next.openLibrary),
      itunes: mergeITunesConfig(base.itunes, next.itunes),
      audible: mergeAudibleConfig(base.audible, next.audible),
      audnexus: mergeSimpleConfig(base.audnexus, next.audnexus),
      comicvine: mergeComicVineConfig(base.comicvine, next.comicvine),
    };
  }

  private parsePersistedConfig(
    rawValue: string,
    fallback: ProviderConfigurations,
    source: 'get' | 'update',
    startedAt: number,
  ): ProviderConfigurations {
    try {
      return this.mergeConfig(fallback, JSON.parse(rawValue));
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const rawMessage = error instanceof Error ? error.message : 'unknown error';
      const errorMessage = rawMessage.replace(/"/g, '\\"');
      this.logger.warn(
        `[metadata_provider_config.parse] [fail] key=${PROVIDER_CONFIG_KEY} source=${source} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - failed to parse persisted provider config`,
      );
      return fallback;
    }
  }

  async getConfig(): Promise<ProviderConfigurations> {
    const startedAt = Date.now();
    const defaults = this.createDefaultConfig();
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, PROVIDER_CONFIG_KEY),
    });
    if (!row) return defaults;
    return this.parsePersistedConfig(row.value, defaults, 'get', startedAt);
  }

  async updateConfig(patch: ProviderConfigPatch): Promise<ProviderConfigurations> {
    const startedAt = Date.now();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROVIDER_CONFIG_KEY})::bigint)`);

      const defaults = this.createDefaultConfig();
      const row = await tx.query.appSettings.findFirst({
        where: eq(schema.appSettings.key, PROVIDER_CONFIG_KEY),
      });
      const current = row ? this.parsePersistedConfig(row.value, defaults, 'update', startedAt) : defaults;
      const next = this.mergeConfig(current, patch);
      const value = JSON.stringify(next);
      await tx
        .insert(schema.appSettings)
        .values({ key: PROVIDER_CONFIG_KEY, value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
      return next;
    });
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
