import { createHash } from 'node:crypto';

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, val]) => [key, normalizeJson(val)]));
  }
  return value;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function sha256Hex(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}
