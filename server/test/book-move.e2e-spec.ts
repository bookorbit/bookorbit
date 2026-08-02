import { randomUUID } from 'crypto';
import { access, readFile } from 'fs/promises';
import { join } from 'path';

import { and, eq } from 'drizzle-orm';
import type { MoveBookOutcome } from '@bookorbit/types';

import { bookFiles, books, userBookStatus } from '../src/db/schema';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  locateBookFileByRelPath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type MetadataWriteE2EContext,
} from './e2e/metadata-write/metadata-write-harness';
import { createEpubFixture, writeFixtureFile } from './e2e/metadata-write/metadata-write-fixture-builder';

const SCENARIO_TIMEOUT_MS = 120_000;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('Book move between libraries (e2e)', () => {
  let ctx: MetadataWriteE2EContext;

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();
  }, SCENARIO_TIMEOUT_MS);

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  async function seedBookInLibrary(library: CreatedLibrary, relPath: string): Promise<LocatedBookFile> {
    await createEpubFixture(library.folderPath, relPath);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    return locateBookFileByRelPath(ctx, library.libraryId, relPath);
  }

  async function moveBooks(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/v1/books/move',
      headers: authHeader(ctx.adminToken),
      payload,
    });
  }

  it(
    'moves a book into another library, re-parenting rows, relocating files, and preserving user state',
    async () => {
      const src = await createLibraryWithFolder(ctx, { name: `move-src-${randomUUID()}` });
      const dst = await createLibraryWithFolder(ctx, { name: `move-dst-${randomUUID()}` });
      const book = await seedBookInLibrary(src, 'moving/book.epub');

      const reader = await createUserAndLogin(ctx);
      await ctx.db.insert(userBookStatus).values({ userId: reader.userId, bookId: book.bookId, status: 'reading', source: 'manual' });

      const response = await moveBooks({ bookIds: [book.bookId], targetLibraryId: dst.libraryId });

      expect(response.statusCode).toBe(201);
      const { results } = response.json() as { results: MoveBookOutcome[] };
      expect(results).toEqual([{ bookId: book.bookId, status: 'moved' }]);

      // Book row re-parented; this is the regression guard for
      // book_files_book_folder_consistency_fk (books must be updated before files).
      const [movedBook] = await ctx.db.select().from(books).where(eq(books.id, book.bookId));
      expect(movedBook.libraryId).toBe(dst.libraryId);
      expect(movedBook.libraryFolderId).toBe(dst.libraryFolderId);
      expect(movedBook.folderPath.startsWith(dst.folderPath)).toBe(true);

      const movedFiles = await ctx.db.select().from(bookFiles).where(eq(bookFiles.bookId, book.bookId));
      expect(movedFiles.length).toBeGreaterThan(0);
      for (const file of movedFiles) {
        expect(file.libraryFolderId).toBe(dst.libraryFolderId);
        expect(file.absolutePath.startsWith(dst.folderPath)).toBe(true);
        await expect(pathExists(file.absolutePath)).resolves.toBe(true);
      }
      await expect(pathExists(join(src.folderPath, 'moving/book.epub'))).resolves.toBe(false);

      // User state stays attached because the book id is preserved.
      const [status] = await ctx.db
        .select()
        .from(userBookStatus)
        .where(and(eq(userBookStatus.userId, reader.userId), eq(userBookStatus.bookId, book.bookId)));
      expect(status?.status).toBe('reading');
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'skips the move when the target path already exists on disk and leaves the book untouched',
    async () => {
      const src = await createLibraryWithFolder(ctx, { name: `move-src-${randomUUID()}` });
      const dst = await createLibraryWithFolder(ctx, { name: `move-dst-${randomUUID()}` });
      const book = await seedBookInLibrary(src, 'dupe/book.epub');
      await writeFixtureFile(dst.folderPath, 'dupe/book.epub', 'already here');

      const response = await moveBooks({ bookIds: [book.bookId], targetLibraryId: dst.libraryId });

      expect(response.statusCode).toBe(201);
      const { results } = response.json() as { results: MoveBookOutcome[] };
      expect(results).toEqual([{ bookId: book.bookId, status: 'skipped', reason: 'target_path_exists' }]);

      const [unchanged] = await ctx.db.select().from(books).where(eq(books.id, book.bookId));
      expect(unchanged.libraryId).toBe(src.libraryId);
      expect(unchanged.libraryFolderId).toBe(src.libraryFolderId);
      await expect(pathExists(join(src.folderPath, 'dupe/book.epub'))).resolves.toBe(true);
      // The colliding file in the target must not have been overwritten.
      await expect(readFile(join(dst.folderPath, 'dupe/book.epub'), 'utf8')).resolves.toBe('already here');
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'rejects a target folder that belongs to a different library and leaves the book untouched',
    async () => {
      const src = await createLibraryWithFolder(ctx, { name: `move-src-${randomUUID()}` });
      const dst = await createLibraryWithFolder(ctx, { name: `move-dst-${randomUUID()}` });
      const book = await seedBookInLibrary(src, 'wrong-folder/book.epub');

      const response = await moveBooks({
        bookIds: [book.bookId],
        targetLibraryId: dst.libraryId,
        targetFolderId: src.libraryFolderId,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ statusCode: 400, message: expect.stringContaining('does not belong to library') });

      const [unchanged] = await ctx.db.select().from(books).where(eq(books.id, book.bookId));
      expect(unchanged.libraryId).toBe(src.libraryId);
      expect(unchanged.libraryFolderId).toBe(src.libraryFolderId);
      await expect(pathExists(join(src.folderPath, 'wrong-folder/book.epub'))).resolves.toBe(true);
      await expect(pathExists(join(dst.folderPath, 'wrong-folder/book.epub'))).resolves.toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'skips books whose format is not allowed in the target library and leaves files in place',
    async () => {
      const src = await createLibraryWithFolder(ctx, { name: `move-src-${randomUUID()}` });
      const dst = await createLibraryWithFolder(ctx, { name: `move-dst-${randomUUID()}`, allowedFormats: ['pdf'] });
      const book = await seedBookInLibrary(src, 'format/book.epub');

      const response = await moveBooks({ bookIds: [book.bookId], targetLibraryId: dst.libraryId });

      expect(response.statusCode).toBe(201);
      const { results } = response.json() as { results: MoveBookOutcome[] };
      expect(results).toEqual([{ bookId: book.bookId, status: 'skipped', reason: 'format_not_allowed' }]);

      const [unchanged] = await ctx.db.select().from(books).where(eq(books.id, book.bookId));
      expect(unchanged.libraryId).toBe(src.libraryId);
      expect(unchanged.libraryFolderId).toBe(src.libraryFolderId);
      await expect(pathExists(join(src.folderPath, 'format/book.epub'))).resolves.toBe(true);
      await expect(pathExists(join(dst.folderPath, 'format/book.epub'))).resolves.toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );
});
