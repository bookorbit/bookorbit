import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { books, bookFiles } from '../src/db/schema/books';
import { bookSeries, bookSeriesMemberships } from '../src/db/schema/series';
import { ScannerService } from '../src/modules/scanner/scanner.service';
import { createFixtureTree, file, type FixtureTree } from './e2e/scanner/scanner-fixture-builder';
import {
  assertNoIntegrityViolations,
  closeScannerE2EContext,
  createScannerE2EContext,
  seedLibrary,
  triggerLibraryScan,
  waitForScanCompletion,
  type ScannerE2EContext,
} from './e2e/scanner/scanner-harness';

// Issue 1094: two libraries whose folders point at the same filesystem path.
//   Library "Global" -> /biblioteca/user1
//   Library "User1"  -> /biblioteca/user1
const BOOK_ONE = 'Ready Player One/Ready Player One.epub';
const BOOK_TWO = 'Ready Player Two/Ready Player Two.epub';

interface BookRow {
  id: number;
  libraryId: number;
  folderPath: string;
  status: string;
  primaryFileId: number | null;
  fileCount: number;
  primaryFileOwnedBy: number | null;
}

describe('issue 1094 - overlapping library paths', () => {
  let ctx: ScannerE2EContext;
  let tree: FixtureTree;
  let globalLibraryId: number;
  let userLibraryId: number;

  const scan = async (libraryId: number) => {
    const jobId = await triggerLibraryScan(ctx, libraryId);
    await waitForScanCompletion(ctx.db, jobId);
  };

  const loadBooks = async (): Promise<BookRow[]> => {
    const rows = await ctx.db
      .select({
        id: books.id,
        libraryId: books.libraryId,
        folderPath: books.folderPath,
        status: books.status,
        primaryFileId: books.primaryFileId,
      })
      .from(books)
      .where(inArray(books.libraryId, [globalLibraryId, userLibraryId]))
      .orderBy(books.libraryId, books.folderPath);

    const fileRows = await ctx.db.select({ id: bookFiles.id, bookId: bookFiles.bookId }).from(bookFiles);
    const ownerOfFile = new Map(fileRows.map((f) => [f.id, f.bookId]));
    const ownFileCount = new Map<number, number>();
    for (const f of fileRows) ownFileCount.set(f.bookId, (ownFileCount.get(f.bookId) ?? 0) + 1);

    return rows.map((row) => ({
      ...row,
      fileCount: ownFileCount.get(row.id) ?? 0,
      primaryFileOwnedBy: row.primaryFileId == null ? null : (ownerOfFile.get(row.primaryFileId) ?? null),
    }));
  };

  const label = (row: BookRow) =>
    `library=${(row.libraryId === globalLibraryId ? 'Global' : 'User1').padEnd(6)} book=${String(row.id).padEnd(2)} ` +
    `folder="${row.folderPath.split('/').pop()}" status=${row.status} ownFiles=${row.fileCount} ` +
    `primaryFileId=${row.primaryFileId ?? 'null'} thatFileBelongsToBook=${row.primaryFileOwnedBy ?? 'null'} ` +
    `readable=${row.fileCount > 0 ? 'yes' : 'NO'}`;

  beforeAll(async () => {
    ctx = await createScannerE2EContext();
    tree = await createFixtureTree([file(BOOK_ONE), file(BOOK_TWO)], 'issue-1094-');

    // Both libraries are given the exact same root path, as described in the report.
    ({ libraryId: globalLibraryId } = await seedLibrary(ctx.db, { rootPath: tree.rootPath, mode: 'book_per_folder', name: 'Global' }));
    ({ libraryId: userLibraryId } = await seedLibrary(ctx.db, { rootPath: tree.rootPath, mode: 'book_per_folder', name: 'User1' }));
  }, 120_000);

  afterAll(async () => {
    await tree?.cleanup();
    if (ctx) await closeScannerE2EContext(ctx);
  });

  it('creates a second, file-less book record for every physical book', async () => {
    await scan(globalLibraryId);
    await scan(userLibraryId);

    const rows = await loadBooks();
    console.log('\n--- after scanning Global, then User1 ---');
    for (const row of rows) console.log('  ' + label(row));

    // Two physical files on disk.
    const [{ count: fileRowCount }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(bookFiles);
    console.log(`  book_files rows in the whole database: ${fileRowCount}`);

    expect(rows).toHaveLength(4); // 4 book records for 2 physical books
    expect(fileRowCount).toBe(2);

    const readable = rows.filter((r) => r.fileCount > 0);
    const fileLess = rows.filter((r) => r.fileCount === 0);
    expect(readable).toHaveLength(2);
    expect(fileLess).toHaveLength(2);

    // The file-less records are not hidden: they stay 'present' and are served like any other book.
    expect(fileLess.every((r) => r.status === 'present')).toBe(true);

    // The last library to scan takes the files off the first one.
    expect(readable.every((r) => r.libraryId === userLibraryId)).toBe(true);
    expect(fileLess.every((r) => r.libraryId === globalLibraryId)).toBe(true);

    // Worse than the report describes: the stripped books keep a primary_file_id pointing at a
    // file row that now belongs to a different book in a different library.
    expect(fileLess.every((r) => r.primaryFileId != null && r.primaryFileOwnedBy !== r.id)).toBe(true);

    // BookOrbit's own integrity checker classifies exactly this as a violation.
    await expect(assertNoIntegrityViolations(ctx.db)).rejects.toThrow(/invalidPrimaryFileRef/);
  }, 120_000);

  it('reassigns the files again on a forced full rescan of the other library', async () => {
    const scanner = ctx.app.get(ScannerService);

    const { jobId } = await scanner.startScan(globalLibraryId, 'manual', true);
    await waitForScanCompletion(ctx.db, jobId);
    const afterGlobal = await loadBooks();
    console.log('\n--- after a FORCED full rescan of Global ---');
    for (const row of afterGlobal) console.log('  ' + label(row));
    expect(afterGlobal.filter((r) => r.fileCount > 0).every((r) => r.libraryId === globalLibraryId)).toBe(true);
    expect(afterGlobal.filter((r) => r.fileCount === 0).every((r) => r.libraryId === userLibraryId)).toBe(true);

    const { jobId: userJobId } = await scanner.startScan(userLibraryId, 'manual', true);
    await waitForScanCompletion(ctx.db, userJobId);
    const afterUser = await loadBooks();
    console.log('\n--- after a FORCED full rescan of User1 ---');
    for (const row of afterUser) console.log('  ' + label(row));
    expect(afterUser.filter((r) => r.fileCount > 0).every((r) => r.libraryId === userLibraryId)).toBe(true);

    // Whichever library scanned last owns the files, so reordering libraries is not a workaround.
    await expect(assertNoIntegrityViolations(ctx.db)).rejects.toThrow(/invalidPrimaryFileRef/);
  }, 120_000);

  it('counts and lists every duplicate in the series view', async () => {
    const rows = await loadBooks();

    const [series] = await ctx.db
      .insert(bookSeries)
      .values({ name: 'Ready Player', normalizedName: 'ready player', expectedBookCount: 2 })
      .returning();

    // Metadata extraction is mocked out in the e2e harness, so series membership is written
    // directly - exactly the rows a real scan of these two books would produce.
    await ctx.db.insert(bookSeriesMemberships).values(
      rows.map((row) => ({
        bookId: row.id,
        seriesId: series.id,
        seriesIndex: row.folderPath.includes('Two') ? '2' : '1',
      })),
    );

    const listResponse = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/series',
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    const list = listResponse.json();
    const entry = list.items.find((s: { id: number }) => s.id === series.id);
    console.log('\n--- GET /api/v1/series ---');
    console.log(`  name="${entry.name}" bookCount=${entry.bookCount} expectedBookCount=${entry.expectedBookCount}`);

    const booksResponse = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/series/${series.id}/books`,
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    const seriesBooks = booksResponse.json();
    console.log(`\n--- GET /api/v1/series/${series.id}/books ---`);
    for (const b of seriesBooks.items) {
      console.log(`  #${b.seriesIndex} "${b.title}" bookId=${b.id} files=${b.files.length} readable=${b.files.length > 0 ? 'yes' : 'NO'}`);
    }

    // The series claims 4 books; only 2 files exist on disk.
    expect(entry.bookCount).toBe(4);
    expect(entry.expectedBookCount).toBe(2);
    expect(seriesBooks.items).toHaveLength(4);
    expect(seriesBooks.items.filter((b: { files: unknown[] }) => b.files.length === 0)).toHaveLength(2);
    expect(seriesBooks.seriesInfo.bookCount).toBe(4);
  }, 120_000);

  it('shows the duplicates in the plain Books view too, not only in series views', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/books/query',
      headers: { authorization: `Bearer ${ctx.adminToken}` },
      payload: { page: 0, size: 50 },
    });
    const body = response.json();
    console.log('\n--- POST /api/v1/books/query (all accessible libraries) ---');
    console.log(`  status=${response.statusCode} total=${body.total}`);
    for (const b of body.items ?? []) {
      console.log(`  bookId=${b.id} "${b.title}" files=${b.files.length} readable=${b.files.length > 0 ? 'yes' : 'NO'}`);
    }

    expect(body.total).toBe(4);
    expect(body.items.filter((b: { files: unknown[] }) => b.files.length === 0)).toHaveLength(2);
  }, 120_000);
});
