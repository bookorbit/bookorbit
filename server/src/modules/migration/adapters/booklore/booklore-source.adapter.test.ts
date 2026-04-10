import { describe, expect, it, vi } from 'vitest';

import { BookloreSourceAdapter } from './booklore-source.adapter';
import { BOOKLORE_TABLES } from './booklore-tables';

describe('BookloreSourceAdapter shelf export', () => {
  it('carries the shelf owner through each shelf-book mapping', async () => {
    const connector = {
      listColumns: vi
        .fn()
        .mockResolvedValueOnce(new Set(['id', 'user_id', 'name']))
        .mockResolvedValueOnce(new Set(['shelf_id', 'book_id']))
        .mockResolvedValueOnce(new Set(['id'])),
      queryRows: vi
        .fn()
        .mockResolvedValueOnce([{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }])
        .mockResolvedValueOnce([{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b1' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await (adapter as any).fetchShelves({} as never, 'shelf', 'book_shelf_mapping', 'book');

    expect(result).toEqual({
      shelves: [{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }],
      shelfBooks: [{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b1' }],
    });
    expect(connector.queryRows).toHaveBeenNthCalledWith(2, expect.anything(), expect.stringContaining('JOIN `shelf` s ON s.`id` = m.`shelf_id`'));
  });
});

describe('BookloreSourceAdapter table resolution', () => {
  it('uses the resolved library path table when fetching path prefixes', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set(['library_path'])),
      queryRows: vi.fn().mockResolvedValue([{ path: '/books' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await adapter.fetchPathPrefixes({} as never);

    expect(result).toEqual(['/books']);
    expect(connector.queryRows).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('FROM `library_path`'));
  });

  it('does not resolve guessed plural table names that are absent from Booklore', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set(['library_paths'])),
      queryRows: vi.fn(),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await adapter.fetchPathPrefixes({} as never);

    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('detects ebook viewer preferences from the live Booklore table name', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set(['users', 'book', 'book_file', 'epub_viewer_preference', 'ebook_viewer_preference'])),
      countRows: vi.fn().mockResolvedValue(1),
      queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await adapter.validate({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'secret',
      database: 'booklore',
      mediaRootPath: '/books',
      ssl: false,
    });

    expect(result.warnings).toContain('Booklore viewer preference tables detected; reader preference migration is deferred');
    expect(connector.countRows).toHaveBeenCalledWith(expect.anything(), 'epub_viewer_preference');
    expect(connector.countRows).toHaveBeenCalledWith(expect.anything(), 'ebook_viewer_preference');
  });
});

describe('BookloreSourceAdapter validation and export', () => {
  it('reports missing required core tables and marks validation as failed', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      countRows: vi.fn().mockResolvedValue(1),
      queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.validate({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: '',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual(['book_file']);
    expect(result.warnings).toEqual(expect.arrayContaining(['mediaRootPath not configured; book cover/thumbnail import disabled']));
  });

  it('exports source users/books/user-state/shelves and resolves contributors, tags, and genres', async () => {
    const columns = (...names: string[]) => new Set(names.map((name) => name.toLowerCase()));
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi
        .fn()
        .mockResolvedValue(
          new Set([
            BOOKLORE_TABLES.users,
            BOOKLORE_TABLES.book,
            BOOKLORE_TABLES.bookFile,
            BOOKLORE_TABLES.bookMetadata,
            BOOKLORE_TABLES.libraryPath,
            BOOKLORE_TABLES.author,
            BOOKLORE_TABLES.bookMetadataAuthorMapping,
            BOOKLORE_TABLES.userBookProgress,
            BOOKLORE_TABLES.userBookFileProgress,
            BOOKLORE_TABLES.bookMarks,
            BOOKLORE_TABLES.annotations,
            BOOKLORE_TABLES.shelf,
            BOOKLORE_TABLES.bookShelfMapping,
            BOOKLORE_TABLES.category,
            BOOKLORE_TABLES.bookMetadataCategoryMapping,
            BOOKLORE_TABLES.tag,
            BOOKLORE_TABLES.bookMetadataTagMapping,
          ]),
        ),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        const map: Record<string, Set<string>> = {
          [BOOKLORE_TABLES.users]: columns('id', 'username', 'name', 'email'),
          [BOOKLORE_TABLES.book]: columns('id', 'library_path_id', 'deleted'),
          [BOOKLORE_TABLES.bookMetadata]: columns(
            'book_id',
            'title',
            'author',
            'subtitle',
            'isbn10',
            'isbn13',
            'description',
            'publisher',
            'published_year',
            'language',
            'page_count',
            'series_name',
            'series_index',
            'rating',
            'google_books_id',
            'goodreads_id',
            'amazon_id',
            'hardcover_id',
            'audible_id',
            'comicvine_id',
            'duration_seconds',
            'abridged',
            'narrator',
          ),
          [BOOKLORE_TABLES.bookFile]: columns('id', 'book_id', 'file_name', 'file_sub_path', 'current_hash', 'duration_seconds', 'is_book'),
          [BOOKLORE_TABLES.libraryPath]: columns('id', 'path'),
          [BOOKLORE_TABLES.author]: columns('id', 'name', 'sort_name', 'description'),
          [BOOKLORE_TABLES.bookMetadataAuthorMapping]: columns('book_id', 'author_id', 'sort_order'),
          [BOOKLORE_TABLES.userBookProgress]: columns('user_id', 'book_id', 'status', 'percentage', 'updated_at'),
          [BOOKLORE_TABLES.userBookFileProgress]: columns(
            'user_id',
            'book_id',
            'book_file_id',
            'percentage',
            'cfi',
            'page_number',
            'position_seconds',
            'updated_at',
          ),
          [BOOKLORE_TABLES.bookMarks]: columns('user_id', 'book_id', 'book_file_id', 'title', 'cfi', 'position_seconds', 'track_index', 'created_at'),
          [BOOKLORE_TABLES.annotations]: columns(
            'user_id',
            'book_id',
            'cfi',
            'text',
            'color',
            'style',
            'note',
            'chapter_title',
            'created_at',
            'updated_at',
          ),
          [BOOKLORE_TABLES.shelf]: columns('id', 'user_id', 'name'),
          [BOOKLORE_TABLES.bookShelfMapping]: columns('shelf_id', 'book_id'),
          [BOOKLORE_TABLES.category]: columns('id', 'name'),
          [BOOKLORE_TABLES.bookMetadataCategoryMapping]: columns('book_id', 'category_id'),
          [BOOKLORE_TABLES.tag]: columns('id', 'name'),
          [BOOKLORE_TABLES.bookMetadataTagMapping]: columns('book_id', 'tag_id'),
        };
        return Promise.resolve(map[tableName] ?? new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) {
          return Promise.resolve([{ sourceUserId: 'u1', username: 'reader', name: 'Reader', email: 'reader@example.com' }]);
        }
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: 'Dune',
              author: 'Frank Herbert',
              subtitle: null,
              isbn10: '0441172717',
              isbn13: '9780441172719',
              description: 'Classic sci-fi',
              publisher: 'Ace',
              publishedYear: 1965,
              publishedDate: null,
              language: 'en',
              pageCount: 412,
              seriesName: null,
              seriesIndex: null,
              rating: 4,
              googleBooksId: 'google-1',
              goodreadsId: 'goodreads-1',
              amazonId: 'amazon-1',
              hardcoverId: 'hardcover-1',
              audibleId: 'audible-1',
              comicvineId: null,
              durationSeconds: 1234,
              abridged: 0,
              narrator: '["Narrator A","Narrator A","Narrator B"]',
              sourceFileId: 'file-1',
              directFilePath: null,
              fileName: 'dune.epub',
              fileSubPath: 'SciFi',
              currentHash: 'hash-1',
              initialHash: null,
              fileDurationSeconds: 1234,
              libraryRootPath: '/library',
            },
          ]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.bookMetadataAuthorMapping}\` m`) && sqlText.includes(`JOIN \`${BOOKLORE_TABLES.author}\` a`)) {
          return Promise.resolve([
            { bookId: 'b1', sourceContributorId: 'a2', name: 'Brian Herbert', sortName: 'Herbert, Brian', description: null, displayOrder: 2 },
            { bookId: 'b1', sourceContributorId: 'a1', name: 'Frank Herbert', sortName: 'Herbert, Frank', description: null, displayOrder: 1 },
          ]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.userBookProgress}\` p`)) {
          return Promise.resolve([
            { sourceUserId: 'u1', sourceBookId: 'b1', status: 'completed', percentage: 100, startedAt: null, finishedAt: null, updatedAt: null },
          ]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.userBookFileProgress}\` p`)) {
          return Promise.resolve([
            {
              sourceUserId: 'u1',
              sourceBookId: 'b1',
              sourceFileId: 'file-1',
              percentage: 75,
              cfi: '/6/2',
              href: null,
              pageNumber: 120,
              positionSeconds: 33,
              updatedAt: null,
            },
          ]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.bookMarks}\` b`)) {
          return Promise.resolve([
            {
              sourceUserId: 'u1',
              sourceBookId: 'b1',
              sourceFileId: 'file-1',
              title: 'bookmark',
              cfi: '/6/2',
              positionSeconds: 42,
              trackIndex: 1,
              createdAt: null,
            },
          ]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.annotations}\` a`)) {
          return Promise.resolve([
            {
              sourceUserId: 'u1',
              sourceBookId: 'b1',
              cfi: '/6/2',
              text: 'highlight',
              color: 'yellow',
              style: 'highlight',
              note: 'note',
              chapterTitle: 'Chapter 1',
              createdAt: null,
              updatedAt: null,
            },
          ]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.shelf}\` s`)) {
          return Promise.resolve([{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }]);
        }
        if (sqlText.includes(`FROM \`${BOOKLORE_TABLES.bookShelfMapping}\` m`)) {
          return Promise.resolve([{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b1' }]);
        }
        if (sqlText.includes(`JOIN \`${BOOKLORE_TABLES.category}\` c`)) {
          return Promise.resolve([{ bookId: 'b1', name: 'Science Fiction' }]);
        }
        if (sqlText.includes(`JOIN \`${BOOKLORE_TABLES.tag}\` t`)) {
          return Promise.resolve([{ bookId: 'b1', name: 'Space Opera' }]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'secret',
      database: 'booklore',
      mediaRootPath: '/media',
      ssl: false,
    });

    expect(result.availableDomains).toEqual(
      expect.objectContaining({
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
      }),
    );
    expect(result.users).toEqual([{ sourceUserId: 'u1', username: 'reader', name: 'Reader', email: 'reader@example.com' }]);
    expect(result.books[0]).toEqual(
      expect.objectContaining({
        sourceBookId: 'b1',
        filePath: '/library/SciFi/dune.epub',
        fileHash: 'hash-1',
        narrators: [expect.objectContaining({ name: 'Narrator A' }), expect.objectContaining({ name: 'Narrator B' })],
        genres: ['Science Fiction'],
        tags: ['Space Opera'],
      }),
    );
    expect(result.books[0]?.authors?.map((author) => author.name)).toEqual(['Frank Herbert', 'Brian Herbert']);
    expect(result.shelves).toEqual([{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }]);
    expect(result.shelfBooks).toEqual([{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b1' }]);
  });
});
