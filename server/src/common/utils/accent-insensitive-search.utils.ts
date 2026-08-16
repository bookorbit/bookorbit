import { SQL, SQLWrapper, sql } from 'drizzle-orm';

import { normalizeMetadataText } from './metadata-text-normalize.utils';

export function accentInsensitiveIlike(value: SQLWrapper, pattern: string): SQL {
  return sql`public.bookorbit_unaccent(${value}) ILIKE public.bookorbit_unaccent(${pattern})`;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// Stored entity names are whitespace-normalized, so the term has to be too. A pasted
// non-breaking space or a stray double space would otherwise match nothing at all.
export function buildSearchPattern(term: string): string {
  return `%${escapeLikePattern(normalizeMetadataText(term) ?? '')}%`;
}
