import { SQL, sql } from 'drizzle-orm';

import type { SortField } from '@bookorbit/types';
import { bookMetadata, books } from '../../db/schema';

// Maps a row to its rail bucket: 'A'..'Z', '#' for non-alphabetic first chars,
// NULL (excluded from buckets) for empty values. Must stay in sync with
// jumpBucketKindForSort in @bookorbit/types: every field that yields a kind
// there needs an expression here for both the flat and collapsed shapes.
function letterExpr(column: SQL): SQL {
  return sql`
    CASE
      WHEN btrim(COALESCE(${column}, '')) = '' THEN NULL
      WHEN upper(substr(btrim(COALESCE(${column}, '')), 1, 1)) ~ '^[A-Z]$'
        THEN upper(substr(btrim(COALESCE(${column}, '')), 1, 1))
      ELSE '#'
    END`;
}

export function flatJumpBucketExpr(field: SortField): SQL | null {
  switch (field) {
    case 'title':
      return letterExpr(sql`${bookMetadata.title}`);
    case 'author':
      return letterExpr(sql`${books.primaryAuthorSortName}`);
    case 'publishedYear':
      return sql`${bookMetadata.publishedYear}::text`;
    default:
      return null;
  }
}

export function collapsedJumpBucketExpr(field: SortField): SQL | null {
  switch (field) {
    case 'title':
      return letterExpr(sql.raw('r.sort_title'));
    case 'author':
      return letterExpr(sql.raw('r.author_sort_name'));
    case 'publishedYear':
      return sql.raw('r.published_year::text');
    default:
      return null;
  }
}
