import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import {
  chooseCanonicalMetadataTextRow,
  normalizeMetadataText,
  normalizeMetadataTextKey,
  normalizeMetadataTextKeySql,
  normalizeMetadataTextOrNullSql,
} from './metadata-text-normalize.utils';

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

describe('metadata text normalization', () => {
  it('collapses internal whitespace and trims edges', () => {
    expect(normalizeMetadataText('  James\t\n Islington\u00a0 ')).toBe('James Islington');
  });

  it('returns null for blank values', () => {
    expect(normalizeMetadataText(' \t\n ')).toBeNull();
    expect(normalizeMetadataText(null)).toBeNull();
    expect(normalizeMetadataText(undefined)).toBeNull();
  });

  it('builds case-insensitive identity keys from normalized text', () => {
    expect(normalizeMetadataTextKey('  Dune   Chronicles ')).toBe('dune chronicles');
    expect(normalizeMetadataTextKey('   ')).toBeNull();
  });

  it('builds SQL normalization with matching trim and NBSP handling', () => {
    const keySql = flattenSql(normalizeMetadataTextKeySql(sql.raw('authors.name'))).replace(/\s+/g, ' ');
    const nullableSql = flattenSql(normalizeMetadataTextOrNullSql(sql.raw('book_metadata.series_name'))).replace(/\s+/g, ' ');

    expect(keySql).toContain('lower( btrim(regexp_replace(replace( authors.name , chr(160),');
    expect(nullableSql).toContain('NULLIF( btrim(regexp_replace(replace( book_metadata.series_name , chr(160),');
  });

  it('chooses the desired clean row before legacy whitespace variants', () => {
    const rows = [
      { id: 2, name: 'Known  Author' },
      { id: 3, name: 'Known Author' },
    ];

    expect(chooseCanonicalMetadataTextRow(rows, { desiredName: 'Known Author' })).toEqual({ id: 3, name: 'Known Author' });
  });

  it('excludes a current row when choosing a canonical target', () => {
    const rows = [
      { id: 1, name: 'Known  Author' },
      { id: 3, name: 'Known Author' },
    ];

    expect(chooseCanonicalMetadataTextRow(rows, { desiredName: 'Known Author', excludedId: 1 })).toEqual({ id: 3, name: 'Known Author' });
  });
});
