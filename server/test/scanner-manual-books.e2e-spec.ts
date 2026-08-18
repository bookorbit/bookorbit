import { eq, inArray } from 'drizzle-orm';

import { createFixtureTree, file } from './e2e/scanner/scanner-fixture-builder';
import {
  assertNoIntegrityViolations,
  closeScannerE2EContext,
  createScannerE2EContext,
  seedLibrary,
  triggerAndWaitForLibraryScan,
  type ScannerE2EContext,
} from './e2e/scanner/scanner-harness';
import { bookMetadata, books, libraries, libraryFolders } from '../src/db/schema';
import { ScannerRepository } from '../src/modules/scanner/scanner.repository';

const SCAN_TIMEOUT_MS = 60_000;

async function seedManualBook(ctx: ScannerE2EContext, libraryId: number, marker: string) {
  const [manualFolder] = await ctx.db
    .insert(libraryFolders)
    .values({ libraryId, path: `bookorbit-manual://${marker}`, kind: 'manual' })
    .returning({ id: libraryFolders.id });

  const [manualBook] = await ctx.db
    .insert(books)
    .values({
      libraryId,
      libraryFolderId: manualFolder.id,
      folderPath: `bookorbit-manual://${marker}/1`,
      status: 'present',
      originType: 'manual',
    })
    .returning();

  // Every book carries a metadata row (harness integrity invariant; the real
  // manual-create path writes one too).
  await ctx.db.insert(bookMetadata).values({ bookId: manualBook.id, title: `Manual Book ${marker}` });

  return { manualFolderId: manualFolder.id, manualBook };
}

describe('scanner with manual books present', () => {
  let ctx: ScannerE2EContext;
  const cleanups: Array<() => Promise<void>> = [];
  const seededLibraryIds: number[] = [];

  async function seedScenarioLibrary(rootPath: string) {
    const seeded = await seedLibrary(ctx.db, { rootPath, mode: 'book_per_folder' });
    seededLibraryIds.push(seeded.libraryId);
    return seeded;
  }

  beforeAll(async () => {
    ctx = await createScannerE2EContext();
  });

  afterAll(async () => {
    // Surface any dangling rows the scans introduced before cleanup can hide them.
    await assertNoIntegrityViolations(ctx.db);
    if (seededLibraryIds.length > 0) {
      await ctx.db.delete(libraries).where(inArray(libraries.id, seededLibraryIds));
    }
    for (const cleanup of cleanups) await cleanup();
    await closeScannerE2EContext(ctx);
  });

  it(
    'leaves a manual book byte-for-byte unchanged across two full scans',
    async () => {
      const fixture = await createFixtureTree([file('Real Book/book.epub')], 'scanner-e2e-manual-');
      cleanups.push(fixture.cleanup);
      const { libraryId } = await seedScenarioLibrary(fixture.rootPath);
      const { manualBook } = await seedManualBook(ctx, libraryId, `idempotence-${libraryId}`);

      const firstJob = await triggerAndWaitForLibraryScan(ctx, libraryId, SCAN_TIMEOUT_MS);
      expect(firstJob.status).toBe('completed');
      const secondJob = await triggerAndWaitForLibraryScan(ctx, libraryId, SCAN_TIMEOUT_MS);
      expect(secondJob.status).toBe('completed');

      const [after] = await ctx.db.select().from(books).where(eq(books.id, manualBook.id));
      expect(after).toEqual(manualBook);
    },
    SCAN_TIMEOUT_MS * 2,
  );

  it(
    'scans the file-backed half of a mixed library normally',
    async () => {
      const fixture = await createFixtureTree([file('Present Book/book.epub')], 'scanner-e2e-manual-mixed-');
      cleanups.push(fixture.cleanup);
      const { libraryId } = await seedScenarioLibrary(fixture.rootPath);
      await seedManualBook(ctx, libraryId, `mixed-${libraryId}`);

      await triggerAndWaitForLibraryScan(ctx, libraryId, SCAN_TIMEOUT_MS);

      const libraryBooks = await ctx.db
        .select({ status: books.status, originType: books.originType })
        .from(books)
        .where(eq(books.libraryId, libraryId));
      expect(libraryBooks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'present', originType: 'file_system' }),
          expect.objectContaining({ status: 'present', originType: 'manual' }),
        ]),
      );
      expect(libraryBooks).toHaveLength(2);
    },
    SCAN_TIMEOUT_MS * 2,
  );

  it('markBooksAsMissing refuses to mark manual-origin books missing', async () => {
    const fixture = await createFixtureTree([], 'scanner-e2e-manual-guard-');
    cleanups.push(fixture.cleanup);
    const { libraryId } = await seedScenarioLibrary(fixture.rootPath);
    const { manualBook } = await seedManualBook(ctx, libraryId, `guard-${libraryId}`);

    const repo = ctx.app.get(ScannerRepository);
    await repo.markBooksAsMissing([manualBook.id]);

    const [after] = await ctx.db.select({ status: books.status }).from(books).where(eq(books.id, manualBook.id));
    expect(after.status).toBe('present');
  });
});
