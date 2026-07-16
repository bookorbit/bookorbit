import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import { eq } from 'drizzle-orm';

import { bookFiles, books } from '../src/db/schema';
import {
  closeScannerE2EContext,
  createScannerE2EContext,
  loadLibraryBookState,
  seedLibrary,
  triggerAndWaitForLibraryScan,
  type ScannerE2EContext,
} from './e2e/scanner/scanner-harness';

const mergerFsRoot = process.env.MERGERFS_TEST_ROOT;

describe.skipIf(!mergerFsRoot)('MergerFS inode scanning', () => {
  let ctx: ScannerE2EContext;
  let libraryId: number;

  beforeAll(async () => {
    await mkdir(join(mergerFsRoot!, 'ExistingBook'), { recursive: true });
    await writeFile(join(mergerFsRoot!, 'ExistingBook', 'book.epub'), 'shared-content');
    ctx = await createScannerE2EContext();
    ({ libraryId } = await seedLibrary(ctx.db, {
      rootPath: mergerFsRoot!,
      mode: 'book_per_folder',
      name: 'mergerfs-inode-e2e',
    }));
  });

  afterAll(async () => {
    if (ctx) await closeScannerE2EContext(ctx);
  });

  it('persists exact oversized inodes and keeps identical files in distinct folders', async () => {
    const existingPath = join(mergerFsRoot!, 'ExistingBook', 'book.epub');
    const existingStat = await stat(existingPath, { bigint: true });
    const maxSafeIno = BigInt(Number.MAX_SAFE_INTEGER);
    expect(existingStat.ino < -maxSafeIno || existingStat.ino > maxSafeIno).toBe(true);

    await triggerAndWaitForLibraryScan(ctx, libraryId);

    const [storedExisting] = await ctx.db
      .select({ ino: bookFiles.ino })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(books.libraryId, libraryId));
    expect(storedExisting.ino).toBe(existingStat.ino);

    await mkdir(join(mergerFsRoot!, 'NewBook'), { recursive: true });
    await writeFile(join(mergerFsRoot!, 'NewBook', 'book.epub'), 'shared-content');
    await triggerAndWaitForLibraryScan(ctx, libraryId);

    const state = await loadLibraryBookState(ctx.db, libraryId);
    expect(state).toHaveLength(2);
    expect(state.map((book) => book.folderPath)).toEqual([join(mergerFsRoot!, 'ExistingBook'), join(mergerFsRoot!, 'NewBook')]);
  });
});
