import { eq } from 'drizzle-orm';
import { createCapturingDb } from '../common/test-utils/capture-sql-db';
import * as schema from './schema';
import {
  deleteBookFilesWithHashInvalidation,
  deleteBooksWithHashInvalidation,
  deleteLibraryFoldersWithHashInvalidation,
  recordBookFileHashHistory,
} from './book-file-hash-history';

const HASH = 'a'.repeat(32);

describe('hash identity revision writes', () => {
  it('commits registration and source-replacement invalidation in one statement', async () => {
    const { db, queries } = createCapturingDb();
    await recordBookFileHashHistory(db, 22, HASH, 'external_change');
    expect(queries).toHaveLength(1);
    const query = queries[0]!;
    expect(query.sql).toContain('with registered as');
    expect(query.sql).toContain('on conflict (book_file_id, file_hash) do update');
    expect(query.sql).toContain("where excluded.reason <> 'kobo_download'");
    expect(query.sql).toContain('set reason = excluded.reason, created_at = now()');
    expect(query.sql).toContain('returning book_file_id');
    expect(query.sql).toContain('update "libraries"');
    expect(query.sql).toContain('koreader_hash_revision = koreader_hash_revision + 1');
    expect(query.sql).toContain('from registered');
    expect(query.params).toEqual([HASH, 'external_change', 22]);
  });

  // Book and folder deletions first settle the reading history of the books they take (the
  // reading-attempt-retention tests cover those statements), so the delete is the last statement.
  it.each([
    { table: 'book_files', run: deleteBookFilesWithHashInvalidation, filter: eq(schema.bookFiles.id, 22), statements: 1 },
    { table: 'books', run: deleteBooksWithHashInvalidation, filter: eq(schema.books.id, 22), statements: 2 },
    { table: 'library_folders', run: deleteLibraryFoldersWithHashInvalidation, filter: eq(schema.libraryFolders.id, 22), statements: 3 },
  ])('commits $table deletion and invalidation together, including cascading history deletion', async ({ table, run, filter, statements }) => {
    const { db, queries } = createCapturingDb();
    await run(db, filter);
    expect(queries).toHaveLength(statements);
    const query = queries.at(-1)!;
    expect(query.sql).toContain('with deleted as');
    expect(query.sql).toContain(`delete from "${table}" where`);
    expect(query.sql).toContain('update "libraries"');
    expect(query.sql).toContain('koreader_hash_revision = koreader_hash_revision + 1');
    expect(query.sql).toContain('deleted');
    expect(query.params).toEqual([22]);
  });

  it('propagates database failure so callers cannot commit a mutation without its invalidation', async () => {
    const failure = new Error('Database unavailable');
    const db = { execute: vi.fn().mockRejectedValue(failure) };
    await expect(deleteBooksWithHashInvalidation(db as never, eq(schema.books.id, 22))).rejects.toBe(failure);
    await expect(recordBookFileHashHistory(db as never, 22, HASH, 'kobo_download')).rejects.toBe(failure);
  });
});
