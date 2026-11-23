import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * One key per work: linked editions share their group's key, any other book is its own work.
 * Computed live, so linking or unlinking regroups past reads. Null when `bookId` is null (a read
 * whose book was deleted); callers decide what such a row counts as.
 */
export function workKeySql(bookId: SQLWrapper): SQL<string | null> {
  return sql<string | null>`coalesce('g' || (SELECT bl.group_id FROM book_links bl WHERE bl.book_id = ${bookId}), 'b' || ${bookId})`;
}
