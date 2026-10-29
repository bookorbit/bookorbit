import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  BUILT_IN_METADATA_PROVIDER_LABELS,
  MetadataProviderKey,
  MOVED_METADATA_PROVIDERS,
  type MovedMetadataProviderKey,
  ProviderConfigurations,
  ProviderConnectionTestResult,
  ProviderStatus,
} from '@bookorbit/types';

import { stripBearerPrefix, toBearerAuthorization } from '../../common/utils/bearer-token.utils';
import { amazonRequestHeaders, isAmazonBotChallenge } from '../../common/utils/amazon-http.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { amazonOrigin, normalizeAmazonDomain, normalizeAudibleDomain } from '../../common/utils/metadata-provider-hosts.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { MetadataHttpProviderCatalog } from '../metadata-http-provider/metadata-http-provider.catalog';
import { MetadataPreferencesService } from './metadata-preferences.service';

type Db = NodePgDatabase<typeof schema>;
type ProviderConfigPatch = {
  [K in keyof ProviderConfigurations]?: Partial<ProviderConfigurations[K]>;
};

const PROVIDER_CONFIG_KEY = 'metadata_provider_config';
const PROVIDER_TEST_EVENT = 'metadata_provider_config.test_provider';
const HARDCOVER_GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
const HARDCOVER_TEST_QUERY = 'query { me { username } }';
const AMAZON_TEST_QUERY = 'books';
const PROVIDER_TEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONFIG: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  librofm: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: false },
  kobo: { enabled: false, country: 'us', language: 'en' },
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

function mergeKoboConfig(base: ProviderConfigurations['kobo'], value: unknown): ProviderConfigurations['kobo'] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    country: asString(next.country, base.country),
    language: asString(next.language, base.language),
  };
}

const PROVIDER_LABELS = BUILT_IN_METADATA_PROVIDER_LABELS;

type ProviderEnableRule = {
  canEnable: (config: ProviderConfigurations) => boolean;
  blockedMessage: string;
  setupHint: string;
};

const PROVIDER_ENABLE_RULES = {
  google: {
    canEnable: (config) => !!config.google.apiKey.trim(),
    blockedMessage: 'Google Books requires an API key before it can be enabled',
    setupHint: 'API key required',
  },
  hardcover: {
    canEnable: (config) => !!config.hardcover.apiKey.trim(),
    blockedMessage: 'Hardcover requires an API key before it can be enabled',
    setupHint: 'API key required. Run Test and save before enabling.',
  },
  comicvine: {
    canEnable: (config) => !!config.comicvine.apiKey.trim(),
    blockedMessage: 'ComicVine requires an API key before it can be enabled',
    setupHint: 'API key required',
  },
} satisfies Partial<Record<keyof ProviderConfigurations, ProviderEnableRule>>;

@Injectable()
export class ProviderConfigService implements OnModuleInit {
  private readonly logger = new Logger(ProviderConfigService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly httpProviders?: MetadataHttpProviderCatalog,
    @Optional() private readonly preferences?: MetadataPreferencesService,
  ) {}

  /**
   * Providers that are no longer built in keep no settings here. Their old ones, Aladin's TTB key
   * among them, are deleted rather than left in the database.
   */
  async onModuleInit(): Promise<void> {
    const removed = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROVIDER_CONFIG_KEY})::bigint)`);
      const row = await tx.query.appSettings.findFirst({ where: eq(schema.appSettings.key, PROVIDER_CONFIG_KEY) });
      let stored: unknown;
      try {
        stored = row ? JSON.parse(row.value) : null;
      } catch {
        return [];
      }
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
      const settings = stored as Record<string, unknown>;
      const moved = Object.keys(MOVED_METADATA_PROVIDERS).filter((key) => key in settings);
      if (moved.length === 0) return [];
      for (const key of moved) delete settings[key];
      await tx
        .update(schema.appSettings)
        .set({ value: JSON.stringify(settings) })
        .where(eq(schema.appSettings.key, PROVIDER_CONFIG_KEY));
      return moved;
    });
    if (removed.length > 0) {
      this.logger.log(
        `[metadata_provider_config.moved_out] [end] providers=${removed.join(',')} - removed settings of providers that are no longer built in`,
      );
    }
  }

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
      librofm: { ...DEFAULT_CONFIG.librofm },
      comicvine: { ...DEFAULT_CONFIG.comicvine },
      ranobedb: { ...DEFAULT_CONFIG.ranobedb },
      kobo: { ...DEFAULT_CONFIG.kobo },
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
      librofm: mergeSimpleConfig(base.librofm, next.librofm),
      comicvine: mergeComicVineConfig(base.comicvine, next.comicvine),
      ranobedb: mergeSimpleConfig(base.ranobedb, next.ranobedb),
      kobo: mergeKoboConfig(base.kobo, next.kobo),
    };
  }

  private getEnableRule(key: keyof ProviderConfigurations): ProviderEnableRule | null {
    return PROVIDER_ENABLE_RULES[key] ?? null;
  }

  private getEnableBlockedMessage(config: ProviderConfigurations, key: keyof ProviderConfigurations): string | null {
    const rule = this.getEnableRule(key);
    if (!rule) return null;
    return rule.canEnable(config) ? null : rule.blockedMessage;
  }

  private validateConfig(config: ProviderConfigurations): void {
    for (const key of Object.keys(PROVIDER_ENABLE_RULES) as Array<keyof ProviderConfigurations>) {
      if (!config[key].enabled) continue;
      const blockedMessage = this.getEnableBlockedMessage(config, key);
      if (!blockedMessage) continue;
      throw new BadRequestException(blockedMessage);
    }
  }

  private shouldValidateHardcoverConnection(current: ProviderConfigurations, next: ProviderConfigurations): boolean {
    if (!next.hardcover.enabled) return false;
    return !current.hardcover.enabled || current.hardcover.apiKey !== next.hardcover.apiKey;
  }

  private async validateExternalEnableChecks(current: ProviderConfigurations, next: ProviderConfigurations): Promise<void> {
    if (!this.shouldValidateHardcoverConnection(current, next)) return;
    let result: ProviderConnectionTestResult;
    try {
      result = await this.testHardcoverProvider(next.hardcover.apiKey);
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Hardcover validation timed out. Please try again.'
          : 'Could not reach Hardcover to validate the token.';
      throw new BadRequestException(message);
    }
    if (result.status === 'success' && result.ok) return;
    throw new BadRequestException(result.message);
  }

  private normalizeConfig(config: ProviderConfigurations): ProviderConfigurations {
    const googleApiKey = config.google.apiKey.trim();
    const normalized: ProviderConfigurations = {
      ...config,
      google: { ...config.google, apiKey: googleApiKey },
      amazon: {
        ...config.amazon,
        domain: normalizeAmazonDomain(config.amazon.domain),
        cookie: this.normalizeAmazonCookie(config.amazon.cookie),
      },
      hardcover: {
        ...config.hardcover,
        apiKey: stripBearerPrefix(config.hardcover.apiKey),
      },
      audible: {
        ...config.audible,
        domain: this.normalizeAudibleConfigDomain(config.audible.domain),
      },
      comicvine: {
        ...config.comicvine,
        apiKey: config.comicvine.apiKey.trim(),
      },
      kobo: {
        ...config.kobo,
        country: this.normalizeKoboPathSegment(config.kobo.country, DEFAULT_CONFIG.kobo.country),
        language: this.normalizeKoboPathSegment(config.kobo.language, DEFAULT_CONFIG.kobo.language),
      },
    };

    if (!normalized.google.enabled || normalized.google.apiKey) return normalized;
    return {
      ...normalized,
      google: { ...normalized.google, enabled: false },
    };
  }

  private normalizeAmazonCookie(cookie: string): string {
    const normalized = cookie.trim();
    if (!normalized) return '';
    if (normalized.toLowerCase().startsWith('cookie:')) {
      return normalized.slice('cookie:'.length).trim();
    }
    return normalized;
  }

  private normalizeAudibleConfigDomain(value: string): string {
    const normalized = value.trim().toLowerCase();
    const suffix = normalizeAudibleDomain(normalized);
    if (normalized === suffix || normalized === `audible.${suffix}`) return normalized;
    return DEFAULT_CONFIG.audible.domain;
  }

  private normalizeKoboPathSegment(value: string, fallback: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    return normalized || fallback;
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
      const errorMessage = sanitizeLogValue(rawMessage);
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
    return this.normalizeConfig(this.parsePersistedConfig(row.value, defaults, 'get', startedAt));
  }

  async getLinkSettings() {
    const config = await this.getConfig();
    return { amazonDomain: config.amazon.domain };
  }

  async updateConfig(patch: ProviderConfigPatch): Promise<ProviderConfigurations> {
    const startedAt = Date.now();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROVIDER_CONFIG_KEY})::bigint)`);

      const defaults = this.createDefaultConfig();
      const row = await tx.query.appSettings.findFirst({
        where: eq(schema.appSettings.key, PROVIDER_CONFIG_KEY),
      });
      const current = row ? this.normalizeConfig(this.parsePersistedConfig(row.value, defaults, 'update', startedAt)) : defaults;
      const next = this.normalizeConfig(this.mergeConfig(current, patch));
      this.validateConfig(next);
      await this.validateExternalEnableChecks(current, next);
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
        configured: !!this.getEnableRule('google')?.canEnable(cfg),
        hint: !this.getEnableRule('google')?.canEnable(cfg) ? this.getEnableRule('google')?.setupHint : undefined,
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
        configured: !!this.getEnableRule('hardcover')?.canEnable(cfg),
        hint: !this.getEnableRule('hardcover')?.canEnable(cfg) ? this.getEnableRule('hardcover')?.setupHint : undefined,
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
        key: MetadataProviderKey.LIBROFM,
        label: PROVIDER_LABELS[MetadataProviderKey.LIBROFM],
        enabled: cfg.librofm.enabled,
        configured: true,
        hint: 'Uses an undocumented Libro.fm catalog endpoint',
      },
      {
        key: MetadataProviderKey.COMICVINE,
        label: PROVIDER_LABELS[MetadataProviderKey.COMICVINE],
        enabled: cfg.comicvine.enabled,
        configured: !!this.getEnableRule('comicvine')?.canEnable(cfg),
        hint: !this.getEnableRule('comicvine')?.canEnable(cfg) ? this.getEnableRule('comicvine')?.setupHint : undefined,
      },
      {
        key: MetadataProviderKey.RANOBEDB,
        label: PROVIDER_LABELS[MetadataProviderKey.RANOBEDB],
        enabled: cfg.ranobedb.enabled,
        configured: true,
      },
      {
        key: MetadataProviderKey.KOBO,
        label: PROVIDER_LABELS[MetadataProviderKey.KOBO],
        enabled: cfg.kobo.enabled,
        configured: true,
        hint: 'Web scraping may be blocked by Kobo bot protection',
      },
      ...this.externalProviderStatuses(),
      ...(await this.movedProviderStatuses()),
    ];
  }

  /**
   * Providers that used to be built in and are not registered. Listing them keeps them readable in
   * field rules, and tells the settings page what to run, or that the source closed, and whether
   * anything still uses them.
   */
  private async movedProviderStatuses(): Promise<ProviderStatus[]> {
    const registered = new Set((this.httpProviders?.registered() ?? []).map((provider) => provider.key as string));
    const missing = (Object.keys(MOVED_METADATA_PROVIDERS) as MovedMetadataProviderKey[]).filter((key) => !registered.has(key));
    if (missing.length === 0) return [];
    const inUse = await this.movedProvidersInUse(missing);
    return missing.map((key) => {
      const { label, image } = MOVED_METADATA_PROVIDERS[key];
      return {
        key,
        label,
        enabled: false,
        configured: false,
        hint: image ? 'Now runs as its own provider. Add it under External providers.' : `${label} closed the service BookOrbit used.`,
        source: 'external' as const,
        movedOut: { image, inUse: inUse.has(key) },
      };
    });
  }

  /**
   * A field rule names it, or, for one that can be added back, a book still holds one of its ids. A
   * closed source's ids stay on books and need nothing done, so they alone do not count.
   */
  private async movedProvidersInUse(keys: MovedMetadataProviderKey[]): Promise<Set<MovedMetadataProviderKey>> {
    const idColumns = { lubimyczytac: schema.bookMetadata.lubimyczytacId, aladin: schema.bookMetadata.aladinId };
    const named = await this.preferences?.providersNamedInRules().catch(() => null);
    const used = new Set<MovedMetadataProviderKey>();
    for (const key of keys) {
      if (named?.has(key)) {
        used.add(key);
        continue;
      }
      if (!MOVED_METADATA_PROVIDERS[key].image) continue;
      const [stored] = await this.db
        .select({ bookId: schema.bookMetadata.bookId })
        .from(schema.bookMetadata)
        .where(isNotNull(idColumns[key]))
        .limit(1);
      if (stored) used.add(key);
    }
    return used;
  }

  /** External providers are configured on their own page; here they only need to be listed for field rules. */
  private externalProviderStatuses(): ProviderStatus[] {
    return (this.httpProviders?.registered() ?? []).map((provider) => {
      const healthy = provider.status === 'ok' || provider.status === 'stale';
      return {
        key: provider.key,
        label: provider.label,
        enabled: provider.enabled && healthy && !provider.authorizationUnreadable,
        configured: provider.info !== null,
        hint: provider.authorizationUnreadable
          ? 'External provider authorization header could not be decrypted'
          : healthy
            ? undefined
            : `External provider ${provider.status.replace('_', ' ')}`,
        source: 'external' as const,
        supportedFields: provider.info?.supportedFields ?? null,
        ...(provider.iconUrl ? { iconUrl: provider.iconUrl } : {}),
        ...(provider.color ? { color: provider.color } : {}),
      };
    });
  }

  async testProvider(key: MetadataProviderKey, patch?: ProviderConfigPatch): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now();
    this.logger.log(`[${PROVIDER_TEST_EVENT}] [start] provider=${key} hasPatch=${patch !== undefined} - provider connection test started`);
    try {
      const current = await this.getConfig();
      const effective = patch ? this.normalizeConfig(this.mergeConfig(current, patch)) : current;
      const result = await this.runProviderTest(key, effective);
      this.logger.log(
        `[${PROVIDER_TEST_EVENT}] [end] provider=${key} durationMs=${Date.now() - startedAt} ok=${result.ok} status=${result.status} - provider connection test completed`,
      );
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = sanitizeLogValue(rawMessage);
      this.logger.warn(
        `[${PROVIDER_TEST_EVENT}] [fail] provider=${key} durationMs=${durationMs} errorClass=${errorClass} error="${message}" - provider connection test failed`,
      );
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to test provider connection');
    }
  }

  private async runProviderTest(key: MetadataProviderKey, config: ProviderConfigurations): Promise<ProviderConnectionTestResult> {
    switch (key) {
      case MetadataProviderKey.AMAZON:
        return this.testAmazonProvider(config.amazon);
      case MetadataProviderKey.HARDCOVER:
        return this.testHardcoverProvider(config.hardcover.apiKey);
      default:
        throw new BadRequestException(`Provider test not supported for ${key}`);
    }
  }

  private async testAmazonProvider(config: ProviderConfigurations['amazon']): Promise<ProviderConnectionTestResult> {
    const domain = normalizeAmazonDomain(config.domain);
    const cookie = this.normalizeAmazonCookie(config.cookie);
    const url = new URL('/gp/aw/s', amazonOrigin(domain));
    url.searchParams.set('k', AMAZON_TEST_QUERY);
    url.searchParams.set('i', 'stripbooks');
    const headers = amazonRequestHeaders(url, cookie);
    const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(PROVIDER_TEST_TIMEOUT_MS) });

    if (!response.ok) {
      return {
        key: MetadataProviderKey.AMAZON,
        ok: false,
        status: 'fail',
        message: `Amazon request failed with HTTP ${response.status}.`,
      };
    }

    const body = await response.text();
    if (isAmazonBotChallenge(body)) {
      return {
        key: MetadataProviderKey.AMAZON,
        ok: false,
        status: 'warning',
        message: 'Amazon responded with a bot-check page. Use a fresh browser session cookie.',
      };
    }

    if (!cookie) {
      return {
        key: MetadataProviderKey.AMAZON,
        ok: true,
        status: 'warning',
        message: 'Amazon is reachable. Add a session cookie for better reliability.',
      };
    }

    return {
      key: MetadataProviderKey.AMAZON,
      ok: true,
      status: 'success',
      message: 'Amazon is reachable and accepted the request.',
    };
  }

  private async testHardcoverProvider(apiKey: string): Promise<ProviderConnectionTestResult> {
    const token = stripBearerPrefix(apiKey);
    if (!token) {
      return {
        key: MetadataProviderKey.HARDCOVER,
        ok: false,
        status: 'fail',
        message: 'Hardcover API key is required.',
      };
    }

    const response = await fetch(HARDCOVER_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: toBearerAuthorization(token),
      },
      body: JSON.stringify({ query: HARDCOVER_TEST_QUERY }),
      signal: AbortSignal.timeout(PROVIDER_TEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        key: MetadataProviderKey.HARDCOVER,
        ok: false,
        status: 'fail',
        message: `Hardcover request failed with HTTP ${response.status}.`,
      };
    }

    const body = (await response.json()) as {
      data?: { me?: Array<{ username?: string | null }> };
      errors?: Array<{ message?: string }>;
    };

    if (body.errors?.length) {
      const firstError = body.errors[0]?.message;
      return {
        key: MetadataProviderKey.HARDCOVER,
        ok: false,
        status: 'fail',
        message: firstError ? `Hardcover API error: ${firstError}` : 'Hardcover API returned an error.',
      };
    }

    const username = body.data?.me?.[0]?.username?.trim();
    if (!username) {
      return {
        key: MetadataProviderKey.HARDCOVER,
        ok: false,
        status: 'fail',
        message: 'Hardcover token validation failed.',
      };
    }

    return {
      key: MetadataProviderKey.HARDCOVER,
      ok: true,
      status: 'success',
      message: `Connected as ${username}.`,
    };
  }
}
