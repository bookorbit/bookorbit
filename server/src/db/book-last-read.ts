import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function latestReadingSessionSql(bookId: SQLWrapper, userId: number): SQL {
  return sql`(
    SELECT rs.started_at FROM reading_sessions rs
    WHERE rs.user_id = ${userId} AND rs.book_id = ${bookId}
    ORDER BY rs.started_at DESC LIMIT 1
  )`;
}

/**
 * When an audiobook position was taken. `captured_at` is the device's time, kept when a rescan or a
 * file move rewrites the row (both bump `updated_at`); capped by `updated_at` so a device clock running
 * fast cannot date a listen in the future.
 */
const AUDIOBOOK_READ_AT = 'least(ap.captured_at, ap.updated_at)';

export function bookLastReadSql(bookId: SQLWrapper, userId: number): SQL<Date | null> {
  return sql<Date | null>`greatest(${latestReadingSessionSql(bookId, userId)}, (
    SELECT max(rp.last_read_at) FROM reading_progress rp
    INNER JOIN book_files bf ON rp.book_file_id = bf.id
    WHERE bf.book_id = ${bookId} AND rp.user_id = ${userId}
  ), (
    SELECT ${sql.raw(AUDIOBOOK_READ_AT)} FROM audiobook_progress ap
    WHERE ap.book_id = ${bookId} AND ap.user_id = ${userId}
  ))`;
}

/** `bookLastReadSql` of the book a listing row stands for, read from the `bookLastReadJoinSql` join. */
export function bookLastReadAtSql(): SQL {
  return sql.raw('book_last_read.last_read_at');
}

/**
 * `bookLastReadSql` for every book this user has read, as a `book_last_read` row set joined on
 * `bookId`. Listings sort on it instead of the per-row subqueries: Postgres prices those per book,
 * which on a large library tips the statement past its JIT inlining threshold, where compiling
 * costs several times the query. Grouped by book, so Postgres drops the join when nothing reads it.
 * `linked` limits it to linked books, for the edition fold.
 */
export function bookLastReadJoinSql(bookId: SQLWrapper, userId: number, scope: 'all' | 'linked' = 'all'): SQL {
  return sql`LEFT JOIN ${bookLastReadRowsSql(userId, scope)} ON ${bookLastReadOnSql(bookId)}`;
}

/** The `bookLastReadJoinSql` row set and join condition, for a Drizzle `leftJoin`. */
export function bookLastReadRowsSql(userId: number, scope: 'all' | 'linked' = 'all'): SQL {
  const linkedSessions = scope === 'linked' ? sql`INNER JOIN book_links linked ON linked.book_id = rs.book_id` : sql``;
  const linkedProgress = scope === 'linked' ? sql`INNER JOIN book_links linked ON linked.book_id = bf.book_id` : sql``;
  const linkedAudio = scope === 'linked' ? sql`INNER JOIN book_links linked ON linked.book_id = ap.book_id` : sql``;
  return sql`(
    SELECT reads.book_id, max(reads.read_at) AS last_read_at FROM (
      SELECT rs.book_id, max(rs.started_at) AS read_at FROM reading_sessions rs
      ${linkedSessions}
      WHERE rs.user_id = ${userId}
      GROUP BY rs.book_id
      UNION ALL
      SELECT bf.book_id, max(rp.last_read_at) FROM reading_progress rp
      INNER JOIN book_files bf ON rp.book_file_id = bf.id
      ${linkedProgress}
      WHERE rp.user_id = ${userId}
      GROUP BY bf.book_id
      UNION ALL
      SELECT ap.book_id, ${sql.raw(AUDIOBOOK_READ_AT)} FROM audiobook_progress ap
      ${linkedAudio}
      WHERE ap.user_id = ${userId}
    ) reads
    GROUP BY reads.book_id
  ) book_last_read`;
}

export function bookLastReadOnSql(bookId: SQLWrapper): SQL {
  return sql`book_last_read.book_id = ${bookId}`;
}
