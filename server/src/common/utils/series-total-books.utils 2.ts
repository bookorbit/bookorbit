/**
 * Upper bound for a provider-reported series length. Matches the ceiling the series gap
 * finder already applies, so a nonsense total can never widen gap detection past it.
 */
export const MAX_SERIES_TOTAL_BOOKS = 10_000;

/**
 * Providers report series length as untrusted JSON: missing, null, floats, negatives and
 * numeric strings all occur. Returns undefined for anything that is not a usable count.
 */
export function normalizeSeriesTotalBooks(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) return undefined;
  if (numeric < 1 || numeric > MAX_SERIES_TOTAL_BOOKS) return undefined;
  return numeric;
}
