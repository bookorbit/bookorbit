import { eq } from 'drizzle-orm';
import { createCapturingDb } from '../common/test-utils/capture-sql-db';
import * as schema from './schema';
import {
  bumpKoreaderHashRevisions,
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
  // Deleting books also tombstones their Kobo entitlements and drops link groups left with one member in
  // the same statement; for a folder both repeat the books filter.
  it.each([
    { table: 'book_files', run: deleteBookFilesWithHashInvalidation, filter: eq(schema.bookFiles.id, 22), statements: 1, params: [22] },
    { table: 'books', run: deleteBooksWithHashInvalidation, filter: eq(schema.books.id, 22), statements: 2, params: [22, 22] },
    {
      table: 'library_folders',
      run: deleteLibraryFoldersWithHashInvalidation,
      filter: eq(schema.libraryFolders.id, 22),
      statements: 3,
      params: [22, 22, 22, 22],
    },
  ])(
    'commits $table deletion and invalidation together, including cascading history deletion',
    async ({ table, run, filter, statements, params }) => {
      const { db, queries } = createCapturingDb();
      await run(db, filter);
      expect(queries).toHaveLength(statements);
      const query = queries.at(-1)!;
      expect(query.sql).toContain('with deleted as');
      expect(query.sql).toContain(`delete from "${table}" where`);
      expect(query.sql).toContain('update "libraries"');
      expect(query.sql).toContain('koreader_hash_revision = koreader_hash_revision + 1');
      expect(query.sql).toContain('deleted');
      expect(query.params).toEqual(params);
    },
  );

  it.each([
    { table: 'books', run: deleteBooksWithHashInvalidation, filter: eq(schema.books.id, 22) },
    { table: 'library_folders', run: deleteLibraryFoldersWithHashInvalidation, filter: eq(schema.libraryFolders.id, 22) },
  ])('tombstones the Kobo entitlements of the books a $table delete removes, in the delete statement', async ({ run, filter }) => {
    const { db, queries } = createCapturingDb();
    await run(db, filter);
    const query = queries.at(-1)!;
    expect(query.sql).toContain('insert into "kobo_entitlement_tombstones"');
    expect(query.sql).toContain('insert into "kobo_device_entitlement_tombstones"');
    expect(query.sql).toContain('"kobo_book_entitlements"."book_id" in (select "books"."id" from "books" where');
  });

  it('leaves book file deletes, which keep the book, without tombstones', async () => {
    const { db, queries } = createCapturingDb();
    await deleteBookFilesWithHashInvalidation(db, eq(schema.bookFiles.id, 22));
    expect(queries[0]!.sql).not.toContain('kobo_entitlement_tombstones');
  });

  it('moves the revision of every named library on once, in one statement', async () => {
    const { db, queries } = createCapturingDb();
    await bumpKoreaderHashRevisions(db, [4, 9, 4]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('update "libraries"');
    expect(queries[0]!.sql).toContain('koreader_hash_revision = koreader_hash_revision + 1');
    expect(queries[0]!.sql).toContain('"libraries"."id" in ($1, $2)');
    expect(queries[0]!.params).toEqual([4, 9]);
  });

  it('issues nothing when no library is named', async () => {
    const { db, queries } = createCapturingDb();
    await bumpKoreaderHashRevisions(db, []);
    expect(queries).toEqual([]);
  });

  it('propagates database failure so callers cannot commit a mutation without its invalidation', async () => {
    const failure = new Error('Database unavailable');
    const db = { execute: vi.fn().mockRejectedValue(failure) };
    await expect(deleteBooksWithHashInvalidation(db as never, eq(schema.books.id, 22))).rejects.toBe(failure);
    await expect(recordBookFileHashHistory(db as never, 22, HASH, 'kobo_download')).rejects.toBe(failure);
    await expect(bumpKoreaderHashRevisions(db as never, [22])).rejects.toBe(failure);
  });
});
