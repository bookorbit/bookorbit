import { describe, expect, it } from 'vitest';

import {
  classifyFileLayout,
  compareByTier,
  matchReleaseTier,
  releaseMatchesTier,
  releaseProfileIsActive,
  SINGLE_FILE_MAX_ENTRIES,
  type ReleaseTier,
  type ReleaseTierInput,
} from '@bookorbit/types';

function release(overrides: Partial<ReleaseTierInput> = {}): ReleaseTierInput {
  return {
    formats: ['m4b'],
    fileCount: 1,
    audio: { bitrateKbps: 128, channels: 2 },
    language: 'ENG',
    indexerId: 14,
    freeleech: false,
    vipOnly: false,
    seeders: 20,
    sizeBytes: 400 * 1024 * 1024,
    ...overrides,
  };
}

function tier(id: string, conditions: ReleaseTier['conditions']): ReleaseTier {
  return { id, name: id, conditions };
}

describe('releaseMatchesTier', () => {
  it('matches when the tier states nothing at all', () => {
    expect(releaseMatchesTier(release(), {})).toBe(true);
  });

  it('matches any one of the formats a tier lists, not all of them', () => {
    expect(releaseMatchesTier(release({ formats: ['mp3'] }), { formats: ['m4b', 'mp3'] })).toBe(true);
    expect(releaseMatchesTier(release({ formats: ['epub'] }), { formats: ['m4b', 'mp3'] })).toBe(false);
  });

  it('compares formats case insensitively, since indexers disagree on case', () => {
    expect(releaseMatchesTier(release({ formats: ['M4B'] }), { formats: ['m4b'] })).toBe(true);
  });

  it('separates a single file from several', () => {
    expect(releaseMatchesTier(release({ fileCount: 1 }), { fileLayout: 'single' })).toBe(true);
    expect(releaseMatchesTier(release({ fileCount: 32 }), { fileLayout: 'single' })).toBe(false);
    expect(releaseMatchesTier(release({ fileCount: 32 }), { fileLayout: 'multi' })).toBe(true);
    expect(releaseMatchesTier(release({ fileCount: 1 }), { fileLayout: 'multi' })).toBe(false);
  });

  /**
   * The count a tracker states includes sidecars, so an exact test for one file matched nothing.
   * Both of these are one m4b: `Alien Clay.m4b` beside an nfo, and `Shroud.m4b` beside a cue, a
   * jpg and an nfo.
   */
  it('reads a book shipped with its sidecars as one book file', () => {
    expect(releaseMatchesTier(release({ fileCount: 2 }), { fileLayout: 'single' })).toBe(true);
    expect(releaseMatchesTier(release({ fileCount: 4 }), { fileLayout: 'single' })).toBe(true);
    expect(releaseMatchesTier(release({ fileCount: 2 }), { fileLayout: 'multi' })).toBe(false);
  });

  it('still reads a real set of tracks as several files', () => {
    expect(releaseMatchesTier(release({ fileCount: 40 }), { fileLayout: 'single' })).toBe(false);
    expect(releaseMatchesTier(release({ fileCount: 40 }), { fileLayout: 'multi' })).toBe(true);
  });

  it('classifies a layout the same way the picker facet does', () => {
    expect(classifyFileLayout(null)).toBeNull();
    expect(classifyFileLayout(1)).toBe('single');
    expect(classifyFileLayout(SINGLE_FILE_MAX_ENTRIES)).toBe('single');
    expect(classifyFileLayout(SINGLE_FILE_MAX_ENTRIES + 1)).toBe('multi');
  });

  it('treats an unstated file count as unknown rather than as one file', () => {
    expect(releaseMatchesTier(release({ fileCount: null }), { fileLayout: 'single' })).toBe(false);
    expect(releaseMatchesTier(release({ fileCount: null }), { fileLayout: 'multi' })).toBe(false);
  });

  it('rejects a bitrate that was stated and fell short of the floor', () => {
    expect(releaseMatchesTier(release(), { minBitrateKbps: 96 })).toBe(true);
    expect(releaseMatchesTier(release({ audio: { bitrateKbps: 64, channels: 2 } }), { minBitrateKbps: 96 })).toBe(false);
  });

  /**
   * MediaInfo is optional per torrent and mostly absent: MyAnonaMouse returned `{}` for every
   * release of three separate books. A floor that excluded unmeasured releases excluded all of
   * them, which made a profile unusable on that tracker rather than selective.
   */
  it('lets a release with no published bitrate through a bitrate floor', () => {
    expect(releaseMatchesTier(release({ audio: null }), { minBitrateKbps: 96 })).toBe(true);
    expect(releaseMatchesTier(release({ audio: { bitrateKbps: null, channels: 2 } }), { minBitrateKbps: 96 })).toBe(true);
  });

  it('matches channels exactly where they were stated, and ignores the condition where they were not', () => {
    expect(releaseMatchesTier(release(), { channels: 2 })).toBe(true);
    expect(releaseMatchesTier(release({ audio: { bitrateKbps: 87, channels: 1 } }), { channels: 2 })).toBe(false);
    expect(releaseMatchesTier(release({ audio: null }), { channels: 2 })).toBe(true);
  });

  it('never lets an unstated language satisfy a language condition', () => {
    expect(releaseMatchesTier(release({ language: null }), { languages: ['ENG'] })).toBe(false);
    expect(releaseMatchesTier(release({ language: 'eng' }), { languages: ['ENG'] })).toBe(true);
  });

  /**
   * A tier can only ever store the two-letter code the settings form offers, while a source states
   * whatever it states: MyAnonaMouse reports "ENG". Comparing the two as strings put every one of
   * that tracker's releases outside every tier that named a language, which is a whole source
   * silently falling out of a profile rather than a single release being judged.
   */
  it('agrees on a language across the code forms different sources state it in', () => {
    expect(releaseMatchesTier(release({ language: 'ENG' }), { languages: ['en'] })).toBe(true);
    expect(releaseMatchesTier(release({ language: 'en' }), { languages: ['en'] })).toBe(true);
    expect(releaseMatchesTier(release({ language: 'en-GB' }), { languages: ['en'] })).toBe(true);
    expect(releaseMatchesTier(release({ language: 'ger' }), { languages: ['en', 'de'] })).toBe(true);
    expect(releaseMatchesTier(release({ language: 'FRE' }), { languages: ['en'] })).toBe(false);
  });

  it('restricts to named sources', () => {
    expect(releaseMatchesTier(release({ indexerId: 14 }), { indexerIds: [14, 17] })).toBe(true);
    expect(releaseMatchesTier(release({ indexerId: 18 }), { indexerIds: [14, 17] })).toBe(false);
  });

  /**
   * The one place silence passes. A source with no swarm at all reports null, and holding that
   * against it would exclude every direct download from every tier that wants a healthy swarm.
   */
  it('lets a source that publishes no swarm through a seeder floor', () => {
    expect(releaseMatchesTier(release({ seeders: null }), { minSeeders: 10 })).toBe(true);
    expect(releaseMatchesTier(release({ seeders: 3 }), { minSeeders: 10 })).toBe(false);
  });

  it('applies the freeleech and VIP switches only when they are turned on', () => {
    expect(releaseMatchesTier(release({ freeleech: false }), { freeleechOnly: true })).toBe(false);
    expect(releaseMatchesTier(release({ freeleech: false }), { freeleechOnly: false })).toBe(true);
    expect(releaseMatchesTier(release({ vipOnly: true }), { excludeVipOnly: true })).toBe(false);
    expect(releaseMatchesTier(release({ vipOnly: true }), {})).toBe(true);
  });

  it('requires every stated condition, not any of them', () => {
    const conditions = { formats: ['m4b'], fileLayout: 'single' as const, minBitrateKbps: 96 };
    expect(releaseMatchesTier(release(), conditions)).toBe(true);
    expect(releaseMatchesTier(release({ fileCount: 32 }), conditions)).toBe(false);
    expect(releaseMatchesTier(release({ formats: ['mp3'] }), conditions)).toBe(false);
  });
});

describe('matchReleaseTier', () => {
  const tiers = [
    tier('best', { formats: ['m4b'], fileLayout: 'single', minBitrateKbps: 96 }),
    tier('good', { formats: ['m4b'] }),
    tier('ok', { formats: ['mp3'], minBitrateKbps: 128 }),
  ];

  it('returns the first tier that matches, not the best-fitting one', () => {
    expect(matchReleaseTier(release(), tiers)).toBe(0);
    // A real set of tracks fails the first tier's layout and falls to the plain m4b tier below it.
    expect(matchReleaseTier(release({ fileCount: 32 }), tiers)).toBe(1);
  });

  it('returns null for a release no tier accepts', () => {
    expect(matchReleaseTier(release({ formats: ['epub'] }), tiers)).toBeNull();
    // Stated 64k against a 128k tier still fails; only silence is forgiven.
    expect(matchReleaseTier(release({ formats: ['mp3'], audio: { bitrateKbps: 64, channels: 1 } }), tiers)).toBeNull();
  });

  /** The property that makes adopting profiles safe: no profile means the tier axis does nothing. */
  it('returns null for every release when no tier is configured', () => {
    expect(matchReleaseTier(release(), [])).toBeNull();
    expect(releaseProfileIsActive([])).toBe(false);
    expect(releaseProfileIsActive(undefined)).toBe(false);
    expect(releaseProfileIsActive(tiers)).toBe(true);
  });
});

describe('compareByTier', () => {
  it('orders better tiers first and sorts untiered last', () => {
    expect(compareByTier(0, 1)).toBeLessThan(0);
    expect(compareByTier(2, 1)).toBeGreaterThan(0);
    expect(compareByTier(1, 1)).toBe(0);
    expect(compareByTier(null, 3)).toBeGreaterThan(0);
    expect(compareByTier(3, null)).toBeLessThan(0);
    expect(compareByTier(null, null)).toBe(0);
  });

  it('puts every tiered release ahead of every untiered one when sorting', () => {
    const rows = [{ tier: null }, { tier: 2 }, { tier: 0 }, { tier: null }, { tier: 1 }];
    rows.sort((a, b) => compareByTier(a.tier, b.tier));
    expect(rows.map((row) => row.tier)).toEqual([0, 1, 2, null, null]);
  });
});
