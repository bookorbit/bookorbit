import { dirname, join, relative } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type mysql from 'mysql2/promise';

import * as schema from '../../../src/db/schema';
import {
  buildBookloreConnectionConfig,
  createUser,
  seedLibrary,
  type CreatedUser,
  type MigrationBookloreE2EContext,
  withBookloreConnection,
} from './migration-booklore-harness';

interface SeededBook {
  bookId: number;
  primaryFileId: number;
  fileIds: number[];
  absolutePaths: string[];
}

export interface CanonicalMigrationScenario {
  connectionConfig: Record<string, unknown>;
  pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>;
  targetUsers: {
    alice: CreatedUser;
    bob: CreatedUser;
  };
  books: {
    isbn: SeededBook;
    hash: SeededBook;
    audio: SeededBook;
    titleAuthor: SeededBook;
    duplicate: SeededBook;
  };
  sourceBookIds: {
    isbn: string;
    hash: string;
    audio: string;
    titleAuthor: string;
    duplicatePreferred: string;
    duplicateRejected: string;
    unmatched: string;
  };
}

export interface CompatibilityScenario {
  connectionConfig: Record<string, unknown>;
  pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>;
  targetUser: CreatedUser;
  book: SeededBook;
}

export interface MinimalScenario {
  connectionConfig: Record<string, unknown>;
  targetUser: CreatedUser;
  book: SeededBook;
}

let nextInode = 1000;

export async function seedCanonicalScenario(ctx: MigrationBookloreE2EContext): Promise<CanonicalMigrationScenario> {
  const alice = await createUser(ctx, {
    username: 'migration-booklore-alice-source',
    email: 'alice-source@example.com',
  });
  const bob = await createUser(ctx, {
    username: 'migration-booklore-bob-source',
    email: 'bob-source@example.com',
  });

  const libraryRoot = join(ctx.booksPath, 'target-library');
  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: libraryRoot,
    mode: 'book_per_folder',
    name: 'Migration Booklore Library',
  });

  const isbn = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'isbn-match',
    files: [{ relativePath: 'isbn-match/book.epub', format: 'epub', hash: 'target-isbn-hash' }],
    metadata: {
      title: 'Old ISBN Title',
      subtitle: 'Old ISBN Subtitle',
      description: 'Old description',
      isbn13: '9781111111111',
      publisher: 'Old Publisher',
      publishedYear: 1999,
      language: 'fr',
      pageCount: 12,
      seriesName: 'Old Series',
      seriesIndex: 0.5,
      rating: 1,
      googleBooksId: 'old-google',
      goodreadsId: 'old-gr',
      amazonId: 'OLDASIN',
      hardcoverId: 'old-hc',
      audibleId: 'old-aud',
      comicvineId: 'old-cv',
      durationSeconds: 10,
      abridged: false,
    },
    authors: ['Obsolete Author'],
    narrators: ['Obsolete Narrator'],
    genres: ['Obsolete Genre'],
    tags: ['Obsolete Tag'],
  });

  const hash = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'hash-match',
    files: [{ relativePath: 'hash-match/hash-match.epub', format: 'epub', hash: 'shared-hash-match' }],
    metadata: {
      title: 'Old Hash Title',
      subtitle: 'Will clear',
      description: 'Old hash description',
      rating: 4,
      googleBooksId: 'will-clear',
    },
    authors: ['Old Hash Author'],
    tags: ['Old Hash Tag'],
  });

  const audio = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'audio-path-match',
    files: [
      { relativePath: 'audio-path-match/disc-1/part1.mp3', format: 'mp3', hash: 'audio-hash-1', durationSeconds: 120 },
      { relativePath: 'audio-path-match/disc-1/part2.mp3', format: 'mp3', hash: 'audio-hash-2', durationSeconds: 180 },
    ],
    metadata: {
      title: 'Old Audio Title',
      subtitle: 'Old Audio Subtitle',
    },
    authors: ['Placeholder Audio Author'],
  });

  const titleAuthor = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'title-author-match',
    files: [{ relativePath: 'title-author-match/title-author.epub', format: 'epub', hash: 'target-title-hash' }],
    metadata: {
      title: 'Title Author Match',
      subtitle: 'Should stay null',
    },
    authors: ['Unique Title Author'],
  });

  const duplicate = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'duplicate-match',
    files: [{ relativePath: 'duplicate-match/duplicate.epub', format: 'epub', hash: 'dup-target-hash' }],
    metadata: {
      title: 'Duplicate Target',
      isbn13: '9789999999995',
    },
    authors: ['Duplicate Target Author'],
  });

  await ctx.db.insert(schema.collections).values({
    userId: alice.id,
    name: 'Favorites',
    description: 'Existing favorites collection',
    syncToKobo: false,
    displayOrder: 0,
  });

  await withBookloreConnection(ctx, async (conn) => {
    await createCanonicalSchema(conn);

    await insertRows(
      conn,
      'users',
      ['id', 'username', 'name', 'email'],
      [
        [1, 'alice-source', 'Alice Source', 'alice-source@example.com'],
        [2, 'bob-source', 'Bob Source', 'bob-source@example.com'],
        [3, 'ghost-source', 'Ghost Source', 'ghost-source@example.com'],
      ],
    );

    await insertRows(conn, 'library_path', ['id', 'path'], [[1, '/booklore-media/library']]);

    await insertRows(
      conn,
      'book',
      ['id', 'library_path_id', 'deleted'],
      [
        [101, 1, 0],
        [102, 1, 0],
        [103, 1, 0],
        [104, 1, 0],
        [105, 1, 0],
        [106, 1, 0],
        [107, 1, 0],
      ],
    );

    await insertRows(
      conn,
      'book_metadata',
      [
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
        'series_number',
        'rating',
        'google_books_id',
        'goodreads_id',
        'asin',
        'hardcover_id',
        'audible_id',
        'comicvine_id',
        'duration_seconds',
        'abridged',
        'narrator',
      ],
      [
        [
          101,
          'Imported ISBN Title',
          'Legacy Author',
          'Imported Subtitle',
          '1234567890',
          '9781111111111',
          'Long imported description',
          'Imported Publisher',
          2021,
          'en',
          321,
          'Series Prime',
          2.5,
          5,
          'google-101',
          'gr-101',
          'ASIN101',
          'hc-101',
          'aud-101',
          'cv-101',
          11111,
          1,
          'Narrator One|Narrator Two',
        ],
        [
          102,
          'Imported Hash Title',
          'Single Hash Author',
          null,
          null,
          null,
          'Hash description',
          null,
          101,
          null,
          -5,
          null,
          null,
          12,
          null,
          null,
          null,
          null,
          null,
          null,
          -30,
          0,
          null,
        ],
        [
          103,
          'Audio Path Match',
          '["Audio Author","Guest Author"]',
          null,
          null,
          null,
          'Audio description',
          'Audio Publisher',
          2020,
          'en',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'audio-id-103',
          null,
          300,
          'yes',
          '["Narrator Alpha","Narrator Beta"]',
        ],
        [
          104,
          'Title Author Match',
          'Unique Title Author',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          0,
          null,
        ],
        [
          105,
          'Duplicate Preferred',
          'Duplicate Preferred Author',
          null,
          null,
          '9789999999995',
          'Preferred duplicate',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          0,
          null,
        ],
        [
          106,
          'Duplicate Rejected',
          'Duplicate Rejected Author',
          null,
          null,
          '9789999999995',
          'Rejected duplicate',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          0,
          null,
        ],
        [
          107,
          'Unmatched Source',
          'Missing Match',
          null,
          null,
          null,
          'Unmatched book',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          0,
          null,
        ],
      ],
    );

    await insertRows(
      conn,
      'book_file',
      ['id', 'book_id', 'absolute_path', 'file_name', 'file_sub_path', 'current_hash', 'initial_hash', 'duration_seconds', 'is_book'],
      [
        [1001, 101, '/booklore-media/library/isbn-match/book.epub', 'book.epub', 'isbn-match', 'source-hash-101', null, null, 1],
        [1002, 102, '/unmapped/hash-match.epub', 'hash-match.epub', 'hash-match', 'shared-hash-match', null, null, 1],
        [
          1003,
          103,
          '/booklore-media/library/audio-path-match/disc-1/part1.mp3',
          'part1.mp3',
          'audio-path-match/disc-1',
          'audio-hash-1',
          null,
          120,
          1,
        ],
        [
          1004,
          103,
          '/booklore-media/library/audio-path-match/disc-1/part2.mp3',
          'part2.mp3',
          'audio-path-match/disc-1',
          'audio-hash-2',
          null,
          180,
          1,
        ],
        [1005, 104, '/other/no-match/title-author.epub', 'title-author.epub', 'title-author-match', 'title-author-no-match', null, null, 1],
        [1006, 105, '/dup/preferred.epub', 'preferred.epub', 'duplicate-match', 'dup-hash-1', null, null, 1],
        [1007, 106, '/dup/rejected.epub', 'rejected.epub', 'duplicate-match', 'dup-hash-2', null, null, 1],
        [1008, 107, '/missing/unmatched.epub', 'unmatched.epub', 'unmatched', 'unmatched-hash', null, null, 1],
      ],
    );

    await insertRows(
      conn,
      'author',
      ['id', 'name', 'sort_name', 'description'],
      [
        [1, 'Jane Primary', 'Primary, Jane', 'Primary author bio'],
        [2, 'John Secondary', 'Secondary, John', 'Secondary author bio'],
        [3, 'Single Hash Author', 'Hash, Single', null],
        [4, 'Duplicate Preferred Author', 'Preferred, Duplicate', null],
        [5, 'Duplicate Rejected Author', 'Rejected, Duplicate', null],
      ],
    );

    await insertRows(
      conn,
      'book_metadata_author_mapping',
      ['book_id', 'author_id', 'sort_order'],
      [
        [101, 1, 0],
        [101, 2, 1],
        [102, 3, 0],
        [105, 4, 0],
        [106, 5, 0],
      ],
    );

    await insertRows(
      conn,
      'category',
      ['id', 'name'],
      [
        [1, 'Fantasy'],
        [2, 'Adventure'],
        [3, 'Audio Fiction'],
      ],
    );

    await insertRows(
      conn,
      'book_metadata_category_mapping',
      ['book_id', 'category_id'],
      [
        [101, 1],
        [101, 2],
        [103, 3],
      ],
    );

    await insertRows(
      conn,
      'tag',
      ['id', 'name'],
      [
        [1, 'Imported Tag 1'],
        [2, 'Imported Tag 2'],
        [3, 'Hash Imported Tag'],
      ],
    );

    await insertRows(
      conn,
      'book_metadata_tag_mapping',
      ['book_id', 'tag_id'],
      [
        [101, 1],
        [101, 2],
        [102, 3],
      ],
    );

    await insertRows(
      conn,
      'user_book_progress',
      ['user_id', 'book_id', 'status', 'percentage', 'started_at', 'finished_at', 'updated_at'],
      [
        [1, 101, 'completed', 100, '2024-01-02 12:00:00', '2024-01-10 12:00:00', '2024-01-11 12:00:00'],
        [2, 103, null, 55, '2024-02-01 12:00:00', null, '2024-02-02 12:00:00'],
        [3, 104, 'reading', 12, '2024-03-01 12:00:00', null, '2024-03-02 12:00:00'],
        [1, 105, 'wishlist', 0, null, null, '2024-04-02 12:00:00'],
      ],
    );

    await insertRows(
      conn,
      'user_book_file_progress',
      ['user_id', 'book_id', 'book_file_id', 'percentage', 'cfi', 'position_href', 'page_number', 'position_seconds', 'updated_at'],
      [
        [1, 101, 1001, 33.3, 'epubcfi(/6/2[chap]!/4/1:0)', null, null, null, '2024-01-11 13:00:00'],
        [1, 102, null, 22.4, null, null, 10, null, '2024-01-12 13:00:00'],
        [2, 103, 1004, 66, null, null, null, 12.5, '2024-02-02 13:00:00'],
        [3, 104, 1005, 12, 'epubcfi(/6/2!/4/1:0)', null, null, null, '2024-03-02 13:00:00'],
      ],
    );

    await insertRows(
      conn,
      'book_marks',
      ['user_id', 'book_id', 'book_file_id', 'title', 'cfi', 'position_seconds', 'track_index', 'created_at'],
      [
        [1, 101, 1001, 'Chapter 1', 'epubcfi(/6/2[chap]!/4/1:0)', null, null, '2024-01-03 12:00:00'],
        [2, 103, null, null, null, 15, 2, '2024-02-03 12:00:00'],
      ],
    );

    await insertRows(
      conn,
      'annotations',
      ['user_id', 'book_id', 'cfi', 'text', 'color', 'style', 'note', 'chapter_title', 'created_at', 'updated_at'],
      [
        [
          1,
          101,
          'epubcfi(/6/4!/4/2:10)',
          'Important quote',
          'blue',
          'underline',
          'remember this',
          'Chapter One',
          '2024-01-04 12:00:00',
          '2024-01-05 12:00:00',
        ],
        [2, 104, 'epubcfi(/6/8!/4/4:1)', 'Fallback defaults', null, null, null, null, '2024-02-04 12:00:00', '2024-02-05 12:00:00'],
      ],
    );

    await insertRows(
      conn,
      'shelf',
      ['id', 'user_id', 'name'],
      [
        [501, 1, 'Favorites'],
        [502, 2, 'Audio Shelf'],
      ],
    );

    await insertRows(
      conn,
      'book_shelf_mapping',
      ['shelf_id', 'book_id'],
      [
        [501, 101],
        [501, 104],
        [502, 103],
      ],
    );
  });

  await writeSourceCover(ctx, '101', { format: 'jpeg', color: '#cc3344', writeThumbnail: false });
  await writeSourceCover(ctx, '103', { format: 'png', color: '#2255cc', writeThumbnail: true });

  return {
    connectionConfig: buildBookloreConnectionConfig(ctx),
    pathMappings: [{ sourcePrefix: '/booklore-media/library', targetPrefix: libraryRoot }],
    targetUsers: { alice, bob },
    books: { isbn, hash, audio, titleAuthor, duplicate },
    sourceBookIds: {
      isbn: '101',
      hash: '102',
      audio: '103',
      titleAuthor: '104',
      duplicatePreferred: '105',
      duplicateRejected: '106',
      unmatched: '107',
    },
  };
}

export async function seedCanonicalScenarioWithDuplicateUserStateRows(ctx: MigrationBookloreE2EContext): Promise<CanonicalMigrationScenario> {
  const scenario = await seedCanonicalScenario(ctx);

  await withBookloreConnection(ctx, async (conn) => {
    await insertRows(
      conn,
      'user_book_progress',
      ['user_id', 'book_id', 'status', 'percentage', 'started_at', 'finished_at', 'updated_at'],
      [
        [1, 101, 'reading', 64, '2024-01-02 12:00:00', null, '2024-01-11 14:00:00'],
        [2, 103, 'completed', 100, '2024-02-01 12:00:00', '2024-02-05 12:00:00', '2024-02-05 12:00:00'],
      ],
    );

    await insertRows(
      conn,
      'user_book_file_progress',
      ['user_id', 'book_id', 'book_file_id', 'percentage', 'cfi', 'position_href', 'page_number', 'position_seconds', 'updated_at'],
      [
        [1, 101, 1001, 44.4, 'epubcfi(/6/18!/4/2:10)', null, null, null, '2024-01-11 14:00:00'],
        [2, 103, 1004, 77, null, null, null, 45, '2024-02-05 12:30:00'],
      ],
    );
  });

  return scenario;
}

export async function seedCompatibilityScenario(ctx: MigrationBookloreE2EContext): Promise<CompatibilityScenario> {
  const targetUser = await createUser(ctx, {
    username: 'migration-booklore-variant-source',
    email: 'variant-source@example.com',
  });
  const libraryRoot = join(ctx.booksPath, 'variant-target-library');
  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: libraryRoot,
    mode: 'book_per_folder',
    name: 'Migration Booklore Variant Library',
  });

  const book = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'variant-book',
    files: [{ relativePath: 'variant-book/book.pdf', format: 'pdf', hash: 'variant-target-hash' }],
    metadata: {
      title: 'Existing Variant Title',
      subtitle: 'Keep this subtitle',
      description: 'Old variant description',
    },
    authors: ['Existing Variant Author'],
  });

  await withBookloreConnection(ctx, async (conn) => {
    await createCompatibilitySchema(conn);

    await insertRows(
      conn,
      'users',
      ['user_id', 'user_name', 'display_name', 'mail'],
      [[41, 'variant-source', 'Variant Source User', 'variant-source@example.com']],
    );
    await insertRows(conn, 'library_path', ['id', 'absolute_path'], [[11, '/alt-source/root']]);
    await insertRows(conn, 'book', ['id', 'librarypath_id', 'deleted'], [[401, 11, 0]]);
    await insertRows(
      conn,
      'book_metadata',
      [
        'id',
        'title',
        'author',
        'isbn_10',
        'isbn_13',
        'description',
        'publisher',
        'published_date',
        'language',
        'pages',
        'series',
        'series_position',
        'rating',
        'google_id',
        'duration',
        'abridged',
        'narrators',
      ],
      [
        [
          401,
          'Variant Imported Title',
          '["Variant Author","Second Variant Author"]',
          '0123456789',
          '9780000000401',
          'Variant imported description',
          'Variant Publisher',
          '2022-05-06',
          'en',
          222,
          'Variant Series',
          1.25,
          4,
          'variant-google-id',
          987,
          'no',
          'Narrator Gamma|Narrator Delta',
        ],
      ],
    );
    await insertRows(conn, 'author', ['id', 'name'], [[1, 'Unused Variant Author']]);
    await insertRows(conn, 'book_metadata_author_mapping', ['book_id', 'author_id', 'sort_order'], []);
    await insertRows(
      conn,
      'book_file',
      ['id', 'bookid', 'file_name', 'file_subpath', 'file_hash', 'duration'],
      [[501, 401, 'book.pdf', 'variant-book', 'variant-source-hash', null]],
    );
    await insertRows(
      conn,
      'user_book_progress',
      ['userid', 'bookid', 'read_status', 'progress_percent', 'date_started', 'date_finished', 'last_read_time'],
      [[41, 401, 'paused', 78, '2024-03-01 12:00:00', null, '2024-03-02 12:00:00']],
    );
    await insertRows(
      conn,
      'user_book_file_progress',
      ['userid', 'book_file_id', 'progress', 'location', 'href', 'page', 'position_ms', 'modified_at'],
      [[41, 501, 78, 'epubcfi(/6/10!/4/2:20)', '/chapter-9', 9, 6500, '2024-03-02 12:30:00']],
    );
    await insertRows(
      conn,
      'book_marks',
      ['userid', 'bookid', 'file_id', 'name', 'location', 'position_ms', 'track', 'createdat'],
      [[41, 401, 501, 'Variant bookmark', 'epubcfi(/6/12!/4/2:1)', 2500, null, '2024-03-03 12:00:00']],
    );
  });

  return {
    connectionConfig: buildBookloreConnectionConfig(ctx),
    pathMappings: [{ sourcePrefix: '/alt-source/root', targetPrefix: libraryRoot }],
    targetUser,
    book,
  };
}

export async function seedWarningsOnlyScenario(ctx: MigrationBookloreE2EContext): Promise<MinimalScenario> {
  const targetUser = await createUser(ctx, {
    username: 'migration-booklore-warnings-source',
  });
  const libraryRoot = join(ctx.booksPath, 'warnings-library');
  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: libraryRoot,
    mode: 'book_per_folder',
    name: 'Migration Warnings Library',
  });

  const book = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    libraryRoot,
    folderName: 'hash-only',
    files: [{ relativePath: 'hash-only/hash-only.epub', format: 'epub', hash: 'warnings-hash' }],
    metadata: {
      title: 'Hash Only Target',
    },
    authors: ['Hash Only Author'],
  });

  await withBookloreConnection(ctx, async (conn) => {
    await createWarningsOnlySchema(conn);
    await insertRows(conn, 'users', ['id', 'username'], [[91, 'warnings-source']]);
    await insertRows(conn, 'book', ['id', 'deleted'], [[901, 0]]);
    await insertRows(
      conn,
      'book_file',
      ['id', 'book_id', 'absolute_path', 'current_hash', 'is_book'],
      [[9901, 901, '/warnings/hash-only.epub', 'warnings-hash', 1]],
    );
  });

  return {
    connectionConfig: buildBookloreConnectionConfig(ctx, { mediaRootPath: null }),
    targetUser,
    book,
  };
}

export async function seedMissingRequiredTablesScenario(ctx: MigrationBookloreE2EContext): Promise<Record<string, unknown>> {
  await withBookloreConnection(ctx, async (conn) => {
    await createMissingRequiredSchema(conn);
    await insertRows(conn, 'users', ['id', 'username'], [[71, 'incomplete-source']]);
    await insertRows(conn, 'book', ['id', 'deleted'], [[701, 0]]);
  });

  return buildBookloreConnectionConfig(ctx);
}

interface InsertTargetBookInput {
  libraryId: number;
  libraryFolderId: number;
  libraryRoot: string;
  folderName: string;
  files: Array<{
    relativePath: string;
    format: string;
    hash: string | null;
    durationSeconds?: number | null;
  }>;
  metadata?: Partial<typeof schema.bookMetadata.$inferInsert>;
  authors?: string[];
  narrators?: string[];
  genres?: string[];
  tags?: string[];
}

async function insertTargetBook(ctx: MigrationBookloreE2EContext, input: InsertTargetBookInput): Promise<SeededBook> {
  const folderPath = join(input.libraryRoot, input.folderName);
  await mkdir(folderPath, { recursive: true });

  const [book] = await ctx.db
    .insert(schema.books)
    .values({
      libraryId: input.libraryId,
      libraryFolderId: input.libraryFolderId,
      folderPath,
      status: 'present',
    })
    .returning({ id: schema.books.id });

  const fileIds: number[] = [];
  const absolutePaths: string[] = [];

  for (const [index, file] of input.files.entries()) {
    const absolutePath = join(input.libraryRoot, file.relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `target file ${file.relativePath}`);

    const [insertedFile] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId: book.id,
        libraryFolderId: input.libraryFolderId,
        absolutePath,
        relPath: relative(input.libraryRoot, absolutePath),
        ino: nextInode++,
        sizeBytes: 128,
        mtime: new Date('2024-01-01T12:00:00Z'),
        fileHash: file.hash,
        format: file.format,
        role: 'content',
        sortOrder: index,
        durationSeconds: file.durationSeconds ?? null,
      })
      .returning({ id: schema.bookFiles.id, absolutePath: schema.bookFiles.absolutePath });

    fileIds.push(insertedFile.id);
    absolutePaths.push(insertedFile.absolutePath);
  }

  await ctx.db.update(schema.books).set({ primaryFileId: fileIds[0] }).where(eq(schema.books.id, book.id));

  if (input.metadata) {
    await ctx.db.insert(schema.bookMetadata).values({
      bookId: book.id,
      ...input.metadata,
    });
  }

  if (input.authors?.length) {
    for (const [index, name] of input.authors.entries()) {
      const authorId = await ensureAuthorId(ctx, name);
      await ctx.db.insert(schema.bookAuthors).values({ bookId: book.id, authorId, displayOrder: index });
    }
  }

  if (input.narrators?.length) {
    for (const [index, name] of input.narrators.entries()) {
      const narratorId = await ensureNarratorId(ctx, name);
      await ctx.db.insert(schema.bookNarrators).values({ bookId: book.id, narratorId, displayOrder: index });
    }
  }

  if (input.genres?.length) {
    for (const name of input.genres) {
      const genreId = await ensureGenreId(ctx, name);
      await ctx.db.insert(schema.bookGenres).values({ bookId: book.id, genreId });
    }
  }

  if (input.tags?.length) {
    for (const name of input.tags) {
      const tagId = await ensureTagId(ctx, name);
      await ctx.db.insert(schema.bookTags).values({ bookId: book.id, tagId });
    }
  }

  return {
    bookId: book.id,
    primaryFileId: fileIds[0],
    fileIds,
    absolutePaths,
  };
}

async function ensureAuthorId(ctx: MigrationBookloreE2EContext, name: string): Promise<number> {
  const existing = await ctx.db.query.authors.findFirst({ where: eq(schema.authors.name, name) });
  if (existing) return existing.id;

  const [inserted] = await ctx.db.insert(schema.authors).values({ name, sortName: name }).returning({ id: schema.authors.id });
  return inserted.id;
}

async function ensureNarratorId(ctx: MigrationBookloreE2EContext, name: string): Promise<number> {
  const existing = await ctx.db.query.narrators.findFirst({ where: eq(schema.narrators.name, name) });
  if (existing) return existing.id;

  const [inserted] = await ctx.db.insert(schema.narrators).values({ name, sortName: name }).returning({ id: schema.narrators.id });
  return inserted.id;
}

async function ensureGenreId(ctx: MigrationBookloreE2EContext, name: string): Promise<number> {
  const existing = await ctx.db.query.genres.findFirst({ where: eq(schema.genres.name, name) });
  if (existing) return existing.id;

  const [inserted] = await ctx.db.insert(schema.genres).values({ name }).returning({ id: schema.genres.id });
  return inserted.id;
}

async function ensureTagId(ctx: MigrationBookloreE2EContext, name: string): Promise<number> {
  const existing = await ctx.db.query.tags.findFirst({ where: eq(schema.tags.name, name) });
  if (existing) return existing.id;

  const [inserted] = await ctx.db.insert(schema.tags).values({ name }).returning({ id: schema.tags.id });
  return inserted.id;
}

async function writeSourceCover(
  ctx: MigrationBookloreE2EContext,
  sourceBookId: string,
  options: { format: 'jpeg' | 'png'; color: string; writeThumbnail: boolean },
): Promise<void> {
  const imageDir = join(ctx.sourceMediaRoot, 'images', sourceBookId);
  await mkdir(imageDir, { recursive: true });

  const buffer = await sharp({
    create: {
      width: 300,
      height: 450,
      channels: 3,
      background: options.color,
    },
  })
    [options.format]()
    .toBuffer();

  await writeFile(join(imageDir, 'cover.jpg'), buffer);

  if (options.writeThumbnail) {
    const thumbnail = await sharp({
      create: {
        width: 120,
        height: 180,
        channels: 3,
        background: '#f5f5f5',
      },
    })
      .jpeg()
      .toBuffer();
    await writeFile(join(imageDir, 'thumbnail.jpg'), thumbnail);
  }
}

async function insertRows(conn: mysql.Connection, tableName: string, columns: string[], rows: Array<unknown[]>): Promise<void> {
  if (rows.length === 0) return;

  const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
  const sqlText = `INSERT INTO \`${tableName}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES ${placeholders}`;
  await conn.execute(sqlText, rows.flat());
}

async function createCanonicalSchema(conn: mysql.Connection): Promise<void> {
  await executeStatements(conn, [
    'CREATE TABLE `users` (`id` INT PRIMARY KEY, `username` VARCHAR(100), `name` VARCHAR(255), `email` VARCHAR(255))',
    'CREATE TABLE `library_path` (`id` INT PRIMARY KEY, `path` VARCHAR(1024))',
    'CREATE TABLE `book` (`id` INT PRIMARY KEY, `library_path_id` INT, `deleted` TINYINT DEFAULT 0)',
    'CREATE TABLE `book_metadata` (`book_id` INT PRIMARY KEY, `title` VARCHAR(255), `author` TEXT, `subtitle` VARCHAR(255), `isbn10` VARCHAR(20), `isbn13` VARCHAR(20), `description` TEXT, `publisher` VARCHAR(255), `published_year` INT, `language` VARCHAR(40), `page_count` INT, `series_name` VARCHAR(255), `series_number` DECIMAL(10,2), `rating` INT, `google_books_id` VARCHAR(100), `goodreads_id` VARCHAR(100), `asin` VARCHAR(100), `hardcover_id` VARCHAR(100), `audible_id` VARCHAR(100), `comicvine_id` VARCHAR(100), `duration_seconds` INT, `abridged` VARCHAR(10), `narrator` TEXT)',
    'CREATE TABLE `book_file` (`id` INT PRIMARY KEY, `book_id` INT, `absolute_path` VARCHAR(1024), `file_name` VARCHAR(255), `file_sub_path` VARCHAR(1024), `current_hash` VARCHAR(64), `initial_hash` VARCHAR(64), `duration_seconds` INT, `is_book` TINYINT DEFAULT 1)',
    'CREATE TABLE `author` (`id` INT PRIMARY KEY, `name` VARCHAR(255), `sort_name` VARCHAR(255), `description` TEXT)',
    'CREATE TABLE `book_metadata_author_mapping` (`book_id` INT, `author_id` INT, `sort_order` INT)',
    'CREATE TABLE `user_book_progress` (`user_id` INT, `book_id` INT, `status` VARCHAR(50), `percentage` DECIMAL(8,2), `started_at` DATETIME, `finished_at` DATETIME, `updated_at` DATETIME)',
    'CREATE TABLE `user_book_file_progress` (`user_id` INT, `book_id` INT, `book_file_id` INT, `percentage` DECIMAL(8,2), `cfi` VARCHAR(2000), `position_href` VARCHAR(255), `page_number` INT, `position_seconds` DECIMAL(10,2), `updated_at` DATETIME)',
    'CREATE TABLE `book_marks` (`user_id` INT, `book_id` INT, `book_file_id` INT, `title` VARCHAR(255), `cfi` VARCHAR(2000), `position_seconds` DECIMAL(10,2), `track_index` INT, `created_at` DATETIME)',
    'CREATE TABLE `annotations` (`user_id` INT, `book_id` INT, `cfi` VARCHAR(2000), `text` TEXT, `color` VARCHAR(20), `style` VARCHAR(20), `note` TEXT, `chapter_title` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME)',
    'CREATE TABLE `shelf` (`id` INT PRIMARY KEY, `user_id` INT, `name` VARCHAR(255))',
    'CREATE TABLE `book_shelf_mapping` (`shelf_id` INT, `book_id` INT)',
    'CREATE TABLE `category` (`id` INT PRIMARY KEY, `name` VARCHAR(255))',
    'CREATE TABLE `book_metadata_category_mapping` (`book_id` INT, `category_id` INT)',
    'CREATE TABLE `tag` (`id` INT PRIMARY KEY, `name` VARCHAR(255))',
    'CREATE TABLE `book_metadata_tag_mapping` (`book_id` INT, `tag_id` INT)',
  ]);
}

async function createCompatibilitySchema(conn: mysql.Connection): Promise<void> {
  await executeStatements(conn, [
    'CREATE TABLE `users` (`user_id` INT PRIMARY KEY, `user_name` VARCHAR(100), `display_name` VARCHAR(255), `mail` VARCHAR(255))',
    'CREATE TABLE `library_path` (`id` INT PRIMARY KEY, `absolute_path` VARCHAR(1024))',
    'CREATE TABLE `book` (`id` INT PRIMARY KEY, `librarypath_id` INT, `deleted` TINYINT DEFAULT 0)',
    'CREATE TABLE `book_metadata` (`id` INT PRIMARY KEY, `title` VARCHAR(255), `author` TEXT, `isbn_10` VARCHAR(20), `isbn_13` VARCHAR(20), `description` TEXT, `publisher` VARCHAR(255), `published_date` VARCHAR(40), `language` VARCHAR(20), `pages` INT, `series` VARCHAR(255), `series_position` DECIMAL(10,2), `rating` INT, `google_id` VARCHAR(100), `duration` INT, `abridged` VARCHAR(10), `narrators` TEXT)',
    'CREATE TABLE `author` (`id` INT PRIMARY KEY, `name` VARCHAR(255))',
    'CREATE TABLE `book_metadata_author_mapping` (`book_id` INT, `author_id` INT, `sort_order` INT)',
    'CREATE TABLE `book_file` (`id` INT PRIMARY KEY, `bookid` INT, `file_name` VARCHAR(255), `file_subpath` VARCHAR(1024), `file_hash` VARCHAR(64), `duration` INT)',
    'CREATE TABLE `user_book_progress` (`userid` INT, `bookid` INT, `read_status` VARCHAR(50), `progress_percent` DECIMAL(8,2), `date_started` DATETIME, `date_finished` DATETIME, `last_read_time` DATETIME)',
    'CREATE TABLE `user_book_file_progress` (`userid` INT, `book_file_id` INT, `progress` DECIMAL(8,2), `location` VARCHAR(2000), `href` VARCHAR(255), `page` INT, `position_ms` BIGINT, `modified_at` DATETIME)',
    'CREATE TABLE `book_marks` (`userid` INT, `bookid` INT, `file_id` INT, `name` VARCHAR(255), `location` VARCHAR(2000), `position_ms` BIGINT, `track` INT, `createdat` DATETIME)',
  ]);
}

async function createWarningsOnlySchema(conn: mysql.Connection): Promise<void> {
  await executeStatements(conn, [
    'CREATE TABLE `users` (`id` INT PRIMARY KEY, `username` VARCHAR(100))',
    'CREATE TABLE `book` (`id` INT PRIMARY KEY, `deleted` TINYINT DEFAULT 0)',
    'CREATE TABLE `book_file` (`id` INT PRIMARY KEY, `book_id` INT, `absolute_path` VARCHAR(1024), `current_hash` VARCHAR(64), `is_book` TINYINT DEFAULT 1)',
  ]);
}

async function createMissingRequiredSchema(conn: mysql.Connection): Promise<void> {
  await executeStatements(conn, [
    'CREATE TABLE `users` (`id` INT PRIMARY KEY, `username` VARCHAR(100))',
    'CREATE TABLE `book` (`id` INT PRIMARY KEY, `deleted` TINYINT DEFAULT 0)',
  ]);
}

async function executeStatements(conn: mysql.Connection, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await conn.execute(statement);
  }
}
