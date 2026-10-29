import { type SQL, eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { deleteBooksWithHashInvalidation, deleteLibraryFoldersWithHashInvalidation } from './book-file-hash-history';
import { books, libraryFolders } from './schema';

const dialect = new PgDialect();

function recorder() {
  const statements: string[] = [];
  const db = {
    execute: vi.fn((query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim());
      return Promise.resolve();
    }),
  };
  return { db, statements };
}

describe('book deletion and reading history', () => {
  it('keeps finished reads with a snapshot when a book leaves the library for good', async () => {
    const { db, statements } = recorder();
    await deleteBooksWithHashInvalidation(db as never, eq(books.id, 5), { keepFinishedReads: true });
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(
      /^delete from "reading_attempts" using "books" .* \("reading_attempts"\."outcome" is null or "reading_attempts"\."deleted_at" is not null\)/,
    );
    expect(statements[1]).toMatch(/^update "reading_attempts" set book_title_snapshot = "book_metadata"\."title"/);
    expect(statements[1]).toContain('book_removed_at = now()');
    expect(statements[2]).toMatch(/^with deleted as \( delete from "books"/);
  });

  it('drops every read of a book folded into another', async () => {
    const { db, statements } = recorder();
    await deleteBooksWithHashInvalidation(db as never, eq(books.id, 5));
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      'delete from "reading_attempts" using "books" where "reading_attempts"."book_id" = "books"."id" and "books"."id" = $1',
    );
    expect(statements[1]).toMatch(/^with deleted as \( delete from "books"/);
  });

  it('keeps the finished reads of every book in a removed folder', async () => {
    const { db, statements } = recorder();
    await deleteLibraryFoldersWithHashInvalidation(db as never, eq(libraryFolders.id, 9));
    expect(statements[0]).toContain(
      '"books"."library_folder_id" in (select "library_folders"."id" from "library_folders" where "library_folders"."id" = $1)',
    );
    expect(statements[1]).toMatch(/^update "reading_attempts"/);
    expect(statements[2]).toMatch(/^with deleted as \( delete from "library_folders"/);
  });
});
