import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';
import { letterJumpBucketExpr } from './jump-bucket-expr';

const dialect = new PgDialect();

function toSqlText(expr: ReturnType<typeof letterJumpBucketExpr>): string {
  return dialect.sqlToQuery(expr).sql;
}

describe('jump-bucket-expr', () => {
  it('builds an accent-insensitive letter expression over a supplied value', () => {
    const text = toSqlText(letterJumpBucketExpr(sql.raw('rail_value')));
    expect(text).toContain('rail_value');
    expect(text).toContain('public.bookorbit_unaccent');
    expect(text).toContain("~ '^[A-Z]$'");
    expect(text).toContain("ELSE '#'");
  });

  it('preserves non-Latin alphabetic initials instead of folding them into the symbol bucket', () => {
    const text = toSqlText(letterJumpBucketExpr(sql.raw('rail_value')));
    expect(text).toContain("~ '^[[:alpha:]]$'");
    expect(text).toContain('upper(substr(btrim(COALESCE(rail_value');
  });
});
