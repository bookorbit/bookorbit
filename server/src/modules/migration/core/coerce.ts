export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  if (value == null) return null;
  const str =
    typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : null;
  if (str == null) return null;
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function asInteger(value: unknown): number | null {
  const num = asNumber(value);
  if (num == null) return null;
  return Math.round(num);
}
