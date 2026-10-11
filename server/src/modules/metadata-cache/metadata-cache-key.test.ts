import { NEW_RELEASE_TTL_CAP_MS } from './metadata-cache.constants';
import type { EffectiveCacheSettings } from './metadata-cache-config.service';
import { effectiveTtlMs, entryFreshness, isRecentRelease } from './metadata-cache-freshness';
import { buildCacheKey, hashFingerprint, keyJitterFraction } from './metadata-cache-key';

const DAY = 24 * 60 * 60 * 1000;
const settings: EffectiveCacheSettings = { enabled: true, resultsTtlMs: 30 * DAY, emptyTtlMs: 3 * DAY, staleGraceMs: 30 * DAY };

describe('cache keys', () => {
  const parts = {
    namespace: 'book' as const,
    provider: 'google',
    providerVersion: 1,
    operation: 'search' as const,
    fingerprintHash: hashFingerprint('{}'),
    inputs: { title: 'Dune', author: 'Frank Herbert' },
  };

  it('is stable for equal inputs in any order', () => {
    expect(buildCacheKey(parts)).toBe(buildCacheKey({ ...parts, inputs: { author: 'Frank Herbert', title: 'Dune' } }));
  });

  it('changes with every part that can change an answer', () => {
    const base = buildCacheKey(parts);
    expect(buildCacheKey({ ...parts, namespace: 'author' })).not.toBe(base);
    expect(buildCacheKey({ ...parts, provider: 'amazon' })).not.toBe(base);
    expect(buildCacheKey({ ...parts, providerVersion: 2 })).not.toBe(base);
    expect(buildCacheKey({ ...parts, operation: 'lookup' })).not.toBe(base);
    expect(buildCacheKey({ ...parts, fingerprintHash: hashFingerprint('{"domain":"amazon.de"}') })).not.toBe(base);
    expect(buildCacheKey({ ...parts, inputs: { title: 'dune', author: 'Frank Herbert' } })).not.toBe(base);
  });

  it('spreads jitter across [0, 1)', () => {
    const fraction = keyJitterFraction(buildCacheKey(parts));
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThan(1);
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const keyHash = 'f'.repeat(64);

  it('is fresh within the TTL, stale within the grace, then expired', () => {
    const at = (ageDays: number) =>
      entryFreshness({ status: 'results', fetchedAt: new Date(now - ageDays * DAY), keyHash: '0'.repeat(64), publishedDates: [], settings, now });

    expect(at(1)).toBe('fresh');
    expect(at(40)).toBe('stale');
    expect(at(70)).toBe('expired');
  });

  it('uses the empty-results TTL for empty answers', () => {
    expect(entryFreshness({ status: 'not_found', fetchedAt: new Date(now - 4 * DAY), keyHash, publishedDates: [], settings, now })).toBe('stale');
  });

  it('never extends a TTL with jitter', () => {
    expect(effectiveTtlMs({ status: 'results', keyHash, publishedDates: [], settings, now })).toBeLessThanOrEqual(settings.resultsTtlMs);
    expect(effectiveTtlMs({ status: 'results', keyHash, publishedDates: [], settings, now })).toBeGreaterThanOrEqual(settings.resultsTtlMs * 0.9);
  });

  it('caps the TTL of recent and upcoming releases', () => {
    expect(effectiveTtlMs({ status: 'results', keyHash, publishedDates: ['2026-05-20'], settings, now })).toBeLessThanOrEqual(NEW_RELEASE_TTL_CAP_MS);
  });

  it('reads partial dates as their latest possible day', () => {
    expect(isRecentRelease(['2026'], now)).toBe(true);
    expect(isRecentRelease(['2026-05'], now)).toBe(true);
    expect(isRecentRelease(['2025'], now)).toBe(false);
    expect(isRecentRelease(['someday'], now)).toBe(false);
  });
});
