/**
 * Canonical forms for provider inputs. A canonical value is what the cache key is built from AND
 * what the provider is sent, so two requests with the same key always send the same request.
 * Case is preserved on purpose: folding it only in the key would let two different requests share
 * an answer.
 */

export function canonicalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
}

/** Hyphens and spaces only; ISBN-10 and ISBN-13 stay distinct because providers treat them differently. */
export function canonicalIsbn(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\s-]+/g, '').toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

/** Opaque provider ids are matched exactly; some are case-sensitive. */
export function canonicalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function canonicalRegion(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : fallback;
}

/** JSON with sorted keys and `undefined` dropped, so equal inputs always serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sortValue(item)));
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) sorted[key] = sortValue(entry);
  }
  return sorted;
}
