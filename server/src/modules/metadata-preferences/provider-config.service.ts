import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MetadataProviderKey, ProviderConfigurations, ProviderConnectionTestResult, ProviderStatus } from '@bookorbit/types';

import { stripBearerPrefix, toBearerAuthorization } from '../../common/utils/bearer-token.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';

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
const AMAZON_CAPTCHA_PATTERNS = [/validateCaptcha/i, /captcha/i, /not a robot/i];
const AMAZON_TEST_HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
};

const DEFAULT_CONFIG: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: false },
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
  [MetadataProviderKey.RANOBEDB]: 'RanobeDB',
};

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
      ranobedb: { ...DEFAULT_CONFIG.ranobedb },
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
      ranobedb: mergeSimpleConfig(base.ranobedb, next.ranobedb),
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
        domain: this.normalizeDomain(config.amazon.domain, DEFAULT_CONFIG.amazon.domain),
        cookie: this.normalizeAmazonCookie(config.amazon.cookie),
      },
      hardcover: {
        ...config.hardcover,
        apiKey: stripBearerPrefix(config.hardcover.apiKey),
      },
      audible: {
        ...config.audible,
        domain: this.normalizeDomain(config.audible.domain, DEFAULT_CONFIG.audible.domain),
      },
      comicvine: {
        ...config.comicvine,
        apiKey: config.comicvine.apiKey.trim(),
      },
    };

    if (!normalized.google.enabled || normalized.google.apiKey) return normalized;
    return {
      ...normalized,
      google: { ...normalized.google, enabled: false },
    };
  }

  private normalizeDomain(value: string, fallback: string): string {
    const normalized = value.trim().toLowerCase();
    return normalized || fallback;
  }

  private normalizeAmazonCookie(cookie: string): string {
    const normalized = cookie.trim();
    if (!normalized) return '';
    if (normalized.toLowerCase().startsWith('cookie:')) {
      return normalized.slice('cookie:'.length).trim();
    }
    return normalized;
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
    ];
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
    const domain = this.normalizeDomain(config.domain, DEFAULT_CONFIG.amazon.domain);
    const cookie = this.normalizeAmazonCookie(config.cookie);
    const url = `https://www.${domain}/s?k=${encodeURIComponent(AMAZON_TEST_QUERY)}&i=stripbooks`;
    const headers: HeadersInit = cookie ? { ...AMAZON_TEST_HEADERS, cookie } : AMAZON_TEST_HEADERS;
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
    const captchaDetected = AMAZON_CAPTCHA_PATTERNS.some((pattern) => pattern.test(body));
    if (captchaDetected) {
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
