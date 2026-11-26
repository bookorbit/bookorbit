import { sql, type SQL } from 'drizzle-orm';

import { bookFiles, readingSessions } from './schema';

/**
 * The format a reading session was read in: its file's, or the one kept when the file was deleted.
 * The query must left join `book_files` on `reading_sessions.book_file_id`.
 */
export function readingSessionFormatSql(): SQL<string | null> {
  return sql<string | null>`coalesce(${bookFiles.format}, ${readingSessions.fileFormatSnapshot})`;
}
