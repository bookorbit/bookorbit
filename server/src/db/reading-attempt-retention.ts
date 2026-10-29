import { type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

type Executor = Pick<NodePgDatabase<typeof schema>, 'execute'>;

/**
 * Keeps every finished read of the books matching `booksFilter` when those books are deleted.
 *
 * `reading_attempts.book_id` is `on delete set null`, so a finished read survives its book. This
 * writes the snapshot that names it afterwards (title, authors, format, pages, library, when it
 * went), and drops what has no history value: reads still open and reads already in the trash.
 * Call it in the same transaction as the delete, before it.
 */
export async function retainFinishedReads(db: Executor, booksFilter: SQL): Promise<void> {
  await db.execute(sql`
    delete from ${schema.readingAttempts}
    using ${schema.books}
    where ${schema.readingAttempts.bookId} = ${schema.books.id}
      and (${schema.readingAttempts.outcome} is null or ${schema.readingAttempts.deletedAt} is not null)
      and ${booksFilter}
  `);
  await db.execute(sql`
    update ${schema.readingAttempts}
    set book_title_snapshot = ${schema.bookMetadata.title},
        book_authors_snapshot = (
          select json_agg(${schema.authors.name} order by ${schema.bookAuthors.displayOrder})::text
          from ${schema.bookAuthors}
          join ${schema.authors} on ${schema.authors.id} = ${schema.bookAuthors.authorId}
          where ${schema.bookAuthors.bookId} = ${schema.books.id}
        ),
        book_format_snapshot = (select ${schema.bookFiles.format} from ${schema.bookFiles} where ${schema.bookFiles.id} = ${schema.books.primaryFileId}),
        book_page_count_snapshot = ${schema.bookMetadata.pageCount},
        book_library_id_snapshot = ${schema.books.libraryId},
        book_removed_at = now()
    from ${schema.books}
    left join ${schema.bookMetadata} on ${schema.bookMetadata.bookId} = ${schema.books.id}
    where ${schema.readingAttempts.bookId} = ${schema.books.id}
      and ${booksFilter}
  `);
}

/**
 * Drops every read of the books matching `booksFilter`. For deletes that fold one book into
 * another (merges, rolled-back uploads), where a read of the discarded copy is not history.
 */
export async function dropReads(db: Executor, booksFilter: SQL): Promise<void> {
  await db.execute(sql`
    delete from ${schema.readingAttempts}
    using ${schema.books}
    where ${schema.readingAttempts.bookId} = ${schema.books.id}
      and ${booksFilter}
  `);
}
