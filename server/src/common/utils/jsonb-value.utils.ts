const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A JSON object as `JSON.parse` makes one: not null, an array or a class instance. */
export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Postgres jsonb refuses NUL characters and unpaired surrogates, which would otherwise surface as a 500 on the write. */
export function isJsonbStorable(value: unknown): boolean {
  if (typeof value === 'string') return storableString(value);
  if (Array.isArray(value)) return value.every(isJsonbStorable);
  if (value !== null && typeof value === 'object')
    return Object.entries(value).every(([key, entry]) => storableString(key) && isJsonbStorable(entry));
  return true;
}

function storableString(value: string): boolean {
  return !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}
