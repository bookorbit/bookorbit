import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { MigrationExecutorService } from './migration-executor.service';

async function createSampleImageBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 12,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function createDbMock(existingRows: unknown[][] = [[]]) {
  const limit = vi.fn(() => Promise.resolve(existingRows.shift() ?? []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const onConflictDoUpdate = vi.fn(() => Promise.resolve(undefined));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const deleteWhere = vi.fn(() => Promise.resolve(undefined));
  const deleteMock = vi.fn(() => ({ where: deleteWhere }));

  return {
    db: { select, insert, delete: deleteMock },
    mocks: { limit, where, from, select, onConflictDoUpdate, values, insert, deleteWhere, deleteMock },
  };
}

function createRepoMock() {
  return {
    incrementRunMetric: vi.fn(() => Promise.resolve(undefined)),
  };
}

describe('MigrationExecutorService audiobook progress import', () => {
  it('imports only rows mapped to target audio books', async () => {
    const repo = createRepoMock();
    const { db, mocks } = createDbMock([[]]);
    const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue('/tmp/books') } as never);

    const planned = {
      execution: {
        sourceData: {
          userFileProgress: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'source-audio',
              percentage: 42,
              cfi: null,
              pageNumber: null,
              positionSeconds: 120.5,
              updatedAt: '2025-01-01T10:00:00.000Z',
            },
            {
              sourceUserId: 'u1',
              sourceBookId: 'source-ebook',
              percentage: 65,
              cfi: 'epubcfi(/6/2)',
              pageNumber: 23,
              positionSeconds: 500,
              updatedAt: '2025-01-01T10:00:00.000Z',
            },
          ],
        },
      },
    };

    await (service as any).importAudiobookProgress(
      77,
      planned,
      new Map([['u1', 10]]),
      new Map([
        ['source-audio', 101],
        ['source-ebook', 102],
      ]),
      new Map([[101, 1001]]),
      new Map(),
      async () => {},
    );

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        bookId: 101,
        currentFileId: 1001,
        percentage: 42,
        positionSeconds: 120.5,
      }),
    );
    expect(repo.incrementRunMetric).toHaveBeenCalledWith(
      77,
      'user_state',
      'audiobook_progress',
      expect.objectContaining({
        processed: 1,
        imported: 1,
        skipped: 0,
        unresolved: 0,
        failed: 0,
      }),
    );
  });

  it('overwrites target audiobook progress even when the target is newer', async () => {
    const repo = createRepoMock();
    const { db, mocks } = createDbMock([[{ updatedAt: new Date('2025-01-02T00:00:00.000Z') }]]);
    const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue('/tmp/books') } as never);

    const planned = {
      execution: {
        sourceData: {
          userFileProgress: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'source-audio',
              percentage: 10,
              cfi: null,
              pageNumber: null,
              positionSeconds: 33,
              updatedAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    };

    await (service as any).importAudiobookProgress(
      88,
      planned,
      new Map([['u1', 10]]),
      new Map([['source-audio', 101]]),
      new Map([[101, 1001]]),
      new Map(),
      async () => {},
    );

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(repo.incrementRunMetric).toHaveBeenCalledWith(
      88,
      'user_state',
      'audiobook_progress',
      expect.objectContaining({
        processed: 1,
        imported: 1,
        skipped: 0,
        unresolved: 0,
      }),
    );
  });
});

describe('MigrationExecutorService author import', () => {
  it('replaces target book authors from source author names', async () => {
    const repo = createRepoMock();
    const deleteWhere = vi.fn(() => Promise.resolve(undefined));
    const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
    const deleteMock = vi.fn(() => ({ where: deleteWhere }));

    const onConflictDoNothing = vi.fn(() => Promise.resolve(undefined));
    const bookAuthorValues = vi.fn(() => ({ onConflictDoNothing }));
    const authorReturning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 101 }])
      .mockResolvedValueOnce([{ id: 102 }]);
    const authorOnConflictDoUpdate = vi.fn(() => ({ returning: authorReturning }));
    const authorValues = vi.fn(() => ({ onConflictDoUpdate: authorOnConflictDoUpdate }));
    const insert = vi
      .fn()
      .mockReturnValueOnce({ values: authorValues })
      .mockReturnValueOnce({ values: bookAuthorValues })
      .mockReturnValueOnce({ values: authorValues })
      .mockReturnValueOnce({ values: bookAuthorValues });

    const db = { delete: deleteMock, insert };
    const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue('/tmp/books') } as never);

    const planned = {
      execution: {
        matchedBooks: [{ sourceBookId: 'source-1', targetBookId: 901 }],
        sourceData: {
          books: [{ sourceBookId: 'source-1', author: 'Ada Lovelace; Grace Hopper' }],
        },
      },
    };

    await (service as any).importAuthors(91, planned);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(authorValues).toHaveBeenNthCalledWith(1, { name: 'Ada Lovelace', sortName: 'Ada Lovelace' });
    expect(authorValues).toHaveBeenNthCalledWith(2, { name: 'Grace Hopper', sortName: 'Grace Hopper' });
    expect(bookAuthorValues).toHaveBeenNthCalledWith(1, { bookId: 901, authorId: 101, displayOrder: 0 });
    expect(bookAuthorValues).toHaveBeenNthCalledWith(2, { bookId: 901, authorId: 102, displayOrder: 1 });
    expect(repo.incrementRunMetric).toHaveBeenCalledWith(
      91,
      'shared_overlays',
      'book_authors',
      expect.objectContaining({ processed: 1, imported: 2, skipped: 0, unresolved: 0 }),
    );

    expect(deleteFrom).not.toHaveBeenCalled();
  });
});

describe('MigrationExecutorService book cover import', () => {
  it('copies source cover and thumbnail into target cover directory and marks cover source custom', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'migration-source-media-'));
    const booksPath = await mkdtemp(join(tmpdir(), 'migration-target-books-'));
    try {
      const sourceDir = join(sourceRoot, 'images', 'source-1');
      await mkdir(sourceDir, { recursive: true });
      const sourceCoverBytes = await createSampleImageBytes();
      const sourceThumbnailBytes = await createSampleImageBytes();
      await writeFile(join(sourceDir, 'cover.jpg'), sourceCoverBytes);
      await writeFile(join(sourceDir, 'thumbnail.jpg'), sourceThumbnailBytes);

      const repo = createRepoMock();
      const { db, mocks } = createDbMock();
      const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue(booksPath) } as never);

      const planned = {
        execution: {
          matchedBooks: [{ sourceBookId: 'source-1', targetBookId: 901 }],
        },
      };

      await (service as any).importBookCovers(52, planned, sourceRoot, async () => {});

      const targetDir = join(booksPath, 'covers', '901');
      const targetFiles = await readdir(targetDir);
      const copiedCoverName = targetFiles.find((entry) => entry.startsWith('cover_custom.'));
      expect(copiedCoverName).toBeTruthy();
      expect(targetFiles).toContain('thumbnail.jpg');

      const copiedCoverBytes = await readFile(join(targetDir, copiedCoverName!));
      const copiedThumbnailBytes = await readFile(join(targetDir, 'thumbnail.jpg'));
      expect(copiedCoverBytes.equals(sourceCoverBytes)).toBe(true);
      expect(copiedThumbnailBytes.equals(sourceThumbnailBytes)).toBe(true);

      expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ bookId: 901, coverSource: 'custom' }));
      expect(repo.incrementRunMetric).toHaveBeenCalledWith(
        52,
        'shared_overlays',
        'book_covers',
        expect.objectContaining({ processed: 1, imported: 1, unresolved: 0, failed: 0 }),
      );
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(booksPath, { recursive: true, force: true });
    }
  });

  it('generates target thumbnail when source thumbnail is missing', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'migration-source-media-'));
    const booksPath = await mkdtemp(join(tmpdir(), 'migration-target-books-'));
    try {
      const sourceDir = join(sourceRoot, 'images', 'source-2');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, 'cover.jpg'), await createSampleImageBytes());

      const repo = createRepoMock();
      const { db } = createDbMock();
      const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue(booksPath) } as never);

      const planned = {
        execution: {
          matchedBooks: [{ sourceBookId: 'source-2', targetBookId: 902 }],
        },
      };

      await (service as any).importBookCovers(53, planned, sourceRoot, async () => {});

      const generatedThumbnail = await readFile(join(booksPath, 'covers', '902', 'thumbnail.jpg'));
      expect(generatedThumbnail.length).toBeGreaterThan(0);
      expect(repo.incrementRunMetric).toHaveBeenCalledWith(
        53,
        'shared_overlays',
        'book_covers',
        expect.objectContaining({ processed: 1, imported: 1, unresolved: 0, failed: 0 }),
      );
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(booksPath, { recursive: true, force: true });
    }
  });

  it('skips book cover stage when source media root is not configured', async () => {
    const repo = createRepoMock();
    const { db, mocks } = createDbMock();
    const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue('/tmp/books') } as never);

    const planned = {
      execution: {
        matchedBooks: [{ sourceBookId: 'source-3', targetBookId: 903 }],
      },
    };

    await (service as any).importBookCovers(54, planned, null, async () => {});

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(repo.incrementRunMetric).toHaveBeenCalledWith(
      54,
      'shared_overlays',
      'book_covers',
      expect.objectContaining({ processed: 1, skipped: 1, imported: 0 }),
    );
  });
});

describe('MigrationExecutorService collection import', () => {
  it('skips shelf-book rows that do not belong to the shelf owner', async () => {
    const repo = createRepoMock();
    const selectWhere = vi.fn(() => Promise.resolve([]));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const collectionReturning = vi.fn().mockResolvedValue([{ id: 701 }]);
    const collectionValues = vi.fn(() => ({ returning: collectionReturning }));

    const collectionBookReturning = vi.fn().mockResolvedValue([{ collectionId: 701 }]);
    const onConflictDoNothing = vi.fn(() => ({ returning: collectionBookReturning }));
    const collectionBookValues = vi.fn(() => ({ onConflictDoNothing }));

    const insert = vi.fn().mockReturnValueOnce({ values: collectionValues }).mockReturnValue({ values: collectionBookValues });
    const deleteWhere = vi.fn(() => Promise.resolve(undefined));
    const deleteMock = vi.fn(() => ({ where: deleteWhere }));

    const db = { select, insert, delete: deleteMock };
    const service = new MigrationExecutorService(repo as never, {} as never, db as never, { get: vi.fn().mockReturnValue('/tmp/books') } as never);

    const planned = {
      execution: {
        sourceData: {
          shelves: [{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }],
          shelfBooks: [
            { sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'source-1' },
            { sourceShelfId: 's1', sourceUserId: 'u2', sourceBookId: 'source-2' },
          ],
        },
      },
    };

    await (service as any).importCollections(
      78,
      planned,
      new Map([['u1', 10]]),
      new Map([
        ['source-1', 101],
        ['source-2', 102],
      ]),
      async () => {},
    );

    expect(insert).toHaveBeenCalledTimes(2);
    expect(collectionBookValues).toHaveBeenCalledTimes(1);
    expect(collectionBookValues).toHaveBeenCalledWith({ collectionId: 701, bookId: 101 });
    expect(repo.incrementRunMetric).toHaveBeenCalledWith(
      78,
      'user_state',
      'collections',
      expect.objectContaining({
        processed: 2,
        imported: 1,
        skipped: 0,
        unresolved: 1,
        failed: 0,
      }),
    );
  });
});
