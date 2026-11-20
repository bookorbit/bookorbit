import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function latestReadingSessionSql(bookId: SQLWrapper, userId: number): SQL {
  return sql`(
    SELECT rs.started_at FROM reading_sessions rs
    WHERE rs.user_id = ${userId} AND rs.book_id = ${bookId}
    ORDER BY rs.started_at DESC LIMIT 1
  )`;
}

export function bookLastReadSql(bookId: SQLWrapper, userId: number): SQL<Date | null> {
  return sql<Date | null>`greatest(${latestReadingSessionSql(bookId, userId)}, (
    SELECT max(rp.last_read_at) FROM reading_progress rp
    INNER JOIN book_files bf ON rp.book_file_id = bf.id
    WHERE bf.book_id = ${bookId} AND rp.user_id = ${userId}
  ))`;
}
