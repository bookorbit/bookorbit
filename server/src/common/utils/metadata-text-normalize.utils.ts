import { sql, type SQLWrapper, type SQL } from 'drizzle-orm';

export function normalizeMetadataText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized : null;
}

export function normalizeMetadataTextKey(value: string | null | undefined): string | null {
  return normalizeMetadataText(value)?.toLowerCase() ?? null;
}

export function normalizeMetadataTextSql(value: SQLWrapper): SQL<string> {
  return sql<string>`btrim(regexp_replace(replace(${value}, chr(160), ' '), '[[:space:]]+', ' ', 'g'))`;
}

export function normalizeMetadataTextOrNullSql(value: SQLWrapper): SQL<string | null> {
  return sql<string | null>`NULLIF(${normalizeMetadataTextSql(value)}, '')`;
}

export function normalizeMetadataTextKeySql(value: SQLWrapper): SQL<string> {
  return sql<string>`lower(${normalizeMetadataTextSql(value)})`;
}

export function chooseCanonicalMetadataTextRow<T extends { id: number; name: string }>(
  rows: readonly T[],
  options: { desiredName?: string | null; excludedId?: number } = {},
): T | null {
  const desiredName = normalizeMetadataText(options.desiredName);
  const candidates = rows.filter((row) => row.id !== options.excludedId).sort((a, b) => a.id - b.id);
  return (
    (desiredName ? candidates.find((row) => row.name === desiredName) : undefined) ??
    candidates.find((row) => normalizeMetadataText(row.name) === row.name) ??
    candidates[0] ??
    null
  );
}
