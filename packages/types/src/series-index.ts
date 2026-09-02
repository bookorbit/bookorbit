export const SERIES_INDEX_MAX_LENGTH = 20;

export const SERIES_INDEX_PATTERN = /^\d+(?:\.\d+)?$/;

export type SeriesIndex = string;

export function isValidSeriesIndex(value: string): value is SeriesIndex {
  return value.length <= SERIES_INDEX_MAX_LENGTH && SERIES_INDEX_PATTERN.test(value);
}

export function parseSeriesIndex(value: unknown): SeriesIndex | null {
  const candidate = typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  return isValidSeriesIndex(candidate) ? candidate : null;
}

export function isPositiveSeriesIndex(value: SeriesIndex): boolean {
  return /[1-9]/.test(value);
}

function normalizedIntegerSegment(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

function compareIntegerSegments(a: string, b: string): number {
  const normalizedA = normalizedIntegerSegment(a);
  const normalizedB = normalizedIntegerSegment(b);
  if (normalizedA.length !== normalizedB.length) return normalizedA.length < normalizedB.length ? -1 : 1;
  if (normalizedA === normalizedB) return 0;
  return normalizedA < normalizedB ? -1 : 1;
}

export function compareSeriesIndices(a: SeriesIndex, b: SeriesIndex): number {
  const [aWhole, aFraction] = a.split(".");
  const [bWhole, bFraction] = b.split(".");
  const wholeComparison = compareIntegerSegments(aWhole, bWhole);
  if (wholeComparison !== 0) return wholeComparison;

  if (aFraction === undefined && bFraction !== undefined) return -1;
  if (aFraction !== undefined && bFraction === undefined) return 1;
  if (aFraction !== undefined && bFraction !== undefined) {
    const fractionComparison = compareIntegerSegments(aFraction, bFraction);
    if (fractionComparison !== 0) return fractionComparison;
  }

  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function formatSeriesIndex(value: SeriesIndex | null): string | null {
  const parsed = parseSeriesIndex(value);
  if (parsed == null) return null;
  const [whole, fraction] = parsed.split(".");
  const padded = whole.padStart(2, "0");
  return fraction === undefined ? padded : `${padded}.${fraction}`;
}
