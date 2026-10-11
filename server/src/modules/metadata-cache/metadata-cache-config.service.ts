import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_METADATA_CACHE_CONFIG,
  METADATA_CACHE_LIMITS,
  METADATA_CACHE_NAMESPACES,
  type MetadataCacheConfig,
  type MetadataCacheEntryStatus,
  type MetadataCacheNamespace,
  type MetadataCacheProviderOverride,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { CONFIG_MEMO_MS, METADATA_CACHE_CLEAR_MARKERS_KEY, METADATA_CACHE_CONFIG_KEY } from './metadata-cache.constants';
import { MetadataCacheProviderCatalog } from './metadata-cache-provider-catalog';
import { MetadataCacheSettingsRepository } from './metadata-cache-settings.repository';

/**
 * Rows of a scope fetched before `at` are treated as gone. Persisted before any row is deleted, so a
 * partial clear survives a restart and in-flight writes that started earlier are discarded.
 */
export interface ClearMarker {
  namespace?: MetadataCacheNamespace;
  provider?: string;
  emptyOnly?: boolean;
  at: string;
}

export interface EffectiveCacheSettings {
  enabled: boolean;
  resultsTtlMs: number;
  emptyTtlMs: number;
  staleGraceMs: number;
}

export interface CacheSettingsSnapshot {
  config: MetadataCacheConfig;
  markers: ClearMarker[];
}

export type MetadataCacheConfigPatch = Partial<MetadataCacheConfig>;

const EMPTY_STATUSES: readonly MetadataCacheEntryStatus[] = ['empty', 'not_found'];

@Injectable()
export class MetadataCacheConfigService {
  private readonly logger = new Logger(MetadataCacheConfigService.name);
  private memo: { loadedAt: number; snapshot: Promise<CacheSettingsSnapshot> } | null = null;

  constructor(
    private readonly settings: MetadataCacheSettingsRepository,
    private readonly catalog: MetadataCacheProviderCatalog,
  ) {}

  snapshot(): Promise<CacheSettingsSnapshot> {
    const now = Date.now();
    if (this.memo && now - this.memo.loadedAt < CONFIG_MEMO_MS) return this.memo.snapshot;
    const snapshot = this.load();
    this.memo = { loadedAt: now, snapshot };
    snapshot.catch(() => {
      if (this.memo?.snapshot === snapshot) this.memo = null;
    });
    return snapshot;
  }

  async getConfig(): Promise<MetadataCacheConfig> {
    return (await this.snapshot()).config;
  }

  async updateConfig(patch: MetadataCacheConfigPatch): Promise<MetadataCacheConfig> {
    if (patch.providerOverrides) this.assertKnownProviders(patch.providerOverrides);
    const value = await this.settings.update(METADATA_CACHE_CONFIG_KEY, (current) => {
      const base = asObject(parseConfig(current, (error) => this.logParseFailure(METADATA_CACHE_CONFIG_KEY, error)));
      return JSON.stringify(normalizeMetadataCacheConfig({ ...base, ...patch }));
    });
    this.invalidate();
    return normalizeMetadataCacheConfig(JSON.parse(value));
  }

  async addClearMarker(marker: Omit<ClearMarker, 'at'>, at: Date): Promise<void> {
    await this.settings.update(METADATA_CACHE_CLEAR_MARKERS_KEY, (current) => {
      const markers = parseMarkers(current);
      markers.push({ ...marker, at: at.toISOString() });
      return JSON.stringify(markers);
    });
    this.invalidate();
  }

  async removeClearMarkers(shouldRemove: (marker: ClearMarker) => boolean): Promise<void> {
    await this.settings.update(METADATA_CACHE_CLEAR_MARKERS_KEY, (current) => JSON.stringify(parseMarkers(current).filter((m) => !shouldRemove(m))));
    this.invalidate();
  }

  invalidate(): void {
    this.memo = null;
  }

  private async load(): Promise<CacheSettingsSnapshot> {
    const [configValue, markersValue] = await Promise.all([
      this.settings.read(METADATA_CACHE_CONFIG_KEY),
      this.settings.read(METADATA_CACHE_CLEAR_MARKERS_KEY),
    ]);
    return {
      config: normalizeMetadataCacheConfig(parseConfig(configValue, (error) => this.logParseFailure(METADATA_CACHE_CONFIG_KEY, error))),
      markers: parseMarkers(markersValue),
    };
  }

  private assertKnownProviders(overrides: readonly MetadataCacheProviderOverride[]): void {
    const unknown = overrides.filter((override) => !this.catalog.has(override.namespace, override.provider));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown metadata cache providers: ${unknown.map((o) => `${o.namespace}:${o.provider}`).join(', ')}`);
    }
  }

  private logParseFailure(key: string, error: unknown): void {
    const errorClass = error instanceof Error ? error.name : 'UnknownError';
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(`[metadata_cache.config_parse] [fail] key=${key} errorClass=${errorClass} error="${message}" - using defaults`);
  }
}

export function effectiveCacheSettings(config: MetadataCacheConfig, namespace: MetadataCacheNamespace, provider: string): EffectiveCacheSettings {
  const override = config.providerOverrides.find((o) => o.namespace === namespace && o.provider === provider);
  return {
    enabled: config.enabled && override?.enabled !== false,
    resultsTtlMs: (override?.resultsTtlSeconds ?? config.resultsTtlSeconds) * 1000,
    emptyTtlMs: (override?.emptyTtlSeconds ?? config.emptyTtlSeconds) * 1000,
    staleGraceMs: config.staleGraceSeconds * 1000,
  };
}

export function isEmptyStatus(status: MetadataCacheEntryStatus | string): boolean {
  return (EMPTY_STATUSES as readonly string[]).includes(status);
}

export function markerApplies(marker: ClearMarker, namespace: string, provider: string, status: string): boolean {
  if (marker.namespace && marker.namespace !== namespace) return false;
  if (marker.provider && marker.provider !== provider) return false;
  if (marker.emptyOnly && !isEmptyStatus(status)) return false;
  return true;
}

/** Epoch ms of the newest marker covering this entry, or 0. */
export function latestMarkerAt(markers: readonly ClearMarker[], namespace: string, provider: string, status: string): number {
  let latest = 0;
  for (const marker of markers) {
    if (!markerApplies(marker, namespace, provider, status)) continue;
    const at = Date.parse(marker.at);
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return latest;
}

export function normalizeMetadataCacheConfig(raw: unknown): MetadataCacheConfig {
  const value = asObject(raw);
  const limits = METADATA_CACHE_LIMITS;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_METADATA_CACHE_CONFIG.enabled,
    resultsTtlSeconds: clampInt(value.resultsTtlSeconds, limits.resultsTtlSeconds, DEFAULT_METADATA_CACHE_CONFIG.resultsTtlSeconds),
    emptyTtlSeconds: clampInt(value.emptyTtlSeconds, limits.emptyTtlSeconds, DEFAULT_METADATA_CACHE_CONFIG.emptyTtlSeconds),
    staleGraceSeconds: clampInt(value.staleGraceSeconds, limits.staleGraceSeconds, DEFAULT_METADATA_CACHE_CONFIG.staleGraceSeconds),
    maxStorageMb: clampInt(value.maxStorageMb, limits.maxStorageMb, DEFAULT_METADATA_CACHE_CONFIG.maxStorageMb),
    providerOverrides: normalizeOverrides(value.providerOverrides),
  };
}

function normalizeOverrides(raw: unknown): MetadataCacheProviderOverride[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, MetadataCacheProviderOverride>();
  for (const item of raw) {
    const entry = asObject(item);
    const namespace = entry.namespace;
    const provider = typeof entry.provider === 'string' ? entry.provider.trim() : '';
    if (!(METADATA_CACHE_NAMESPACES as readonly unknown[]).includes(namespace) || !provider) continue;
    const override: MetadataCacheProviderOverride = { namespace: namespace as MetadataCacheNamespace, provider };
    if (typeof entry.enabled === 'boolean') override.enabled = entry.enabled;
    const results = optionalClampInt(entry.resultsTtlSeconds, METADATA_CACHE_LIMITS.resultsTtlSeconds);
    if (results !== undefined) override.resultsTtlSeconds = results;
    const empty = optionalClampInt(entry.emptyTtlSeconds, METADATA_CACHE_LIMITS.emptyTtlSeconds);
    if (empty !== undefined) override.emptyTtlSeconds = empty;
    byKey.set(`${override.namespace}:${provider}`, override);
  }
  return [...byKey.values()].slice(0, METADATA_CACHE_LIMITS.maxProviderOverrides);
}

function parseConfig(value: string | null, onError: (error: unknown) => void): unknown {
  if (value === null) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    onError(error);
    return {};
  }
}

function parseMarkers(value: string | null): ClearMarker[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => asObject(item))
      .filter((item) => typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)))
      .map((item) => ({
        ...((METADATA_CACHE_NAMESPACES as readonly unknown[]).includes(item.namespace)
          ? { namespace: item.namespace as MetadataCacheNamespace }
          : {}),
        ...(typeof item.provider === 'string' && item.provider ? { provider: item.provider } : {}),
        ...(item.emptyOnly === true ? { emptyOnly: true } : {}),
        at: item.at as string,
      }));
  } catch {
    return [];
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  return optionalClampInt(value, range) ?? fallback;
}

function optionalClampInt(value: unknown, range: { min: number; max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(range.max, Math.max(range.min, Math.floor(value)));
}
