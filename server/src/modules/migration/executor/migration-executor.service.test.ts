import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { SharedOverlaysImporter } from './shared-overlays.importer';
import { CoverImporter } from './cover.importer';
import { UserStateImporter } from './user-state.importer';

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

function createRepoMock() {
  return {
    setRunMetric: vi.fn(() => Promise.resolve(undefined)),
  };
}

function createScanGatewayMock() {
  return {
    emitCoverRefreshed: vi.fn(),
  };
}

function createImportRepoMock() {
  const repo = {
    // Single-row methods (kept for backward compat)
    upsertBookMetadata: vi.fn(() => Promise.resolve()),
    deleteBookAuthors: vi.fn(() => Promise.resolve()),
    upsertAuthor: vi.fn(),
    insertBookAuthor: vi.fn(() => Promise.resolve()),
    deleteBookNarrators: vi.fn(() => Promise.resolve()),
    upsertNarrator: vi.fn(),
    insertBookNarrator: vi.fn(() => Promise.resolve()),
    deleteBookGenres: vi.fn(() => Promise.resolve()),
    upsertGenre: vi.fn(),
    insertBookGenre: vi.fn(() => Promise.resolve()),
    deleteBookTags: vi.fn(() => Promise.resolve()),
    upsertTag: vi.fn(),
    insertBookTag: vi.fn(() => Promise.resolve()),
    markCoverAsCustom: vi.fn(() => Promise.resolve()),
    clearUserBookStatuses: vi.fn(() => Promise.resolve()),
    upsertUserBookStatus: vi.fn(() => Promise.resolve()),
    clearReadingProgress: vi.fn(() => Promise.resolve()),
    upsertReadingProgress: vi.fn(() => Promise.resolve()),
    clearAudiobookProgress: vi.fn(() => Promise.resolve()),
    upsertAudiobookProgress: vi.fn(() => Promise.resolve()),
    clearBookmarks: vi.fn(() => Promise.resolve()),
    insertBookmark: vi.fn(() => Promise.resolve()),
    clearAnnotations: vi.fn(() => Promise.resolve()),
    insertAnnotation: vi.fn(() => Promise.resolve()),
    fetchExistingCollections: vi.fn(() => Promise.resolve([])),
    insertCollection: vi.fn(),
    clearCollectionBooks: vi.fn(() => Promise.resolve()),
    upsertCollectionBook: vi.fn(),
    fetchTargetBookPrimaryFiles: vi.fn(() =>
      Promise.resolve({
        primaryFilesByBookId: new Map<number, number>(),
        audiobookPrimaryFilesByBookId: new Map<number, number>(),
      }),
    ),
    fetchTargetBookFiles: vi.fn(() => Promise.resolve(new Map())),
    fetchLibraryIdsByBookIds: vi.fn(() => Promise.resolve(new Map())),
    // Batch methods
    batchUpsertBookMetadata: vi.fn(() => Promise.resolve()),
    batchDeleteBookAuthors: vi.fn(() => Promise.resolve()),
    batchUpsertAuthors: vi.fn(() => Promise.resolve(new Map<string, number>())),
    batchInsertBookAuthors: vi.fn(() => Promise.resolve()),
    batchDeleteBookNarrators: vi.fn(() => Promise.resolve()),
    batchUpsertNarrators: vi.fn(() => Promise.resolve(new Map<string, number>())),
    batchInsertBookNarrators: vi.fn(() => Promise.resolve()),
    batchDeleteBookGenres: vi.fn(() => Promise.resolve()),
    batchUpsertGenres: vi.fn(() => Promise.resolve(new Map<string, number>())),
    batchInsertBookGenres: vi.fn(() => Promise.resolve()),
    batchDeleteBookTags: vi.fn(() => Promise.resolve()),
    batchUpsertTags: vi.fn(() => Promise.resolve(new Map<string, number>())),
    batchInsertBookTags: vi.fn(() => Promise.resolve()),
    batchUpsertUserBookStatuses: vi.fn(() => Promise.resolve()),
    batchUpsertReadingProgress: vi.fn(() => Promise.resolve()),
    batchUpsertAudiobookProgress: vi.fn(() => Promise.resolve()),
    batchInsertBookmarks: vi.fn(() => Promise.resolve()),
    batchInsertAnnotations: vi.fn(() => Promise.resolve()),
    batchInsertCollectionBooks: vi.fn(() => Promise.resolve()),
  };
  return {
    ...repo,
    withTransaction: vi.fn((handler: (repo: typeof repo) => Promise<unknown>) => handler(repo)),
  };
}

describe('UserStateImporter audiobook progress import', () => {
  it('imports only rows mapped to target audio books', async () => {
    const repo = createRepoMock();
    const importRepo = createImportRepoMock();
    importRepo.upsertAudiobookProgress.mockResolvedValue(undefined);

    const importer = new UserStateImporter(repo as never, importRepo as never);

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

    await (importer as any).importAudiobookProgress(
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

    expect(importRepo.batchUpsertAudiobookProgress).toHaveBeenCalledTimes(1);
    const batchArg = (importRepo.batchUpsertAudiobookProgress.mock.calls as unknown[][])[0][0] as Array<Record<string, unknown>>;
    expect(batchArg).toHaveLength(1);
    expect(batchArg[0]).toEqual(
      expect.objectContaining({
        userId: 10,
        bookId: 101,
        currentFileId: 1001,
        percentage: 42,
        positionSeconds: 120.5,
      }),
    );
    expect(repo.setRunMetric).toHaveBeenCalledWith(
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
    const importRepo = createImportRepoMock();
    importRepo.upsertAudiobookProgress.mockResolvedValue(undefined);

    const importer = new UserStateImporter(repo as never, importRepo as never);

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

    await (importer as any).importAudiobookProgress(
      88,
      planned,
      new Map([['u1', 10]]),
      new Map([['source-audio', 101]]),
      new Map([[101, 1001]]),
      new Map(),
      async () => {},
    );

    expect(importRepo.batchUpsertAudiobookProgress).toHaveBeenCalledTimes(1);
    expect(repo.setRunMetric).toHaveBeenCalledWith(
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

describe('SharedOverlaysImporter author import', () => {
  it('replaces target book authors from source author names', async () => {
    const repo = createRepoMock();
    const importRepo = createImportRepoMock();
    importRepo.batchUpsertAuthors.mockResolvedValueOnce(
      new Map([
        ['Ada Lovelace', 101],
        ['Grace Hopper', 102],
      ]),
    );

    const importer = new SharedOverlaysImporter(repo as never, importRepo as never);

    const planned = {
      execution: {
        matchedBooks: [{ sourceBookId: 'source-1', targetBookId: 901 }],
        sourceData: {
          books: [{ sourceBookId: 'source-1', author: 'Ada Lovelace; Grace Hopper' }],
        },
      },
    };

    await (importer as any).importAuthors(91, planned);

    expect(importRepo.batchDeleteBookAuthors).toHaveBeenCalledWith([901]);
    expect(importRepo.batchUpsertAuthors).toHaveBeenCalledWith([
      { name: 'Ada Lovelace', sortName: 'Ada Lovelace' },
      { name: 'Grace Hopper', sortName: 'Grace Hopper' },
    ]);
    expect(importRepo.batchInsertBookAuthors).toHaveBeenCalledWith([
      { bookId: 901, authorId: 101, displayOrder: 0 },
      { bookId: 901, authorId: 102, displayOrder: 1 },
    ]);
    expect(repo.setRunMetric).toHaveBeenCalledWith(
      91,
      'shared_overlays',
      'book_authors',
      expect.objectContaining({ processed: 1, imported: 2, skipped: 0, unresolved: 0 }),
    );
  });
});

describe('CoverImporter book cover import', () => {
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
      const importRepo = createImportRepoMock();
      const scanGateway = createScanGatewayMock();
      importRepo.fetchLibraryIdsByBookIds.mockResolvedValue(new Map([[901, 1]]));
      const importer = new CoverImporter(repo as never, importRepo as never, scanGateway as never);

      const planned = {
        execution: {
          matchedBooks: [{ sourceBookId: 'source-1', targetBookId: 901 }],
        },
      };

      await importer.import(52, planned as never, booksPath, sourceRoot, async () => {});

      const targetDir = join(booksPath, 'covers', '901');
      const targetFiles = await readdir(targetDir);
      const copiedCoverName = targetFiles.find((entry) => entry.startsWith('cover_custom.'));
      expect(copiedCoverName).toBeTruthy();
      expect(targetFiles).toContain('thumbnail.jpg');

      const copiedCoverBytes = await readFile(join(targetDir, copiedCoverName!));
      const copiedThumbnailBytes = await readFile(join(targetDir, 'thumbnail.jpg'));
      expect(copiedCoverBytes.equals(sourceCoverBytes)).toBe(true);
      expect(copiedThumbnailBytes.equals(sourceThumbnailBytes)).toBe(true);

      expect(importRepo.markCoverAsCustom).toHaveBeenCalledWith(901);
      expect(scanGateway.emitCoverRefreshed).toHaveBeenCalledWith({ bookId: 901, libraryId: 1 });
      expect(repo.setRunMetric).toHaveBeenCalledWith(
        52,
        'book_covers',
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
      const importRepo = createImportRepoMock();
      const scanGateway = createScanGatewayMock();
      importRepo.fetchLibraryIdsByBookIds.mockResolvedValue(new Map([[902, 1]]));
      const importer = new CoverImporter(repo as never, importRepo as never, scanGateway as never);

      const planned = {
        execution: {
          matchedBooks: [{ sourceBookId: 'source-2', targetBookId: 902 }],
        },
      };

      await importer.import(53, planned as never, booksPath, sourceRoot, async () => {});

      const generatedThumbnail = await readFile(join(booksPath, 'covers', '902', 'thumbnail.jpg'));
      expect(generatedThumbnail.length).toBeGreaterThan(0);
      expect(scanGateway.emitCoverRefreshed).toHaveBeenCalledWith({ bookId: 902, libraryId: 1 });
      expect(repo.setRunMetric).toHaveBeenCalledWith(
        53,
        'book_covers',
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
    const importRepo = createImportRepoMock();
    const scanGateway = createScanGatewayMock();
    const importer = new CoverImporter(repo as never, importRepo as never, scanGateway as never);

    const planned = {
      execution: {
        matchedBooks: [{ sourceBookId: 'source-3', targetBookId: 903 }],
      },
    };

    await importer.import(54, planned as never, '/tmp/books', null, async () => {});

    expect(importRepo.markCoverAsCustom).not.toHaveBeenCalled();
    expect(scanGateway.emitCoverRefreshed).not.toHaveBeenCalled();
    expect(repo.setRunMetric).toHaveBeenCalledWith(
      54,
      'book_covers',
      'book_covers',
      expect.objectContaining({ processed: 1, skipped: 1, imported: 0 }),
    );
  });
});

describe('UserStateImporter collection import', () => {
  it('skips shelf-book rows that do not belong to the shelf owner', async () => {
    const repo = createRepoMock();
    const importRepo = createImportRepoMock();
    importRepo.insertCollection.mockResolvedValue({ id: 701 });
    importRepo.upsertCollectionBook.mockResolvedValue(true);

    const importer = new UserStateImporter(repo as never, importRepo as never);

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

    await (importer as any).importCollections(
      78,
      planned,
      new Map([['u1', 10]]),
      new Map([
        ['source-1', 101],
        ['source-2', 102],
      ]),
      async () => {},
    );

    expect(importRepo.insertCollection).toHaveBeenCalledTimes(1);
    expect(importRepo.batchInsertCollectionBooks).toHaveBeenCalledWith([{ collectionId: 701, bookId: 101 }]);
    expect(repo.setRunMetric).toHaveBeenCalledWith(
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

describe('SharedOverlaysImporter domain gating', () => {
  it('marks all shared overlay stages skipped when source domains are unavailable', async () => {
    const repo = createRepoMock();
    const importRepo = createImportRepoMock();
    const importer = new SharedOverlaysImporter(repo as never, importRepo as never);

    const planned = {
      execution: {
        matchedBooks: [{ sourceBookId: 'b1', targetBookId: 901 }],
        sourceData: {
          availableDomains: {
            metadata: false,
            authors: false,
            narrators: false,
            genres: false,
            tags: false,
          },
          books: [],
        },
      },
    };

    await importer.import(120, planned as never, async () => {});

    expect(repo.setRunMetric).toHaveBeenCalledWith(120, 'shared_overlays', 'book_metadata', expect.objectContaining({ processed: 1, skipped: 1 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(120, 'shared_overlays', 'book_authors', expect.objectContaining({ processed: 1, skipped: 1 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(120, 'shared_overlays', 'book_narrators', expect.objectContaining({ processed: 1, skipped: 1 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(120, 'shared_overlays', 'book_genres', expect.objectContaining({ processed: 1, skipped: 1 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(120, 'shared_overlays', 'book_tags', expect.objectContaining({ processed: 1, skipped: 1 }));
    expect(importRepo.batchUpsertBookMetadata).not.toHaveBeenCalled();
  });
});

describe('UserStateImporter progress and bookmark edge cases', () => {
  it('marks user-state stages skipped when unavailable', async () => {
    const repo = createRepoMock();
    const importRepo = createImportRepoMock();
    const importer = new UserStateImporter(repo as never, importRepo as never);

    const planned = {
      plan: {
        userMappings: [],
        pathMappings: [],
      },
      execution: {
        matchedBooks: [],
        sourceData: {
          availableDomains: {
            userBookStatuses: false,
            readingProgress: false,
            bookmarks: false,
            annotations: false,
            shelves: false,
          },
          books: [],
          userBookStatuses: [],
          userFileProgress: [],
          bookmarks: [],
          annotations: [],
          shelves: [],
          shelfBooks: [],
        },
      },
    };

    await importer.import(121, planned as never, async () => {});

    expect(repo.setRunMetric).toHaveBeenCalledWith(121, 'user_state', 'user_book_status', expect.objectContaining({ processed: 0, skipped: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(121, 'user_state', 'reading_progress', expect.objectContaining({ processed: 0, skipped: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(121, 'user_state', 'audiobook_progress', expect.objectContaining({ processed: 0, skipped: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(121, 'user_state', 'bookmarks', expect.objectContaining({ processed: 0, skipped: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(121, 'user_state', 'annotations', expect.objectContaining({ processed: 0, skipped: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(121, 'user_state', 'collections', expect.objectContaining({ processed: 0, skipped: 0 }));
  });

  it('derives bookmark position from track index when source file id is missing', async () => {
    const repo = createRepoMock();
    const importRepo = createImportRepoMock();
    const importer = new UserStateImporter(repo as never, importRepo as never);

    const planned = {
      execution: {
        sourceData: {
          availableDomains: {
            bookmarks: true,
          },
          books: [
            {
              sourceBookId: 'source-1',
              files: [
                { sourceFileId: 'f1', durationSeconds: 30 },
                { sourceFileId: 'f2', durationSeconds: 45 },
              ],
            },
          ],
          bookmarks: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'source-1',
              sourceFileId: null,
              title: 'Chapter mark',
              cfi: '/6/2',
              positionSeconds: 15,
              trackIndex: 2,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    };

    await (importer as any).importBookmarks(122, planned, new Map([['u1', 10]]), new Map([['source-1', 200]]), async () => {});

    const inserted = (importRepo.batchInsertBookmarks.mock.calls as unknown[][])[0][0] as Array<Record<string, unknown>>;
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        userId: 10,
        bookId: 200,
        positionSeconds: 45,
      }),
    );
    expect(repo.setRunMetric).toHaveBeenCalledWith(122, 'user_state', 'bookmarks', expect.objectContaining({ processed: 1, imported: 1 }));
  });
});
