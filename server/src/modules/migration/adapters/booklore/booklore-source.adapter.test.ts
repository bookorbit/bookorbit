import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
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

  it('warns when mediaRootPath is missing the Booklore images directory', async () => {
    const mediaRootPath = await mkdtemp(join(tmpdir(), 'booklore-media-root-'));
    try {
      const connector = {
        withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
        listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
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
        mediaRootPath,
        ssl: false,
      });

      expect(result.warnings).toContain(`mediaRootPath "${mediaRootPath}" is missing the "images" subdirectory expected by Booklore covers`);
    } finally {
      await rm(mediaRootPath, { recursive: true, force: true });
    }
  });

  it('does not warn about mediaRootPath when both root and images directory are readable', async () => {
    const mediaRootPath = await mkdtemp(join(tmpdir(), 'booklore-media-root-'));
    try {
      await mkdir(join(mediaRootPath, 'images'));
      const connector = {
        withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
        listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
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
        mediaRootPath,
        ssl: false,
      });

      const mediaPathWarnings = result.warnings.filter((warning) => warning.includes('mediaRootPath'));
      expect(mediaPathWarnings).toEqual([]);
    } finally {
      await rm(mediaRootPath, { recursive: true, force: true });
    }
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

describe('BookloreSourceAdapter snapshot', () => {
  it('returns a snapshot with counts from resolved tables', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
      countRows: vi.fn().mockResolvedValue(5),
      queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.snapshot({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'secret',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.sourceType).toBe('booklore');
    expect(result.sourceVersion).toBe('11.4.5');
    expect(result.counts).toBeDefined();
    expect(result.generatedAt).toBeDefined();
  });
});

describe('BookloreSourceAdapter validate - missing tables', () => {
  it('pushes users to missingTables when users table is absent', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
      countRows: vi.fn().mockResolvedValue(0),
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
    expect(result.missingTables).toContain('users');
  });

  it('pushes book to missingTables when book table is absent', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.bookFile])),
      countRows: vi.fn().mockResolvedValue(0),
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
    expect(result.missingTables).toContain('book');
  });

  it('emits all optional table warnings when optional tables are absent', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
      countRows: vi.fn().mockResolvedValue(0),
      queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.validate({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'book_metadata table not found; metadata overlays will be limited',
        'author mapping tables not found; author migration disabled',
        'user_book_progress table not found; status migration disabled',
        'user_book_file_progress table not found; file progress migration disabled',
        'book_marks table not found; bookmark migration disabled',
        'annotations table not found; annotation migration disabled',
        'shelf mapping tables not found; shelf-to-collection migration disabled',
        'category mapping tables not found; genre migration disabled',
        'tag tables not found; tag migration disabled',
        'mediaRootPath not configured; book cover/thumbnail import disabled',
      ]),
    );
  });

  it('emits deferred migration warnings for pdf_annotations, notes, kobo, and comic tables', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi
        .fn()
        .mockResolvedValue(
          new Set([
            BOOKLORE_TABLES.users,
            BOOKLORE_TABLES.book,
            BOOKLORE_TABLES.bookFile,
            'pdf_annotations',
            'book_notes',
            'kobo_user_settings',
            'comic_metadata',
          ]),
        ),
      countRows: vi.fn().mockResolvedValue(0),
      queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.validate({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'pdf_annotations table detected; PDF annotation migration is deferred',
        'Booklore notes tables detected; notes migration is deferred',
        'Booklore Kobo tables detected; Kobo migration is deferred',
        'comic_metadata table detected; comic metadata migration is deferred',
      ]),
    );
  });
});

describe('BookloreSourceAdapter validateMediaRootPath edge cases', () => {
  it('warns when mediaRootPath is a file, not a directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'booklore-notdir-'));
    const filePath = join(tempDir, 'not-a-dir');
    try {
      await writeFile(filePath, 'not a directory');
      const connector = {
        withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
        listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
        countRows: vi.fn().mockResolvedValue(0),
        queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
      };

      const adapter = new BookloreSourceAdapter(connector as never);
      const result = await adapter.validate({
        host: 'localhost',
        port: 3306,
        user: 'booklore',
        password: 'pass',
        database: 'booklore',
        mediaRootPath: filePath,
        ssl: false,
      });

      expect(result.warnings).toContain(`mediaRootPath "${filePath}" is not a directory; book cover/thumbnail import will be skipped`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('warns when images subdirectory is a file, not a directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'booklore-imagesfile-'));
    const imagesPath = join(tempDir, 'images');
    try {
      await writeFile(imagesPath, 'not a directory');
      const connector = {
        withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
        listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book, BOOKLORE_TABLES.bookFile])),
        countRows: vi.fn().mockResolvedValue(0),
        queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
      };

      const adapter = new BookloreSourceAdapter(connector as never);
      const result = await adapter.validate({
        host: 'localhost',
        port: 3306,
        user: 'booklore',
        password: 'pass',
        database: 'booklore',
        mediaRootPath: tempDir,
        ssl: false,
      });

      expect(result.warnings).toContain(`mediaRootPath "${imagesPath}" is not a directory; book cover/thumbnail import will be skipped`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('BookloreSourceAdapter exportData - minimal and edge cases', () => {
  it('exports books with no metadata, no library path, no file table', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id', 'username']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([{ sourceUserId: 'u1', username: 'reader', name: null, email: null }]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: '2001-09-01',
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: null,
              narrator: null,
              sourceFileId: null,
              directFilePath: '/books/foo.epub',
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: 'init-hash',
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]!.filePath).toBe('/books/foo.epub');
    expect(result.books[0]!.fileHash).toBe('init-hash');
    expect(result.books[0]!.publishedYear).toBe(2001);
    expect(result.books[0]!.abridged).toBeNull();
    expect(result.books[0]!.narrators).toEqual([]);
    expect(result.books[0]!.presentFields).toEqual([]);
  });

  it('exports books assembling path from libraryRoot + subPath + fileName when no directPath', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id', 'username']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: null,
              narrator: null,
              sourceFileId: 'f1',
              directFilePath: null,
              fileName: 'book.epub',
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: '/library',
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books[0]!.filePath).toBe('/library/book.epub');
  });

  it('returns null filePath when no directPath, no libraryRoot, no fileName', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: null,
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books[0]!.filePath).toBeNull();
  });

  it('skips book rows with null sourceBookId', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([{ sourceBookId: null }]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books).toHaveLength(0);
  });

  it('updates filePath/fileHash/title/author/isbn from subsequent file rows for same book', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: null,
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
            {
              sourceBookId: 'b1',
              title: 'Late Title',
              author: 'Late Author',
              subtitle: null,
              isbn10: null,
              isbn13: 'late-isbn13',
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: 42,
              abridged: null,
              narrator: null,
              sourceFileId: null,
              directFilePath: '/books/late.epub',
              fileName: null,
              fileSubPath: null,
              currentHash: 'late-hash',
              initialHash: null,
              fileDurationSeconds: 42,
              libraryRootPath: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]!.title).toBe('Late Title');
    expect(result.books[0]!.author).toBe('Late Author');
    expect(result.books[0]!.isbn13).toBe('late-isbn13');
    expect(result.books[0]!.filePath).toBe('/books/late.epub');
    expect(result.books[0]!.fileHash).toBe('late-hash');
    expect(result.books[0]!.durationSeconds).toBe(42);
  });
});

describe('BookloreSourceAdapter private method branches', () => {
  it('fetchUserBookStatuses returns empty array when no progressTable', async () => {
    const connector = { queryRows: vi.fn(), listColumns: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserBookStatuses({}, null);
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchUserBookStatuses returns empty array when required columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['percentage'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserBookStatuses({}, 'user_book_progress');
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchUserBookStatuses maps Date and string dates via toIso', async () => {
    const isoDate = '2024-06-01T00:00:00.000Z';
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id', 'updated_at', 'started_at', 'finished_at'])),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          status: null,
          percentage: null,
          startedAt: new Date(isoDate),
          finishedAt: '2024-07-01',
          updatedAt: '2024-06-15T00:00:00.000Z',
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserBookStatuses({}, 'user_book_progress');
    expect(result).toHaveLength(1);
    expect(result[0].startedAt).toBe(isoDate);
    expect(result[0].finishedAt).toBe('2024-07-01T00:00:00.000Z');
    expect(result[0].updatedAt).toBeTruthy();
  });

  it('fetchUserBookStatuses filters out rows with empty sourceUserId or sourceBookId', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id'])),
      queryRows: vi.fn().mockResolvedValue([
        { sourceUserId: '', sourceBookId: 'b1', status: null, percentage: null, startedAt: null, finishedAt: null, updatedAt: null },
        { sourceUserId: 'u1', sourceBookId: '', status: null, percentage: null, startedAt: null, finishedAt: null, updatedAt: null },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserBookStatuses({}, 'user_book_progress');
    expect(result).toHaveLength(0);
  });

  it('fetchUserFileProgress returns empty array when no progressTable', async () => {
    const connector = { queryRows: vi.fn(), listColumns: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserFileProgress({}, null, null);
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchUserFileProgress returns empty array when userCol is missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['book_id'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserFileProgress({}, 'user_book_file_progress', null);
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchUserFileProgress converts position_ms to seconds via millisecondsToSeconds', async () => {
    const connector = {
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === 'user_book_file_progress') return Promise.resolve(new Set(['user_id', 'book_id', 'position_ms']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          sourceFileId: null,
          percentage: null,
          cfi: null,
          href: null,
          pageNumber: null,
          positionSeconds: 5000,
          updatedAt: null,
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserFileProgress({}, 'user_book_file_progress', null);
    expect(result).toHaveLength(1);
    expect(result[0].positionSeconds).toBe(5);
  });

  it('fetchUserFileProgress joins bookFile table when directBookCol is absent', async () => {
    const connector = {
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === 'user_book_file_progress') return Promise.resolve(new Set(['user_id', 'book_file_id', 'position_seconds']));
        if (tableName === 'book_file') return Promise.resolve(new Set(['id', 'book_id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          sourceFileId: 'f1',
          percentage: null,
          cfi: null,
          href: null,
          pageNumber: null,
          positionSeconds: 10,
          updatedAt: null,
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserFileProgress({}, 'user_book_file_progress', 'book_file');
    expect(result).toHaveLength(1);
    expect(result[0].positionSeconds).toBe(10);
    const sql: string = connector.queryRows.mock.calls[0]?.[1] ?? '';
    expect(sql).toContain('LEFT JOIN `book_file`');
  });

  it('fetchBookmarks returns empty array when no bookmarkTable', async () => {
    const connector = { queryRows: vi.fn(), listColumns: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchBookmarks({}, null);
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchBookmarks returns empty array when required columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['title'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchBookmarks({}, 'book_marks');
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchBookmarks converts position_ms to seconds', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id', 'position_ms', 'created_at'])),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          sourceFileId: null,
          title: null,
          cfi: null,
          positionSeconds: 3000,
          trackIndex: null,
          createdAt: null,
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchBookmarks({}, 'book_marks');
    expect(result).toHaveLength(1);
    expect(result[0].positionSeconds).toBe(3);
  });

  it('fetchBookmarks maps createdAt via toIso with Date and string', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id', 'created_at'])),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          sourceFileId: null,
          title: null,
          cfi: null,
          positionSeconds: null,
          trackIndex: null,
          createdAt: new Date('2024-03-15T12:00:00.000Z'),
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchBookmarks({}, 'book_marks');
    expect(result[0].createdAt).toBe('2024-03-15T12:00:00.000Z');
  });

  it('fetchAnnotations returns empty array when no annotationsTable', async () => {
    const connector = { queryRows: vi.fn(), listColumns: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchAnnotations({}, null);
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchAnnotations returns empty array when required columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchAnnotations({}, 'annotations');
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchAnnotations maps createdAt and updatedAt via toIso', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id', 'cfi', 'text', 'created_at', 'updated_at'])),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          cfi: '/6/2',
          text: 'highlight',
          color: null,
          style: null,
          note: null,
          chapterTitle: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: new Date('2024-02-01T00:00:00.000Z'),
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchAnnotations({}, 'annotations');
    expect(result[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(result[0].updatedAt).toBe('2024-02-01T00:00:00.000Z');
  });

  it('attachAuthorsToBooks returns early when authorTable or mappingTable is null', async () => {
    const connector = { listColumns: vi.fn(), queryRows: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachAuthorsToBooks({}, [], null, 'mapping');
    await (adapter as any).attachAuthorsToBooks({}, [], 'authors', null);
    expect(connector.listColumns).not.toHaveBeenCalled();
  });

  it('attachAuthorsToBooks returns early when required mapping columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['some_col'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const books = [{ sourceBookId: 'b1', authors: [] }];
    await (adapter as any).attachAuthorsToBooks({}, books, 'authors', 'author_mapping');
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('attachAuthorsToBooks returns early when author id or name columns are missing', async () => {
    const connector = {
      listColumns: vi
        .fn()
        .mockResolvedValueOnce(new Set(['book_id', 'author_id']))
        .mockResolvedValueOnce(new Set(['description'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const books = [{ sourceBookId: 'b1', authors: [] }];
    await (adapter as any).attachAuthorsToBooks({}, books, 'authors', 'author_mapping');
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('attachCategoriesToBooks returns early when no categoryTable or mappingTable', async () => {
    const connector = { listColumns: vi.fn(), queryRows: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachCategoriesToBooks({}, [], null, 'mapping');
    await (adapter as any).attachCategoriesToBooks({}, [], 'categories', null);
    expect(connector.listColumns).not.toHaveBeenCalled();
  });

  it('attachCategoriesToBooks returns early when required mapping columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['some_col'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachCategoriesToBooks({}, [], 'categories', 'category_mapping');
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('attachCategoriesToBooks returns early when category id or name columns are missing', async () => {
    const connector = {
      listColumns: vi
        .fn()
        .mockResolvedValueOnce(new Set(['book_id', 'category_id']))
        .mockResolvedValueOnce(new Set(['description'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachCategoriesToBooks({}, [], 'categories', 'category_mapping');
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('attachTagsToBooks returns early when no tagTable or mappingTable', async () => {
    const connector = { listColumns: vi.fn(), queryRows: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachTagsToBooks({}, [], null, 'mapping');
    await (adapter as any).attachTagsToBooks({}, [], 'tags', null);
    expect(connector.listColumns).not.toHaveBeenCalled();
  });

  it('attachTagsToBooks returns early when required mapping columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['some_col'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachTagsToBooks({}, [], 'tags', 'tag_mapping');
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('attachTagsToBooks returns early when tag id or name columns are missing', async () => {
    const connector = {
      listColumns: vi
        .fn()
        .mockResolvedValueOnce(new Set(['book_id', 'tag_id']))
        .mockResolvedValueOnce(new Set(['description'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    await (adapter as any).attachTagsToBooks({}, [], 'tags', 'tag_mapping');
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchShelves returns empty shelves/shelfBooks when required shelf columns are missing', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['some_col'])),
      queryRows: vi.fn(),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchShelves({}, 'shelf', 'book_shelf_mapping', 'book');
    expect(result).toEqual({ shelves: [], shelfBooks: [] });
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('fetchShelves returns shelves with empty shelfBooks when map columns are missing', async () => {
    const connector = {
      listColumns: vi
        .fn()
        .mockResolvedValueOnce(new Set(['id', 'user_id', 'name']))
        .mockResolvedValueOnce(new Set(['some_col'])),
      queryRows: vi.fn().mockResolvedValueOnce([{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchShelves({}, 'shelf', 'book_shelf_mapping', 'book');
    expect(result.shelves).toHaveLength(1);
    expect(result.shelfBooks).toEqual([]);
  });

  it('fetchUsers returns empty array when no usersTable', async () => {
    const connector = { listColumns: vi.fn(), queryRows: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUsers({}, null);
    expect(result).toEqual([]);
  });

  it('fetchBooks returns empty array when no bookTable', async () => {
    const connector = { listColumns: vi.fn(), queryRows: vi.fn() };
    const adapter = new BookloreSourceAdapter(connector as never);
    const resolved = {
      book: null,
      bookMetadata: null,
      bookFile: null,
      libraryPath: null,
      authors: null,
      authorMapping: null,
      userBookProgress: null,
      userBookFileProgress: null,
      bookmarks: null,
      annotations: null,
      pdfAnnotations: null,
      shelves: null,
      shelfBooks: null,
      categories: null,
      categoryMapping: null,
      tags: null,
      tagMapping: null,
      bookNotes: null,
      bookNotesV2: null,
      users: null,
      epubViewerPreference: null,
      ebookViewerPreference: null,
      pdfViewerPreference: null,
      cbxViewerPreference: null,
      newPdfViewerPreference: null,
      koboUserSettings: null,
      koboReadingState: null,
      comicMetadata: null,
    };
    const result = await (adapter as any).fetchBooks({}, resolved);
    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('toIso handles invalid Date objects', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id', 'updated_at'])),
      queryRows: vi.fn().mockResolvedValue([
        {
          sourceUserId: 'u1',
          sourceBookId: 'b1',
          status: null,
          percentage: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: new Date('invalid'),
        },
      ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserBookStatuses({}, 'user_book_progress');
    expect(result[0].updatedAt).toBeNull();
  });

  it('toIso returns null for invalid string dates', async () => {
    const connector = {
      listColumns: vi.fn().mockResolvedValue(new Set(['user_id', 'book_id', 'updated_at'])),
      queryRows: vi
        .fn()
        .mockResolvedValue([
          { sourceUserId: 'u1', sourceBookId: 'b1', status: null, percentage: null, startedAt: null, finishedAt: null, updatedAt: 'not-a-date' },
        ]),
    };
    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await (adapter as any).fetchUserBookStatuses({}, 'user_book_progress');
    expect(result[0].updatedAt).toBeNull();
  });

  it('parseContributorNames handles semicolon-delimited names', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: 'true',
              narrator: 'Narrator A; Narrator B; Narrator A',
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books[0]!.narrators).toHaveLength(2);
    expect(result.books[0]!.narrators.map((n) => n.name)).toEqual(['Narrator A', 'Narrator B']);
    expect(result.books[0]!.abridged).toBe(true);
  });

  it('asBoolean handles boolean true/false, bigint, and unrecognized string returning null', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: true,
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
            {
              sourceBookId: 'b2',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: false,
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
            {
              sourceBookId: 'b3',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: 'unknown_value',
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
            {
              sourceBookId: 'b4',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: 'no',
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
            {
              sourceBookId: 'b5',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: null,
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: 'yes',
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books[0]!.abridged).toBe(true);
    expect(result.books[1]!.abridged).toBe(false);
    expect(result.books[2]!.abridged).toBeNull();
    expect(result.books[3]!.abridged).toBe(false);
    expect(result.books[4]!.abridged).toBe(true);
  });

  it('parsePublishedYear extracts year from date string when integer is out of range', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set([BOOKLORE_TABLES.users, BOOKLORE_TABLES.book])),
      listColumns: vi.fn().mockImplementation((_conn, tableName: string) => {
        if (tableName === BOOKLORE_TABLES.users) return Promise.resolve(new Set(['id']));
        if (tableName === BOOKLORE_TABLES.book) return Promise.resolve(new Set(['id']));
        return Promise.resolve(new Set<string>());
      }),
      queryRows: vi.fn().mockImplementation((_conn, sqlText: string) => {
        if (sqlText.includes('FROM `users` u')) return Promise.resolve([]);
        if (sqlText.includes('FROM `book` b')) {
          return Promise.resolve([
            {
              sourceBookId: 'b1',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: 'Published in 1984 by Penguin',
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: null,
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
            {
              sourceBookId: 'b2',
              title: null,
              author: null,
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: null,
              publisher: null,
              publishedYear: null,
              publishedDate: 'no year here',
              language: null,
              pageCount: null,
              seriesName: null,
              seriesIndex: null,
              rating: null,
              googleBooksId: null,
              goodreadsId: null,
              amazonId: null,
              hardcoverId: null,
              audibleId: null,
              comicvineId: null,
              durationSeconds: null,
              abridged: null,
              narrator: null,
              sourceFileId: null,
              directFilePath: null,
              fileName: null,
              fileSubPath: null,
              currentHash: null,
              initialHash: null,
              fileDurationSeconds: null,
              libraryRootPath: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const adapter = new BookloreSourceAdapter(connector as never);
    const result = await adapter.exportData({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'pass',
      database: 'booklore',
      mediaRootPath: null,
      ssl: false,
    });

    expect(result.books[0]!.publishedYear).toBe(1984);
    expect(result.books[1]!.publishedYear).toBeNull();
  });
});
