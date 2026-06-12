import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { SortField } from '@bookorbit/types';
import { collapsedJumpBucketExpr, flatJumpBucketExpr } from './jump-bucket-expr';

const dialect = new PgDialect();

function toSqlText(expr: ReturnType<typeof flatJumpBucketExpr>): string {
  if (!expr) throw new Error('expected SQL expression');
  return dialect.sqlToQuery(expr).sql;
}

describe('jump-bucket-expr', () => {
  it('builds a letter expression over the metadata title for flat title sort', () => {
    const text = toSqlText(flatJumpBucketExpr('title'));
    expect(text).toContain('"book_metadata"."title"');
    expect(text).toContain("~ '^[A-Z]$'");
    expect(text).toContain("ELSE '#'");
  });

  it('builds a letter expression over the denormalized author sort key for flat author sort', () => {
    const text = toSqlText(flatJumpBucketExpr('author'));
    expect(text).toContain('"books"."primary_author_sort_name"');
    expect(text).toContain("~ '^[A-Z]$'");
  });

  it('builds a year expression for flat publishedYear sort', () => {
    const text = toSqlText(flatJumpBucketExpr('publishedYear'));
    expect(text).toBe('"book_metadata"."published_year"::text');
  });

  it('builds collapsed expressions over representative aliases', () => {
    expect(toSqlText(collapsedJumpBucketExpr('title'))).toContain('r.sort_title');
    expect(toSqlText(collapsedJumpBucketExpr('author'))).toContain('r.author_sort_name');
    expect(toSqlText(collapsedJumpBucketExpr('publishedYear'))).toBe('r.published_year::text');
  });

  it('returns null for sort fields without bucket support', () => {
    const ineligible: SortField[] = ['addedAt', 'rating', 'fileSize', 'random', 'series'];
    for (const field of ineligible) {
      expect(flatJumpBucketExpr(field)).toBeNull();
      expect(collapsedJumpBucketExpr(field)).toBeNull();
    }
  });
});
