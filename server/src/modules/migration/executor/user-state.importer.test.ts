import { UserStateImporter } from './user-state.importer';

function makeImporter() {
  const repo = {
    setRunMetric: vi.fn().mockResolvedValue(undefined),
  };
  const importRepo = {
    withTransaction: vi.fn().mockImplementation(async (handler: (repo: typeof importRepo) => Promise<unknown>) => handler(importRepo)),
    fetchTargetBookPrimaryFiles: vi.fn().mockResolvedValue({
      primaryFilesByBookId: new Map([[200, 500]]),
      audiobookPrimaryFilesByBookId: new Map([[200, 500]]),
    }),
    fetchTargetBookFiles: vi.fn().mockResolvedValue(new Map()),
    clearUserBookStatuses: vi.fn().mockResolvedValue(undefined),
    batchUpsertUserBookStatuses: vi.fn().mockResolvedValue(undefined),
    clearReadingProgress: vi.fn().mockResolvedValue(undefined),
    batchUpsertReadingProgress: vi.fn().mockResolvedValue(undefined),
    clearAudiobookProgress: vi.fn().mockResolvedValue(undefined),
    batchUpsertAudiobookProgress: vi.fn().mockResolvedValue(undefined),
    clearBookmarks: vi.fn().mockResolvedValue(undefined),
    batchInsertBookmarks: vi.fn().mockResolvedValue(undefined),
    clearAnnotations: vi.fn().mockResolvedValue(undefined),
    batchInsertAnnotations: vi.fn().mockResolvedValue(undefined),
    fetchExistingCollections: vi.fn().mockResolvedValue([]),
    insertCollection: vi.fn().mockResolvedValue({ id: 700 }),
    clearCollectionBooks: vi.fn().mockResolvedValue(undefined),
    batchInsertCollectionBooks: vi.fn().mockResolvedValue(undefined),
  };

  const importer = new UserStateImporter(repo as never, importRepo as never);
  return { importer, repo, importRepo };
}

describe('UserStateImporter', () => {
  it('imports user status/progress/bookmarks/annotations/collections across all domains', async () => {
    const { importer, repo, importRepo } = makeImporter();

    const planned = {
      plan: {
        userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
        pathMappings: [],
      },
      execution: {
        matchedBooks: [{ sourceBookId: 'b-source', targetBookId: 200 }],
        sourceData: {
          availableDomains: {
            userBookStatuses: true,
            readingProgress: true,
            bookmarks: true,
            annotations: true,
            shelves: true,
          },
          books: [
            {
              sourceBookId: 'b-source',
              files: [
                { sourceFileId: 'f1', durationSeconds: 30 },
                { sourceFileId: 'f2', durationSeconds: 45 },
              ],
            },
          ],
          userBookStatuses: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              status: 'completed',
              percentage: 100,
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: null,
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          ],
          userFileProgress: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              sourceFileId: null,
              percentage: 120,
              cfi: '/6/2',
              pageNumber: 12,
              positionSeconds: 30,
              updatedAt: '2026-01-03T00:00:00.000Z',
            },
          ],
          bookmarks: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              sourceFileId: null,
              title: 'Mark',
              cfi: '/6/2',
              positionSeconds: 15,
              trackIndex: 2,
              createdAt: '2026-01-04T00:00:00.000Z',
            },
          ],
          annotations: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              cfi: '/6/2',
              text: 'Highlight',
              color: null,
              style: null,
              note: 'Note',
              chapterTitle: 'Ch 1',
              createdAt: '2026-01-05T00:00:00.000Z',
              updatedAt: '2026-01-06T00:00:00.000Z',
            },
          ],
          shelves: [{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }],
          shelfBooks: [{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b-source' }],
        },
      },
    };

    const ensureRunning = vi.fn().mockResolvedValue(undefined);
    await importer.import(300, planned as never, ensureRunning);

    expect(importRepo.batchUpsertUserBookStatuses).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 10,
        bookId: 200,
        status: 'read',
        source: 'manual',
      }),
    ]);
    expect(importRepo.batchUpsertReadingProgress).toHaveBeenCalledWith([
      expect.objectContaining({
        bookFileId: 500,
        userId: 10,
        percentage: 100,
      }),
    ]);
    expect(importRepo.batchUpsertAudiobookProgress).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 10,
        bookId: 200,
        currentFileId: 500,
        positionSeconds: 30,
      }),
    ]);
    expect(importRepo.batchInsertBookmarks).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 10,
        bookId: 200,
        positionSeconds: 45,
      }),
    ]);
    expect(importRepo.batchInsertAnnotations).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 10,
        bookId: 200,
        color: 'yellow',
        style: 'highlight',
      }),
    ]);
    expect(importRepo.batchInsertCollectionBooks).toHaveBeenCalledWith([{ collectionId: 700, bookId: 200 }]);
    expect(repo.setRunMetric).toHaveBeenCalledWith(
      300,
      'user_state',
      'collections',
      expect.objectContaining({
        processed: 1,
        imported: 1,
      }),
    );
    expect(ensureRunning).toHaveBeenCalled();
  });

  it('tracks unresolved rows across domains and keeps bookmark position when track index is invalid', async () => {
    const { importer, repo, importRepo } = makeImporter();
    importRepo.fetchTargetBookPrimaryFiles.mockResolvedValue({
      primaryFilesByBookId: new Map([[200, 500]]),
      audiobookPrimaryFilesByBookId: new Map([[200, 500]]),
    });
    importRepo.fetchExistingCollections.mockResolvedValue([
      { id: 88, userId: 10, name: 'Existing Imported', description: 'Imported from Booklore migration shelf: s-existing' },
      { id: 89, userId: 10, name: 'Not Imported', description: 'Imported from Booklore migration shelf:   ' },
      { id: 90, userId: 10, name: 'Favorites', description: null },
      { id: 91, userId: 10, name: 'Favorites (Booklore)', description: null },
    ]);
    importRepo.insertCollection.mockResolvedValue({ id: 701 });

    const planned = {
      plan: {
        userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
        pathMappings: [],
      },
      execution: {
        matchedBooks: [
          { sourceBookId: 'b-source', targetBookId: 200 },
          { sourceBookId: 'b-missing-file', targetBookId: 201 },
        ],
        sourceData: {
          availableDomains: {
            userBookStatuses: true,
            readingProgress: true,
            bookmarks: true,
            annotations: true,
            shelves: true,
          },
          books: [
            {
              sourceBookId: 'b-source',
              files: [
                { sourceFileId: 'f1', durationSeconds: 30 },
                { sourceFileId: 'f2', durationSeconds: 45 },
              ],
            },
          ],
          userBookStatuses: [
            {
              sourceUserId: 'missing-user',
              sourceBookId: 'b-source',
              status: 'reading',
              percentage: 20,
              startedAt: null,
              finishedAt: null,
              updatedAt: null,
            },
          ],
          userFileProgress: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-missing-file',
              sourceFileId: null,
              percentage: 10,
              cfi: null,
              pageNumber: null,
              positionSeconds: 5,
              updatedAt: null,
            },
            {
              sourceUserId: 'missing-user',
              sourceBookId: 'b-source',
              sourceFileId: null,
              percentage: 10,
              cfi: null,
              pageNumber: null,
              positionSeconds: 5,
              updatedAt: null,
            },
          ],
          bookmarks: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              sourceFileId: null,
              title: 'Invalid Track',
              cfi: '/6/2',
              positionSeconds: 12,
              trackIndex: 99,
              createdAt: null,
            },
            {
              sourceUserId: 'missing-user',
              sourceBookId: 'b-source',
              sourceFileId: null,
              title: 'Unmapped',
              cfi: '/6/4',
              positionSeconds: 5,
              trackIndex: 0,
              createdAt: null,
            },
          ],
          annotations: [
            {
              sourceUserId: 'missing-user',
              sourceBookId: 'b-source',
              cfi: '/6/2',
              text: 'X',
              color: null,
              style: null,
              note: null,
              chapterTitle: null,
            },
          ],
          shelves: [
            { sourceShelfId: 's-existing', sourceUserId: 'u1', name: 'Existing Imported' },
            { sourceShelfId: 's-new', sourceUserId: 'u1', name: 'Favorites' },
            { sourceShelfId: 's-no-user', sourceUserId: 'missing-user', name: 'Private' },
          ],
          shelfBooks: [
            { sourceShelfId: 'missing-shelf', sourceUserId: 'u1', sourceBookId: 'b-source' },
            { sourceShelfId: 's-new', sourceUserId: 'other-user', sourceBookId: 'b-source' },
            { sourceShelfId: 's-no-user', sourceUserId: 'missing-user', sourceBookId: 'b-source' },
            { sourceShelfId: 's-new', sourceUserId: 'u1', sourceBookId: 'b-source' },
            { sourceShelfId: 's-new', sourceUserId: 'u1', sourceBookId: 'missing-book' },
          ],
        },
      },
    };

    await importer.import(301, planned as never, vi.fn().mockResolvedValue(undefined));

    expect(importRepo.batchInsertBookmarks).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 10,
        bookId: 200,
        positionSeconds: 12,
      }),
    ]);
    expect(importRepo.insertCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Favorites (Booklore 2)',
      }),
    );

    expect(repo.setRunMetric).toHaveBeenCalledWith(301, 'user_state', 'user_book_status', expect.objectContaining({ unresolved: 1 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(301, 'user_state', 'reading_progress', expect.objectContaining({ unresolved: 2 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(301, 'user_state', 'collections', expect.objectContaining({ unresolved: 4 }));
  });

  it('skips all user-state domains when source adapter marks them unavailable', async () => {
    const { importer, repo, importRepo } = makeImporter();
    const planned = {
      plan: {
        userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
        pathMappings: [],
      },
      execution: {
        matchedBooks: [{ sourceBookId: 'b-source', targetBookId: 200 }],
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

    await importer.import(302, planned as never, vi.fn().mockResolvedValue(undefined));

    expect(importRepo.batchUpsertUserBookStatuses).not.toHaveBeenCalled();
    expect(importRepo.batchUpsertReadingProgress).not.toHaveBeenCalled();
    expect(importRepo.batchUpsertAudiobookProgress).not.toHaveBeenCalled();
    expect(importRepo.batchInsertBookmarks).not.toHaveBeenCalled();
    expect(importRepo.batchInsertAnnotations).not.toHaveBeenCalled();
    expect(importRepo.batchInsertCollectionBooks).not.toHaveBeenCalled();

    expect(repo.setRunMetric).toHaveBeenCalledWith(302, 'user_state', 'user_book_status', expect.objectContaining({ processed: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(302, 'user_state', 'reading_progress', expect.objectContaining({ processed: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(302, 'user_state', 'audiobook_progress', expect.objectContaining({ processed: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(302, 'user_state', 'bookmarks', expect.objectContaining({ processed: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(302, 'user_state', 'annotations', expect.objectContaining({ processed: 0 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(302, 'user_state', 'collections', expect.objectContaining({ processed: 0 }));
  });

  it('falls back to timestamped imported collection names when all candidate names are taken', async () => {
    const { importer, importRepo } = makeImporter();
    const existingCollections = [
      { id: 1, userId: 10, name: 'Shelf', description: null },
      { id: 2, userId: 10, name: 'Shelf (Booklore)', description: null },
    ];
    for (let i = 2; i < 10_000; i += 1) {
      existingCollections.push({
        id: 100 + i,
        userId: 10,
        name: `Shelf (Booklore ${i})`,
        description: null,
      });
    }
    importRepo.fetchExistingCollections.mockResolvedValue(existingCollections);
    importRepo.insertCollection.mockResolvedValue({ id: 9000 });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    try {
      const planned = {
        plan: { userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }], pathMappings: [] },
        execution: {
          matchedBooks: [],
          sourceData: {
            availableDomains: { shelves: true },
            books: [],
            userBookStatuses: [],
            userFileProgress: [],
            bookmarks: [],
            annotations: [],
            shelves: [{ sourceShelfId: 'new-shelf', sourceUserId: 'u1', name: 'Shelf' }],
            shelfBooks: [],
          },
        },
      };

      await importer.import(303, planned as never, vi.fn().mockResolvedValue(undefined));
    } finally {
      nowSpy.mockRestore();
    }

    expect(importRepo.insertCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Shelf (Booklore 12345)',
      }),
    );
  });

  it('skips noise progress rows that have no percentage, locator, page, or position signal', async () => {
    const { importer, repo, importRepo } = makeImporter();

    const planned = {
      plan: {
        userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
        pathMappings: [],
      },
      execution: {
        matchedBooks: [{ sourceBookId: 'b-source', targetBookId: 200 }],
        sourceData: {
          availableDomains: {
            userBookStatuses: false,
            readingProgress: true,
            bookmarks: false,
            annotations: false,
            shelves: false,
          },
          books: [{ sourceBookId: 'b-source', files: [] }],
          userBookStatuses: [],
          userFileProgress: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              sourceFileId: null,
              percentage: 0,
              cfi: null,
              href: null,
              pageNumber: 0,
              positionSeconds: 0,
              updatedAt: null,
            },
          ],
          bookmarks: [],
          annotations: [],
          shelves: [],
          shelfBooks: [],
        },
      },
    };

    await importer.import(304, planned as never, vi.fn().mockResolvedValue(undefined));

    expect(importRepo.batchUpsertReadingProgress).toHaveBeenCalledWith([]);
    expect(importRepo.batchUpsertAudiobookProgress).toHaveBeenCalledWith([]);
    expect(repo.setRunMetric).toHaveBeenCalledWith(304, 'user_state', 'reading_progress', expect.objectContaining({ processed: 1, skipped: 1 }));
    expect(repo.setRunMetric).toHaveBeenCalledWith(304, 'user_state', 'audiobook_progress', expect.objectContaining({ processed: 1, skipped: 1 }));
  });

  it('keeps zero-percent progress rows when a locator exists', async () => {
    const { importer, importRepo } = makeImporter();
    importRepo.fetchTargetBookPrimaryFiles.mockResolvedValue({
      primaryFilesByBookId: new Map([[200, 500]]),
      audiobookPrimaryFilesByBookId: new Map(),
    });

    const planned = {
      plan: {
        userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
        pathMappings: [],
      },
      execution: {
        matchedBooks: [{ sourceBookId: 'b-source', targetBookId: 200 }],
        sourceData: {
          availableDomains: {
            userBookStatuses: false,
            readingProgress: true,
            bookmarks: false,
            annotations: false,
            shelves: false,
          },
          books: [{ sourceBookId: 'b-source', files: [] }],
          userBookStatuses: [],
          userFileProgress: [
            {
              sourceUserId: 'u1',
              sourceBookId: 'b-source',
              sourceFileId: null,
              percentage: 0,
              cfi: '/6/2',
              href: null,
              pageNumber: 0,
              positionSeconds: 0,
              updatedAt: null,
            },
          ],
          bookmarks: [],
          annotations: [],
          shelves: [],
          shelfBooks: [],
        },
      },
    };

    await importer.import(305, planned as never, vi.fn().mockResolvedValue(undefined));

    expect(importRepo.batchUpsertReadingProgress).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 10,
        bookFileId: 500,
        percentage: 0,
        cfi: '/6/2',
        pageNumber: 0,
      }),
    ]);
  });
});
