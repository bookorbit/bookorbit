import { type SeriesUnit, type SeriesUnitClass, seriesUnitClass } from '@bookorbit/types';

import { MAX_SERIES_TOTAL_BOOKS, normalizeSeriesTotalBooks } from '../../../common/utils/series-total-books.utils';

/**
 * A provider total turns "the books you own" into "the books the series has", which is the whole
 * point, but it also lets us name books as missing. Only trust it when nothing about the local
 * data contradicts it, because a false "you are missing #5" is worse than staying quiet.
 */
export function resolveTrustedExpectedMax(
  indices: string[],
  bookCount: number,
  integerIndices: number[],
  expectedBookCount: number | null,
): number | undefined {
  const expected = normalizeSeriesTotalBooks(expectedBookCount);
  if (expected === undefined) return undefined;

  // An owned book with no usable index would be reported missing, so every book must be numbered.
  if (indices.length !== bookCount || integerIndices.length !== indices.length) return undefined;

  // Owning a book numbered past the total means the total is stale or matched the wrong series.
  if (Math.max(...integerIndices) > expected) return undefined;

  return expected;
}

function collectMissing(integerIndices: number[], from: number, to: number): number[] {
  const present = new Set(integerIndices);
  const gaps: number[] = [];
  for (let i = from; i <= to; i++) {
    if (!present.has(i)) {
      gaps.push(i);
    }
  }
  return gaps;
}

export function toIntegerIndices(indices: string[]): number[] {
  return indices
    .filter((idx) => /^\d+$/.test(idx))
    .map((idx) => Number(idx))
    .filter(Number.isSafeInteger);
}

/**
 * Numbers the series should have and the library does not. Shared by the series list and the
 * series detail so the two surfaces can never name a different set of missing volumes.
 */
export function computeSeriesGaps(indices: string[], bookCount: number, expectedBookCount: number | null): number[] {
  const integerIndices = toIntegerIndices(indices);
  if (integerIndices.length === 0) return [];

  const min = Math.min(...integerIndices);
  const max = Math.max(...integerIndices);
  if (min < 1 || max > MAX_SERIES_TOTAL_BOOKS) return [];

  const expectedMax = resolveTrustedExpectedMax(indices, bookCount, integerIndices, expectedBookCount);

  // With no trusted total only interior holes are knowable, and one book has no interior.
  if (expectedMax === undefined) {
    if (integerIndices.length < 2) return [];
    return collectMissing(integerIndices, min, max);
  }

  return collectMissing(integerIndices, 1, expectedMax);
}

/**
 * The numbers the ladder runs between, or undefined when nothing about the series is numbered
 * well enough to draw one. Mirrors {@link computeSeriesGaps} exactly, so a slot the ladder marks
 * missing is always a number the gap list also names.
 */
export function resolveLadderRange(indices: string[], bookCount: number, expectedBookCount: number | null): { from: number; to: number } | undefined {
  const integerIndices = toIntegerIndices(indices);
  if (integerIndices.length === 0) return undefined;

  const min = Math.min(...integerIndices);
  const max = Math.max(...integerIndices);
  if (min < 1 || max > MAX_SERIES_TOTAL_BOOKS) return undefined;

  const expectedMax = resolveTrustedExpectedMax(indices, bookCount, integerIndices, expectedBookCount);
  return expectedMax === undefined ? { from: min, to: max } : { from: 1, to: expectedMax };
}

export type SeriesClassGaps = {
  /** The class the volume ladder runs on: volumes, or chapters in a series that has no volumes. */
  ladderClass: SeriesUnitClass;
  /** Missing numbers of the ladder class; only volumes use the expected total. */
  gaps: number[];
  /** Missing chapter or issue numbers between the lowest and highest owned. */
  chapterGaps: number[];
};

/**
 * Gaps per unit class. A volume and a chapter never share a number line, so v1-10 with c80-100
 * misses nothing. Mirrors `seriesHasGapsSql`: a series has gaps when either list is non-empty.
 */
export function computeSeriesClassGaps(members: readonly SeriesGapMember[], expectedBookCount: number | null): SeriesClassGaps {
  const volumes = members.filter((member) => seriesUnitClass(member.unit) === 'volume');
  const chapters = members.filter((member) => seriesUnitClass(member.unit) === 'chapter');
  const chapterGaps = computeSeriesGaps(numberedIndices(chapters), chapters.length, null);
  if (volumes.length === 0) return { ladderClass: 'chapter', gaps: chapterGaps, chapterGaps };
  return { ladderClass: 'volume', gaps: computeSeriesGaps(numberedIndices(volumes), volumes.length, expectedBookCount), chapterGaps };
}

export type SeriesGapMember = { seriesIndex: string | null; unit: SeriesUnit | null };

function numberedIndices(members: readonly SeriesGapMember[]): string[] {
  return members.map((member) => member.seriesIndex).filter((index): index is string => index !== null);
}
