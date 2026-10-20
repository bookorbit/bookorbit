import { and, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { QueryBuilder, alias } from 'drizzle-orm/pg-core';

import { AUDIO_FORMAT_LIST } from '@bookorbit/types';
import { bookFiles, books } from '../../db/schema';

const contentFile = alias(bookFiles, 'audio_only_content_file');
const AUDIO_FORMATS = [...AUDIO_FORMAT_LIST];

/**
 * Keeps every book except one whose content files are all audio. A book with an audiobook beside an
 * ebook stays, whichever of them is primary, and so does a book with no content file at all.
 *
 * Written as a scalar aggregate on purpose. The same test as nested NOT EXISTS gets flattened into
 * anti-joins whose row estimate collapses to one, and the nested loop that follows took 59s to count
 * 38,000 books with 6,000 audiobooks. A scalar subquery is never flattened: it stays one probe of
 * book_files_book_id_idx per book the query already reads, about 1.6µs each on that library.
 * `bookId` defaults to the books table and accepts any column holding a book id, such as a CTE's.
 */
export function excludeAudioOnlyBooks(bookId: SQLWrapper = books.id): SQL {
  const everyContentFileIsAudio = new QueryBuilder()
    .select({ allAudio: sql<boolean>`bool_and(coalesce(${inArray(contentFile.format, AUDIO_FORMATS)}, false))` })
    .from(contentFile)
    .where(and(sql`${contentFile.bookId} = ${bookId}`, eq(contentFile.role, 'content')));
  return sql`(${everyContentFileIsAudio}) is not true`;
}
