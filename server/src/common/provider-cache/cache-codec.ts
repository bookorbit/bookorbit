/**
 * How one kind of provider answer is stored. Each namespace supplies codecs for its search and
 * lookup answers; the cache itself never inspects a candidate.
 */
export interface CacheCodec<T> {
  isEmpty(value: T): boolean;
  /** An allow-listed, JSON-safe copy: unknown fields from a provider are never stored. */
  sanitize(value: T): T;
  /**
   * The stored payload as `T`, or `undefined` when it does not have the expected shape. `undefined`
   * rather than `null`, because `null` is a valid stored answer (a lookup that found nothing).
   */
  parse(payload: unknown): T | undefined;
  /** At most `max` results; identity for single-candidate answers. */
  slice(value: T, max: number): T;
  /** Publication dates in the answer, used to keep new releases for less time. */
  publishedDates(value: T): readonly string[];
}

export function pickAllowed<T extends object>(value: T, allowed: Readonly<Record<string, unknown>>): T {
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && Object.hasOwn(allowed, key)) copy[key] = entry;
  }
  return copy as T;
}

/** The JSON type a stored field must have. Nested objects are checked one level deep. */
export type CacheFieldKind = 'string' | 'number' | 'boolean' | 'string[]' | 'object' | 'object[]';

/**
 * The allowed fields of a stored record, or null when one has the wrong type or a required one is
 * missing. A null field is dropped like an absent one.
 */
export function parseFields<T>(value: unknown, fields: Readonly<Record<string, CacheFieldKind>>, required: readonly string[]): T | null {
  if (!isRecord(value)) return null;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(fields, key) || entry === undefined || entry === null) continue;
    if (!matchesKind(entry, fields[key])) return null;
    copy[key] = entry;
  }
  for (const key of required) {
    if (copy[key] === undefined) return null;
  }
  return copy as T;
}

function matchesKind(value: unknown, kind: CacheFieldKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string[]':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'object':
      return isRecord(value);
    case 'object[]':
      return Array.isArray(value) && value.every(isRecord);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
