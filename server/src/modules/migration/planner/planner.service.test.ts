import { MigrationPlannerService, buildUserPreview } from './planner.service';

function makeSourceBook(id: string, title: string) {
  return {
    sourceBookId: id,
    title,
    author: 'Author',
    subtitle: null,
    isbn10: null,
    isbn13: null,
    description: null,
    publisher: null,
    publishedYear: null,
    language: null,
    filePath: `/src/${id}.epub`,
    fileHash: null,
    genres: [],
    tags: [],
  };
}

describe('MigrationPlannerService', () => {
  it('builds plan with normalized mappings, split duplicates, and merged scope', async () => {
    const sourceData = {
      users: [
        { sourceUserId: 'u1', username: 'user-one', name: null, email: null },
        { sourceUserId: 'u2', username: 'user-two', name: null, email: null },
      ],
      books: [makeSourceBook('s1', 'Book One'), makeSourceBook('s2', 'Book Two'), makeSourceBook('s3', 'Book Three')],
      userBookStatuses: [
        { sourceUserId: 'u1', sourceBookId: 's3', status: 'reading', percentage: 42, startedAt: null, finishedAt: null, updatedAt: null },
      ],
      userFileProgress: [
        { sourceUserId: 'u1', sourceBookId: 's3', percentage: 10, cfi: null, pageNumber: null, positionSeconds: 5, updatedAt: null },
      ],
      bookmarks: [{ sourceUserId: 'u1', sourceBookId: 's3', title: null, cfi: null, positionSeconds: null, createdAt: null }],
      annotations: [
        {
          sourceUserId: 'u1',
          sourceBookId: 's3',
          cfi: 'epubcfi(/6/2)',
          text: 'annotation',
          color: null,
          style: null,
          note: null,
          chapterTitle: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      shelves: [{ sourceShelfId: 'sh-1', sourceUserId: 'u1', name: 'Favorites' }],
      shelfBooks: [{ sourceShelfId: 'sh-1', sourceUserId: '', sourceBookId: 's3' }],
      availableDomains: {
        metadata: true,
        authors: true,
        narrators: true,
        genres: true,
        tags: true,
        userBookStatuses: true,
        readingProgress: true,
        bookmarks: true,
        annotations: true,
        shelves: true,
        covers: true,
      },
    };

    const adapter = {
      type: 'booklore',
      validate: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceType: 'booklore',
        sourceVersion: '1.0.0',
        counts: { books: 3 },
      }),
      exportData: vi.fn().mockResolvedValue(sourceData),
    };

    const adapterRegistry = {
      get: vi.fn().mockReturnValue(adapter),
    };
    const matchingService = {
      matchBooks: vi.fn().mockResolvedValue({
        matches: [
          { sourceBookId: 's1', targetBookId: 100, strategy: 'isbn' },
          { sourceBookId: 's2', targetBookId: 100, strategy: 'path_mapping' },
          { sourceBookId: 's3', targetBookId: 101, strategy: 'title_author' },
        ],
        unresolved: [{ sourceBookId: 'sx', title: 'Missing', reason: 'unmatched' }],
      }),
    };

    const service = new MigrationPlannerService(adapterRegistry as never, matchingService as never);

    const result = await service.buildPlan({
      source: {
        type: 'booklore',
        connectionConfig: {
          host: 'localhost',
          user: 'root',
          password: '',
          database: 'booklore',
        },
      } as never,
      profile: {
        userMappings: [
          { sourceUserId: 'u1', targetUserId: 501 },
          { source_user_id: 'u2', target_user_id: 502 },
          { sourceUserId: '', targetUserId: 503 },
        ],
        pathMappings: [
          { sourcePrefix: '/src', targetPrefix: '/library' },
          { source_prefix: '/legacy', target_prefix: '/new-library' },
          { sourcePrefix: '', targetPrefix: '/ignored' },
        ],
        scope: { metadata: true, tags: true },
      } as never,
      scopeOverride: { tags: false, readingProgress: true },
    });

    expect(adapterRegistry.get).toHaveBeenCalledWith('booklore');
    expect(matchingService.matchBooks).toHaveBeenCalledWith(sourceData.books, [
      { sourcePrefix: '/src', targetPrefix: '/library' },
      { sourcePrefix: '/legacy', targetPrefix: '/new-library' },
    ]);

    expect(result.plan.userMappings).toEqual([
      { sourceUserId: 'u1', targetUserId: 501 },
      { sourceUserId: 'u2', targetUserId: 502 },
    ]);
    expect(result.plan.pathMappings).toEqual([
      { sourcePrefix: '/src', targetPrefix: '/library' },
      { sourcePrefix: '/legacy', targetPrefix: '/new-library' },
    ]);
    expect(result.plan.scope).toEqual({ metadata: true, tags: false, readingProgress: true });

    expect(result.execution.matchedBooks).toEqual([{ sourceBookId: 's3', targetBookId: 101, strategy: 'title_author' }]);
    expect(result.execution.duplicateBookMatches).toEqual([
      expect.objectContaining({
        targetBookId: 100,
        sourceBookIds: ['s1', 's2'],
      }),
    ]);

    expect(result.plan.userPreview).toEqual([
      {
        sourceUserId: 'u1',
        targetUserId: 501,
        username: 'user-one',
        counts: {
          statuses: 1,
          fileProgress: 1,
          bookmarks: 1,
          annotations: 1,
          shelves: 1,
        },
      },
      {
        sourceUserId: 'u2',
        targetUserId: 502,
        username: 'user-two',
        counts: {
          statuses: 0,
          fileProgress: 0,
          bookmarks: 0,
          annotations: 0,
          shelves: 0,
        },
      },
    ]);
  });

  it('buildUserPreview counts only mapped users and matched books', () => {
    const preview = buildUserPreview(
      {
        users: [{ sourceUserId: 'u1', username: 'alice', name: null, email: null }],
        books: [makeSourceBook('b1', 'Book One')],
        userBookStatuses: [
          { sourceUserId: 'u1', sourceBookId: 'b1', status: 'read', percentage: 100, startedAt: null, finishedAt: null, updatedAt: null },
        ],
        userFileProgress: [
          { sourceUserId: 'u1', sourceBookId: 'b1', percentage: 100, cfi: null, pageNumber: null, positionSeconds: null, updatedAt: null },
        ],
        bookmarks: [{ sourceUserId: 'u1', sourceBookId: 'b1', title: null, cfi: null, positionSeconds: null, createdAt: null }],
        annotations: [
          {
            sourceUserId: 'u1',
            sourceBookId: 'b1',
            cfi: 'cfi',
            text: 'note',
            color: null,
            style: null,
            note: null,
            chapterTitle: null,
            createdAt: null,
            updatedAt: null,
          },
        ],
        shelves: [{ sourceShelfId: 'shelf-1', sourceUserId: 'u1', name: 'Shelf' }],
        shelfBooks: [{ sourceShelfId: 'shelf-1', sourceUserId: '', sourceBookId: 'b1' }],
      } as never,
      new Map([['u1', 99]]),
      new Set(['b1']),
    );

    expect(preview).toEqual([
      {
        sourceUserId: 'u1',
        targetUserId: 99,
        username: 'alice',
        counts: {
          statuses: 1,
          fileProgress: 1,
          bookmarks: 1,
          annotations: 1,
          shelves: 1,
        },
      },
    ]);
  });
});
