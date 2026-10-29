import { type SQL, and, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { books, readingAttempts } from '../../db/schema';

/**
 * Which of a reader's finished reads count, for every surface that counts them (the reading goal,
 * Activity, the completion charts, History). Queries left join `books`: a read whose book was
 * deleted keeps counting, scoped by the library it was in. Content filters need the book's tags
 * and genres, so they apply to reads of books that still exist.
 *
 * `libraryIds` null means every library.
 */
export function finishedReadScope(libraryIds: readonly number[] | null, contentFilterClauses: SQL[] = []): SQL {
  if (libraryIds !== null && libraryIds.length === 0) return sql`false`;
  const present = and(isNotNull(readingAttempts.bookId), libraryIds ? inArray(books.libraryId, [...libraryIds]) : undefined, ...contentFilterClauses);
  const removed = and(isNull(readingAttempts.bookId), libraryIds ? inArray(readingAttempts.bookLibraryIdSnapshot, [...libraryIds]) : undefined);
  return or(present, removed) ?? sql`true`;
}
