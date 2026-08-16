import { execFile as execFileCallback } from 'child_process';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { createRequire } from 'module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname, join, relative } from 'path';
import { promisify } from 'util';
import { ZipArchive } from 'archiver';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';

import * as schema from '../../../src/db/schema';
import { createEpubFile } from '../file-rename/file-rename-fixture-builder';
import { seedLibrary } from '../app-harness';
import type { MigrationCalibreWebAutomatedE2EContext, StoppedCalibreWebAutomatedInstance } from './migration-calibre-web-automated-harness';

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);
const CEDAR_CFI = 'epubcfi(/6/2[chapter]!/4/2/2:5)';
const KOBO_CFI = 'epubcfi(/6/2[chapter]!/4/2/2:11)';
const QUIET_CFI = 'epubcfi(/6/2[chapter]!/4/2/2:17)';
const THEO_STARTED_AT = '2025-01-10T08:15:00.000Z';
const THEO_FINISHED_AT = '2025-01-15T12:30:00.000Z';
const QUIET_CHECKSUM = 'quiet-cartographer-koreader-checksum';

interface InstallerPackage {
  path: string;
}

interface SourceBookFixture {
  id: number;
  path: string;
  files: Array<{ id: number; format: string; name: string }>;
}

export interface CalibreWebAutomatedSourceFixture {
  sourceUsers: { maya: string; theo: string; lina: string; guest: string };
  books: Record<'cedar' | 'tides' | 'quiet' | 'clock' | 'panels' | 'lantern', SourceBookFixture>;
  expected: {
    cedarCfi: string;
    koboCfi: string;
    quietCfi: string;
    quietPercentage: number;
    koboPercentage: number;
    audioPositionSeconds: number;
    comicPageNumber: number;
    theoStartedAt: string;
    theoFinishedAt: string;
    shelfOrder: number[];
  };
}

interface SeededTargetBook {
  bookId: number;
  fileIds: number[];
  absolutePaths: string[];
}

export interface CalibreWebAutomatedMigrationScenario {
  source: CalibreWebAutomatedSourceFixture;
  pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>;
  targetUsers: {
    maya: { id: number; username: string };
    theo: { id: number; username: string };
    lina: { id: number; username: string };
  };
  targetBooks: Record<'cedar' | 'tides' | 'quiet' | 'clock' | 'panels' | 'unrelated', SeededTargetBook>;
  preexistingCollectionId: number;
}

export async function seedStoppedCalibreWebAutomatedSource(instance: StoppedCalibreWebAutomatedInstance): Promise<CalibreWebAutomatedSourceFixture> {
  const books = {
    cedar: { id: 101, path: 'Cedar Signal', files: [{ id: 1001, format: 'EPUB', name: 'The Cedar Signal' }] },
    tides: {
      id: 102,
      path: 'Tides',
      files: [
        { id: 1002, format: 'EPUB', name: 'Tides Beyond Glass' },
        { id: 1003, format: 'KEPUB', name: 'Tides Beyond Glass' },
      ],
    },
    quiet: { id: 103, path: 'Quiet Cartographer', files: [{ id: 1004, format: 'EPUB', name: 'The Quiet Cartographer' }] },
    clock: { id: 104, path: 'Clock in Winter', files: [{ id: 1005, format: 'MP3', name: 'A Clock in Winter' }] },
    panels: { id: 105, path: 'Panels', files: [{ id: 1006, format: 'CBZ', name: 'Panels at Dawn' }] },
    lantern: { id: 106, path: 'Lantern Archive', files: [{ id: 1007, format: 'EPUB', name: 'Lantern Archive' }] },
  } satisfies Record<string, SourceBookFixture>;

  await createSourceMedia(instance.sourceLibraryRoot, books);
  seedMetadataDatabase(instance.metadataDatabasePath, books);
  seedAppDatabase(instance.appDatabasePath, books);

  return {
    sourceUsers: { maya: '1', theo: '3', lina: '4', guest: '2' },
    books,
    expected: {
      cedarCfi: CEDAR_CFI,
      koboCfi: KOBO_CFI,
      quietCfi: QUIET_CFI,
      quietPercentage: 73.25,
      koboPercentage: 42.5,
      audioPositionSeconds: 90.5,
      comicPageNumber: 5,
      theoStartedAt: THEO_STARTED_AT,
      theoFinishedAt: THEO_FINISHED_AT,
      shelfOrder: [books.tides.id, books.cedar.id],
    },
  };
}

export async function seedCalibreWebAutomatedTargetScenario(
  ctx: MigrationCalibreWebAutomatedE2EContext<CalibreWebAutomatedSourceFixture>,
): Promise<CalibreWebAutomatedMigrationScenario> {
  const targetUsers = {
    maya: await createTargetUser(ctx, 'maya-chen', 'Maya Chen', 'maya.chen@example.com'),
    theo: await createTargetUser(ctx, 'theo-brooks', 'Theo Brooks', 'theo.brooks@example.com'),
    lina: await createTargetUser(ctx, 'lina-ortiz', 'Lina Ortiz', 'lina.ortiz@example.com'),
  };
  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: ctx.targetLibraryRoot,
    mode: 'book_per_folder',
    name: 'CWA Migration Target',
  });

  const cedar = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    folderName: 'target-cedar',
    files: [{ relativePath: 'target-cedar/cedar.epub', format: 'epub' }],
    metadata: { title: 'Existing Cedar Record', isbn13: '9781940000008' },
    author: 'Existing Cedar Author',
  });
  const tides = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    folderName: 'Tides',
    files: [
      { relativePath: 'Tides/Tides Beyond Glass.epub', format: 'epub' },
      { relativePath: 'Tides/Tides Beyond Glass.kepub', format: 'kepub' },
    ],
    metadata: { title: 'Existing Tides Record' },
    author: 'Existing Tides Author',
  });
  const quiet = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    folderName: 'target-quiet',
    files: [{ relativePath: 'target-quiet/quiet.epub', format: 'epub' }],
    metadata: { title: 'The Quiet Cartographer' },
    author: 'Theo Brooks',
  });
  const clock = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    folderName: 'target-clock',
    files: [{ relativePath: 'target-clock/clock.mp3', format: 'mp3', durationSeconds: 180 }],
    metadata: { title: 'Existing Clock Record', amazonId: 'B0CLOCK123' },
    author: 'Existing Clock Author',
  });
  const panels = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    folderName: 'Panels',
    files: [{ relativePath: 'Panels/Panels at Dawn.cbz', format: 'cbz' }],
    metadata: { title: 'Existing Panels Record' },
    author: 'Existing Panels Author',
  });
  const unrelated = await insertTargetBook(ctx, {
    libraryId,
    libraryFolderId,
    folderName: 'unrelated',
    files: [{ relativePath: 'unrelated/unrelated.epub', format: 'epub' }],
    metadata: { title: 'Unrelated Existing Book' },
    author: 'Unrelated Author',
  });

  await ctx.db.insert(schema.readingProgress).values({
    userId: targetUsers.maya.id,
    bookFileId: unrelated.fileIds[0],
    percentage: 12,
    cfi: 'epubcfi(/6/2[chapter]!/4/2/2:3)',
    updatedAt: new Date('2024-12-01T00:00:00.000Z'),
  });
  const [preexistingCollection] = await ctx.db
    .insert(schema.collections)
    .values({ userId: targetUsers.maya.id, name: 'Before Migration', description: 'Must survive migration', displayOrder: 0 })
    .returning({ id: schema.collections.id });
  await ctx.db.insert(schema.collectionBooks).values({ collectionId: preexistingCollection.id, bookId: unrelated.bookId });

  return {
    source: ctx.sourceFixture,
    pathMappings: [{ sourcePrefix: '/calibre-library', targetPrefix: ctx.targetLibraryRoot }],
    targetUsers,
    targetBooks: { cedar, tides, quiet, clock, panels, unrelated },
    preexistingCollectionId: preexistingCollection.id,
  };
}

function seedMetadataDatabase(path: string, books: CalibreWebAutomatedSourceFixture['books']): void {
  const database = new DatabaseSync(path);
  try {
    database.function('title_sort', { deterministic: true }, (value) => (typeof value === 'string' ? value : ''));
    database.function('uuid4', () => randomUUID());
    database.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
    runMany(
      database,
      'INSERT INTO books (id, title, sort, pubdate, series_index, author_sort, path, flags, uuid, has_cover, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?)',
      [
        [
          books.cedar.id,
          'The Cedar Signal',
          'Cedar Signal, The',
          '2022-01-01T00:00:00Z',
          1,
          'Chen, Maya',
          books.cedar.path,
          'cwa-cedar',
          '2025-01-01T00:00:00Z',
        ],
        [
          books.tides.id,
          'Tides Beyond Glass',
          'Tides Beyond Glass',
          '2023-01-01T00:00:00Z',
          2,
          'Chen, Maya',
          books.tides.path,
          'cwa-tides',
          '2025-01-02T00:00:00Z',
        ],
        [
          books.quiet.id,
          'The Quiet Cartographer',
          'Quiet Cartographer, The',
          '2021-01-01T00:00:00Z',
          1,
          'Brooks, Theo',
          books.quiet.path,
          'cwa-quiet',
          '2025-01-03T00:00:00Z',
        ],
        [
          books.clock.id,
          'A Clock in Winter',
          'Clock in Winter, A',
          '2020-01-01T00:00:00Z',
          1,
          'Vale, Rina',
          books.clock.path,
          'cwa-clock',
          '2025-01-04T00:00:00Z',
        ],
        [
          books.panels.id,
          'Panels at Dawn',
          'Panels at Dawn',
          '2019-01-01T00:00:00Z',
          1,
          'Brooks, Theo',
          books.panels.path,
          'cwa-panels',
          '2025-01-05T00:00:00Z',
        ],
        [
          books.lantern.id,
          'Lantern Archive',
          'Lantern Archive',
          '2018-01-01T00:00:00Z',
          1,
          'Ortiz, Lina',
          books.lantern.path,
          'cwa-lantern',
          '2025-01-06T00:00:00Z',
        ],
      ],
    );
    runMany(
      database,
      'INSERT INTO data (id, book, format, uncompressed_size, name) VALUES (?, ?, ?, ?, ?)',
      Object.values(books).flatMap((book) => book.files.map((file) => [file.id, book.id, file.format, 1024, file.name])),
    );
    runMany(database, 'INSERT INTO authors (id, name, sort, link) VALUES (?, ?, ?, ?)', [
      [201, 'Maya Chen', 'Chen, Maya', ''],
      [202, 'Theo Brooks', 'Brooks, Theo', ''],
      [203, 'Rina Vale', 'Vale, Rina', ''],
      [204, 'Lina Ortiz', 'Ortiz, Lina', ''],
    ]);
    runMany(database, 'INSERT INTO books_authors_link (id, book, author) VALUES (?, ?, ?)', [
      [301, books.cedar.id, 201],
      [302, books.tides.id, 201],
      [303, books.quiet.id, 202],
      [304, books.clock.id, 203],
      [305, books.panels.id, 202],
      [306, books.lantern.id, 204],
    ]);
    runMany(database, 'INSERT INTO identifiers (id, book, type, val) VALUES (?, ?, ?, ?)', [
      [401, books.cedar.id, 'isbn', '9781940000008'],
      [402, books.clock.id, 'asin', 'B0CLOCK123'],
    ]);
    runMany(database, 'INSERT INTO tags (id, name) VALUES (?, ?)', [
      [501, 'Synthetic'],
      [502, 'Migration'],
    ]);
    runMany(database, 'INSERT INTO books_tags_link (id, book, tag) VALUES (?, ?, ?)', [
      [601, books.cedar.id, 501],
      [602, books.tides.id, 502],
    ]);
    runMany(database, 'INSERT INTO book_format_checksums (id, book, format, checksum, version, created) VALUES (?, ?, ?, ?, ?, ?)', [
      [701, books.quiet.id, 'EPUB', QUIET_CHECKSUM, 'koreader', '2025-02-01T00:00:00Z'],
    ]);
    database.exec('COMMIT');
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  } finally {
    database.close();
  }
}

function seedAppDatabase(path: string, books: CalibreWebAutomatedSourceFixture['books']): void {
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
    database.prepare('UPDATE user SET name = ?, email = ? WHERE id = 1').run('maya-chen', 'maya.chen@example.com');
    runMany(database, 'INSERT INTO user (id, name, email, role, password, locale, sidebar_view) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      [3, 'theo-brooks', 'theo.brooks@example.com', 1, '', 'en', 1],
      [4, 'lina-ortiz', 'lina.ortiz@example.com', 1, '', 'en', 1],
    ]);
    runMany(
      database,
      'INSERT INTO book_read_link (id, book_id, user_id, read_status, last_modified, last_time_started_reading, times_started_reading) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        [801, books.cedar.id, 1, 2, '2025-03-01T10:00:00Z', '2025-02-28T09:00:00Z', 1],
        [802, books.cedar.id, 3, 1, THEO_FINISHED_AT, THEO_STARTED_AT, 1],
        [803, books.lantern.id, 4, 2, '2025-04-01T10:00:00Z', '2025-04-01T09:00:00Z', 1],
        [804, books.cedar.id, 2, 2, '2025-05-01T10:00:00Z', '2025-05-01T09:00:00Z', 1],
      ],
    );
    runMany(database, 'INSERT INTO bookmark (id, user_id, book_id, format, bookmark_key) VALUES (?, ?, ?, ?, ?)', [
      [901, 1, books.cedar.id, 'EPUB', CEDAR_CFI],
      [902, 1, books.clock.id, 'MP3', '90500'],
      [903, 3, books.panels.id, 'CBZ', '4'],
      [904, 4, books.lantern.id, 'EPUB', 'epubcfi(/6/2[chapter]!/4/2/2:7)'],
      [905, 2, books.cedar.id, 'EPUB', 'epubcfi(/6/2[chapter]!/4/2/2:9)'],
    ]);
    database
      .prepare('INSERT INTO kobo_reading_state (id, user_id, book_id, last_modified, priority_timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(1001, 1, books.tides.id, '2025-03-02T10:00:00Z', '2025-03-02T10:00:00Z');
    database
      .prepare(
        'INSERT INTO kobo_bookmark (id, kobo_reading_state_id, last_modified, location_source, location_type, location_value, progress_percent, content_source_progress_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1002, 1001, '2025-03-02T10:00:00Z', 'chapter.xhtml', 'KoboSpan', KOBO_CFI, 42.5, 40);
    database
      .prepare(
        'INSERT INTO kosync_progress (id, user_id, document, progress, percentage, device, device_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1101, 3, QUIET_CHECKSUM, QUIET_CFI, 73.25, 'KOReader', 'fixture-device', '2025-03-03T10:00:00Z');
    runMany(database, 'INSERT INTO shelf (id, uuid, name, is_public, user_id, kobo_sync, created, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      [1201, 'maya-shelf', 'Maya Reading Order', 1, 1, 0, '2025-03-04T10:00:00Z', '2025-03-04T10:00:00Z'],
      [1202, 'lina-shelf', 'Lina Private Shelf', 0, 4, 0, '2025-03-05T10:00:00Z', '2025-03-05T10:00:00Z'],
    ]);
    runMany(database, 'INSERT INTO book_shelf_link (id, book_id, "order", shelf, date_added) VALUES (?, ?, ?, ?, ?)', [
      [1301, books.tides.id, 0, 1201, '2025-03-04T10:00:00Z'],
      [1302, books.cedar.id, 1, 1201, '2025-03-04T10:00:00Z'],
      [1303, books.lantern.id, 0, 1202, '2025-03-05T10:00:00Z'],
      [1304, books.cedar.id, 1, 1202, '2025-03-05T10:00:00Z'],
    ]);
    database.exec('COMMIT');
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  } finally {
    database.close();
  }
}

async function createSourceMedia(root: string, books: CalibreWebAutomatedSourceFixture['books']): Promise<void> {
  await Promise.all(
    Object.values(books).flatMap((book) =>
      book.files.map((file) =>
        createFormatFile(join(root, book.path, `${file.name}.${file.format.toLowerCase()}`), file.format.toLowerCase(), file.name),
      ),
    ),
  );
}

async function createTargetUser(
  ctx: MigrationCalibreWebAutomatedE2EContext,
  username: string,
  name: string,
  email: string,
): Promise<{ id: number; username: string }> {
  const [user] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name,
      email,
      passwordHash: await hash('MigrationCwa123', 4),
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id, username: schema.users.username });
  return user;
}

async function insertTargetBook(
  ctx: MigrationCalibreWebAutomatedE2EContext,
  input: {
    libraryId: number;
    libraryFolderId: number;
    folderName: string;
    files: Array<{ relativePath: string; format: string; durationSeconds?: number }>;
    metadata: Partial<typeof schema.bookMetadata.$inferInsert> & { title: string };
    author: string;
  },
): Promise<SeededTargetBook> {
  const folderPath = join(ctx.targetLibraryRoot, input.folderName);
  await mkdir(folderPath, { recursive: true });
  const [book] = await ctx.db
    .insert(schema.books)
    .values({ libraryId: input.libraryId, libraryFolderId: input.libraryFolderId, folderPath, status: 'present' })
    .returning({ id: schema.books.id });
  const fileIds: number[] = [];
  const absolutePaths: string[] = [];
  for (const [index, file] of input.files.entries()) {
    const absolutePath = join(ctx.targetLibraryRoot, file.relativePath);
    await createFormatFile(absolutePath, file.format, input.metadata.title);
    const fileStat = await stat(absolutePath);
    const [inserted] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId: book.id,
        libraryFolderId: input.libraryFolderId,
        absolutePath,
        relPath: relative(ctx.targetLibraryRoot, absolutePath),
        ino: BigInt(20_000 + book.id * 10 + index),
        sizeBytes: fileStat.size,
        mtime: new Date('2025-01-01T00:00:00Z'),
        fileHash: null,
        format: file.format,
        role: 'content',
        sortOrder: index,
        durationSeconds: file.durationSeconds ?? null,
      })
      .returning({ id: schema.bookFiles.id });
    fileIds.push(inserted.id);
    absolutePaths.push(absolutePath);
  }
  await ctx.db.update(schema.books).set({ primaryFileId: fileIds[0] }).where(eq(schema.books.id, book.id));
  await ctx.db.insert(schema.bookMetadata).values({ bookId: book.id, ...input.metadata });
  const authorId = await ensureAuthor(ctx, input.author);
  await ctx.db.insert(schema.bookAuthors).values({ bookId: book.id, authorId, displayOrder: 0 });
  return { bookId: book.id, fileIds, absolutePaths };
}

async function ensureAuthor(ctx: MigrationCalibreWebAutomatedE2EContext, name: string): Promise<number> {
  const existing = await ctx.db.query.authors.findFirst({ where: eq(schema.authors.name, name) });
  if (existing) return existing.id;
  const [author] = await ctx.db.insert(schema.authors).values({ name, sortName: name }).returning({ id: schema.authors.id });
  return author.id;
}

async function createFormatFile(path: string, format: string, title: string): Promise<void> {
  if (format === 'epub' || format === 'kepub') return createEpubFile(path, title);
  if (format === 'mp3') return createMp3File(path, title);
  if (format === 'cbz') return createCbzFile(path);
  throw new Error(`Unsupported CWA E2E fixture format: ${format}`);
}

async function createMp3File(path: string, title: string): Promise<void> {
  const ffmpeg = requireInstaller('@ffmpeg-installer/ffmpeg') as InstallerPackage;
  await mkdir(dirname(path), { recursive: true });
  await execFile(ffmpeg.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=8000:duration=2',
    '-ac',
    '1',
    '-b:a',
    '16k',
    '-metadata',
    `title=${title}`,
    '-y',
    path,
  ]);
}

async function createCbzFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(pixel, { name: '001.png' });
    archive.append(pixel, { name: '002.png' });
    void archive.finalize();
  });
}

function runMany(database: DatabaseSync, sql: string, rows: SQLInputValue[][]): void {
  const statement = database.prepare(sql);
  for (const row of rows) statement.run(...row);
}

function rollbackQuietly(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK');
  } catch {
    // The original database error is more useful than a rollback failure.
  }
}
