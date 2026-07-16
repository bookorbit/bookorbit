import { SQL, sql } from 'drizzle-orm';

export function letterJumpBucketExpr(column: SQL): SQL {
  return sql`
    CASE
      WHEN btrim(COALESCE(${column}, '')) = '' THEN NULL
      WHEN upper(substr(btrim(public.bookorbit_unaccent(COALESCE(${column}, ''))), 1, 1)) ~ '^[A-Z]$'
        THEN upper(substr(btrim(public.bookorbit_unaccent(COALESCE(${column}, ''))), 1, 1))
      WHEN upper(substr(btrim(COALESCE(${column}, '')), 1, 1)) ~ '^[[:alpha:]]$'
        THEN upper(substr(btrim(COALESCE(${column}, '')), 1, 1))
      ELSE '#'
    END`;
}
