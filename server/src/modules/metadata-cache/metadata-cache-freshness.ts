import type { MetadataCacheEntryStatus } from '@bookorbit/types';

import { NEW_RELEASE_TTL_CAP_MS, NEW_RELEASE_WINDOW_MS } from './metadata-cache.constants';
import { isEmptyStatus, type EffectiveCacheSettings } from './metadata-cache-config.service';
import { keyJitterFraction } from './metadata-cache-key';

export type EntryFreshness = 'fresh' | 'stale' | 'expired';

export interface FreshnessInput {
  status: MetadataCacheEntryStatus | string;
  fetchedAt: Date;
  keyHash: string;
  publishedDates: readonly string[];
  settings: EffectiveCacheSettings;
  now: number;
}

/**
 * Freshness is decided when an entry is read, with the settings in force at that moment, so a TTL
 * change applies to entries already stored. `stale` entries only answer for a provider that failed.
 */
export function entryFreshness(input: FreshnessInput): EntryFreshness {
  const ttl = effectiveTtlMs(input);
  const age = input.now - input.fetchedAt.getTime();
  if (age < ttl) return 'fresh';
  if (age < ttl + input.settings.staleGraceMs) return 'stale';
  return 'expired';
}

export function effectiveTtlMs(input: Omit<FreshnessInput, 'fetchedAt'>): number {
  let ttl = isEmptyStatus(input.status) ? input.settings.emptyTtlMs : input.settings.resultsTtlMs;
  if (isRecentRelease(input.publishedDates, input.now)) ttl = Math.min(ttl, NEW_RELEASE_TTL_CAP_MS);
  return ttl * (0.9 + 0.1 * keyJitterFraction(input.keyHash));
}

/** A date in the future or within the release window. Partial dates count as their latest possible day. */
export function isRecentRelease(dates: readonly string[], now: number): boolean {
  for (const date of dates) {
    if (typeof date !== 'string') continue;
    const latest = latestPossibleTime(date);
    if (latest !== null && latest >= now - NEW_RELEASE_WINDOW_MS) return true;
  }
  return false;
}

function latestPossibleTime(value: string): number | null {
  const trimmed = value.trim();
  const year = /^(\d{4})$/.exec(trimmed);
  if (year) return Date.UTC(Number(year[1]), 11, 31);
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) return Date.UTC(Number(month[1]), Number(month[2]), 0);
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
