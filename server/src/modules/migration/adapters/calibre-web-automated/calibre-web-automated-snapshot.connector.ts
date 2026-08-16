import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { chmod, lstat, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrationConfig } from '../../../../config/config';
import type { CalibreWebAutomatedConnectionConfig } from './calibre-web-automated-connection-config';
import type {
  CalibreWebAutomatedAuthorLinkRecord,
  CalibreWebAutomatedBookRecord,
  CalibreWebAutomatedCapabilities,
  CalibreWebAutomatedChecksumRecord,
  CalibreWebAutomatedCommentRecord,
  CalibreWebAutomatedConnectorWarning,
  CalibreWebAutomatedFileRecord,
  CalibreWebAutomatedIdentifierRecord,
  CalibreWebAutomatedKoboBookmarkRecord,
  CalibreWebAutomatedKoboReadingStateRecord,
  CalibreWebAutomatedKoreaderProgressRecord,
  CalibreWebAutomatedLanguageLinkRecord,
  CalibreWebAutomatedNamedLinkRecord,
  CalibreWebAutomatedRatingLinkRecord,
  CalibreWebAutomatedSeriesLinkRecord,
  CalibreWebAutomatedSettingsRecord,
  CalibreWebAutomatedShelfBookRecord,
  CalibreWebAutomatedShelfRecord,
  CalibreWebAutomatedSourceRecords,
  CalibreWebAutomatedStatusRecord,
  CalibreWebAutomatedUserRecord,
  CalibreWebAutomatedWebProgressRecord,
} from './calibre-web-automated-source.types';

type SqlRow = Record<string, unknown>;

export interface AuthorizedCalibreWebAutomatedSnapshotFile {
  handle: FileHandle;
  size: number;
  mtimeMs: number;
  dev: number | bigint;
  ino: number | bigint;
  requestedPath: string;
  canonicalRoot: string;
}

const MAX_DATABASE_BYTES = 8 * 1024 * 1024 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;
const CORE_PAGE_SIZE = 500;
const RELATION_PAGE_SIZE = 1_000;
const MAX_ROWS_PER_QUERY = 1_000_000;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_LONG_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_WARNING_CATEGORIES = 100;

const APP_REQUIRED_SCHEMA = {
  user: ['id', 'name', 'email', 'role'],
} as const;

const APP_OPTIONAL_SCHEMA = {
  settings: ['id', 'config_calibre_dir'],
  book_read_link: ['id', 'book_id', 'user_id', 'read_status', 'last_modified', 'last_time_started_reading'],
  bookmark: ['id', 'user_id', 'book_id', 'format', 'bookmark_key'],
  kobo_reading_state: ['id', 'user_id', 'book_id', 'last_modified', 'priority_timestamp'],
  kobo_bookmark: [
    'id',
    'kobo_reading_state_id',
    'last_modified',
    'location_source',
    'location_type',
    'location_value',
    'progress_percent',
    'content_source_progress_percent',
  ],
  kosync_progress: ['id', 'user_id', 'document', 'progress', 'percentage', 'timestamp'],
  shelf: ['id', 'name', 'is_public', 'user_id'],
  book_shelf_link: ['id', 'book_id', 'order', 'shelf'],
} as const;

const METADATA_REQUIRED_SCHEMA = {
  books: ['id', 'title', 'pubdate', 'series_index', 'author_sort', 'path'],
  data: ['id', 'book', 'format', 'name'],
} as const;

const METADATA_OPTIONAL_SCHEMA = {
  books_authors_link: ['id', 'book', 'author'],
  authors: ['id', 'name', 'sort'],
  books_publishers_link: ['id', 'book', 'publisher'],
  publishers: ['id', 'name'],
  books_languages_link: ['id', 'book', 'lang_code', 'item_order'],
  languages: ['id', 'lang_code'],
  books_series_link: ['id', 'book', 'series'],
  series: ['id', 'name', 'sort'],
  books_ratings_link: ['id', 'book', 'rating'],
  ratings: ['id', 'rating'],
  comments: ['id', 'book', 'text'],
  books_tags_link: ['id', 'book', 'tag'],
  tags: ['id', 'name'],
  identifiers: ['id', 'book', 'type', 'val'],
  book_format_checksums: ['id', 'book', 'format', 'checksum', 'version', 'created'],
} as const;

const TABLE_INFO_SQL: Record<string, string> = Object.fromEntries(
  [
    ...Object.keys(APP_REQUIRED_SCHEMA),
    ...Object.keys(APP_OPTIONAL_SCHEMA),
    ...Object.keys(METADATA_REQUIRED_SCHEMA),
    ...Object.keys(METADATA_OPTIONAL_SCHEMA),
  ].map((table) => [table, `PRAGMA table_info("${table}")`]),
);

const USER_SQL = 'SELECT id, name, email, role FROM "user" WHERE id > ? ORDER BY id LIMIT ?';
const BOOK_SQL =
  'SELECT id, title, pubdate, series_index AS seriesIndex, author_sort AS authorSort, path FROM books WHERE id > ? ORDER BY id LIMIT ?';
const FILE_SQL = 'SELECT id, book AS bookId, format, name FROM data WHERE id > ? ORDER BY id LIMIT ?';
const AUTHOR_LINK_SQL =
  'SELECT books_authors_link.id, books_authors_link.book AS bookId, authors.id AS authorId, authors.name, authors.sort FROM books_authors_link INNER JOIN authors ON authors.id = books_authors_link.author WHERE books_authors_link.id > ? ORDER BY books_authors_link.id LIMIT ?';
const PUBLISHER_LINK_SQL =
  'SELECT books_publishers_link.id, books_publishers_link.book AS bookId, publishers.id AS valueId, publishers.name AS value FROM books_publishers_link INNER JOIN publishers ON publishers.id = books_publishers_link.publisher WHERE books_publishers_link.id > ? ORDER BY books_publishers_link.id LIMIT ?';
const LANGUAGE_LINK_SQL =
  'SELECT books_languages_link.id, books_languages_link.book AS bookId, languages.id AS valueId, languages.lang_code AS value, books_languages_link.item_order AS itemOrder FROM books_languages_link INNER JOIN languages ON languages.id = books_languages_link.lang_code WHERE books_languages_link.id > ? ORDER BY books_languages_link.id LIMIT ?';
const SERIES_LINK_SQL =
  'SELECT books_series_link.id, books_series_link.book AS bookId, series.id AS valueId, series.name AS value, series.sort FROM books_series_link INNER JOIN series ON series.id = books_series_link.series WHERE books_series_link.id > ? ORDER BY books_series_link.id LIMIT ?';
const RATING_LINK_SQL =
  'SELECT books_ratings_link.id, books_ratings_link.book AS bookId, ratings.id AS ratingId, ratings.rating FROM books_ratings_link INNER JOIN ratings ON ratings.id = books_ratings_link.rating WHERE books_ratings_link.id > ? ORDER BY books_ratings_link.id LIMIT ?';
const COMMENT_SQL = 'SELECT id, book AS bookId, text FROM comments WHERE id > ? ORDER BY id LIMIT ?';
const TAG_LINK_SQL =
  'SELECT books_tags_link.id, books_tags_link.book AS bookId, tags.id AS valueId, tags.name AS value FROM books_tags_link INNER JOIN tags ON tags.id = books_tags_link.tag WHERE books_tags_link.id > ? ORDER BY books_tags_link.id LIMIT ?';
const IDENTIFIER_SQL = 'SELECT id, book AS bookId, type, val AS value FROM identifiers WHERE id > ? ORDER BY id LIMIT ?';
const STATUS_SQL =
  'SELECT id, book_id AS bookId, user_id AS userId, read_status AS readStatus, last_modified AS lastModified, last_time_started_reading AS lastTimeStartedReading FROM book_read_link WHERE id > ? ORDER BY id LIMIT ?';
const WEB_PROGRESS_SQL =
  'SELECT id, user_id AS userId, book_id AS bookId, format, bookmark_key AS bookmarkKey FROM bookmark WHERE id > ? ORDER BY id LIMIT ?';
const KOBO_STATE_SQL =
  'SELECT id, user_id AS userId, book_id AS bookId, last_modified AS lastModified, priority_timestamp AS priorityTimestamp FROM kobo_reading_state WHERE id > ? ORDER BY id LIMIT ?';
const KOBO_BOOKMARK_SQL =
  'SELECT id, kobo_reading_state_id AS readingStateId, last_modified AS lastModified, location_source AS locationSource, location_type AS locationType, location_value AS locationValue, progress_percent AS progressPercent, content_source_progress_percent AS contentSourceProgressPercent FROM kobo_bookmark WHERE id > ? ORDER BY id LIMIT ?';
const KOREADER_PROGRESS_SQL =
  'SELECT id, user_id AS userId, document, progress, percentage, timestamp FROM kosync_progress WHERE id > ? ORDER BY id LIMIT ?';
const CHECKSUM_SQL = 'SELECT id, book AS bookId, format, checksum, version, created FROM book_format_checksums WHERE id > ? ORDER BY id LIMIT ?';
const SHELF_SQL = 'SELECT id, name, is_public AS isPublic, user_id AS userId FROM shelf WHERE id > ? ORDER BY id LIMIT ?';
const SHELF_BOOK_SQL = 'SELECT id, book_id AS bookId, shelf AS shelfId, "order" AS position FROM book_shelf_link WHERE id > ? ORDER BY id LIMIT ?';

@Injectable()
export class CalibreWebAutomatedSnapshotConnector {
  constructor(@Inject(migrationConfig.KEY) private readonly config: ConfigType<typeof migrationConfig>) {}

  async fetchSourceRecords(config: CalibreWebAutomatedConnectionConfig): Promise<CalibreWebAutomatedSourceRecords> {
    let appFile: AuthorizedCalibreWebAutomatedSnapshotFile | null = null;
    let metadataFile: AuthorizedCalibreWebAutomatedSnapshotFile | null = null;
    let temporaryDirectory: string | null = null;
    let appDatabase: DatabaseSync | null = null;
    let metadataDatabase: DatabaseSync | null = null;

    try {
      appFile = await authorizeCalibreWebAutomatedSnapshotFile(this.config.importRoot, config.appDatabasePath);
      metadataFile = await authorizeCalibreWebAutomatedSnapshotFile(this.config.importRoot, config.metadataDatabasePath);
      if (sameFile(appFile, metadataFile)) {
        throw new BadRequestException('Calibre-Web Automated snapshot paths must identify different database files');
      }

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'bookorbit-cwa-migration-'));
      await chmod(temporaryDirectory, 0o700);
      const appCopyPath = join(temporaryDirectory, 'app.db');
      const metadataCopyPath = join(temporaryDirectory, 'metadata.db');
      await copyAuthorizedCalibreWebAutomatedSnapshotFile(appFile, appCopyPath);
      await copyAuthorizedCalibreWebAutomatedSnapshotFile(metadataFile, metadataCopyPath);
      await assertNoActiveSidecars(appFile);
      await assertNoActiveSidecars(metadataFile);

      appDatabase = openDefensiveDatabase(appCopyPath);
      metadataDatabase = openDefensiveDatabase(metadataCopyPath);
      verifyIntegrity(appDatabase);
      verifyIntegrity(metadataDatabase);
      return readSourceRecords(appDatabase, metadataDatabase);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The Calibre-Web Automated snapshot could not be read safely');
    } finally {
      closeDatabaseQuietly(appDatabase);
      closeDatabaseQuietly(metadataDatabase);
      await appFile?.handle.close().catch(() => undefined);
      await metadataFile?.handle.close().catch(() => undefined);
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function authorizeCalibreWebAutomatedSnapshotFile(
  importRoot: string | undefined,
  requestedPath: string,
): Promise<AuthorizedCalibreWebAutomatedSnapshotFile> {
  if (!importRoot) throw new BadRequestException('Calibre-Web Automated snapshot migration is not configured on this server');
  if (!isAbsolute(requestedPath)) throw new BadRequestException('Calibre-Web Automated snapshot paths must be absolute');

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(importRoot);
    if (!(await stat(canonicalRoot)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new BadRequestException('Calibre-Web Automated migration import root could not be resolved');
  }

  let handle: FileHandle | null = null;
  try {
    handle = await open(requestedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile()) throw new BadRequestException('Calibre-Web Automated snapshot path must identify a regular file');

    const resolvedPath = await resolveOpenedFilePath(handle, requestedPath);
    requireContained(canonicalRoot, resolvedPath);
    const resolved = await stat(resolvedPath);
    if (!sameFile(opened, resolved)) throw new BadRequestException('Calibre-Web Automated snapshot file changed while it was being opened');

    const authorized = {
      handle,
      size: opened.size,
      mtimeMs: opened.mtimeMs,
      dev: opened.dev,
      ino: opened.ino,
      requestedPath,
      canonicalRoot,
    };
    await assertNoActiveSidecars(authorized);
    handle = null;
    return authorized;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Calibre-Web Automated snapshot file could not be opened safely');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function copyAuthorizedCalibreWebAutomatedSnapshotFile(
  authorized: AuthorizedCalibreWebAutomatedSnapshotFile,
  outputPath: string,
  maximumBytes = MAX_DATABASE_BYTES,
): Promise<void> {
  const output = await open(outputPath, 'wx', 0o600);
  let offset = 0;
  try {
    while (true) {
      const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
      const { bytesRead } = await authorized.handle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      if (offset + bytesRead > maximumBytes) {
        throw new BadRequestException('Calibre-Web Automated snapshot database exceeds the allowed size');
      }
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, offset + written);
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }

    const afterCopy = await authorized.handle.stat();
    if (!sameFile(authorized, afterCopy) || afterCopy.size !== offset || afterCopy.mtimeMs !== authorized.mtimeMs) {
      throw new BadRequestException('Calibre-Web Automated snapshot file changed while it was being copied');
    }
    await output.sync();
    await chmod(outputPath, 0o600);
  } finally {
    await output.close();
  }
}

async function resolveOpenedFilePath(handle: FileHandle, requestedPath: string): Promise<string> {
  if (process.platform === 'linux') {
    try {
      return await realpath(`/proc/self/fd/${handle.fd}`);
    } catch {
      // Fall through to the inode-checked path resolution used on platforms without procfs.
    }
  }
  return realpath(requestedPath);
}

async function assertNoActiveSidecars(authorized: AuthorizedCalibreWebAutomatedSnapshotFile): Promise<void> {
  for (const suffix of ['-journal', '-wal']) {
    const sidecarPath = `${authorized.requestedPath}${suffix}`;
    let sidecarStat;
    try {
      sidecarStat = await lstat(sidecarPath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw new BadRequestException('Calibre-Web Automated snapshot sidecar could not be inspected safely');
    }
    if (sidecarStat.isSymbolicLink()) {
      throw new BadRequestException('Calibre-Web Automated snapshot has an unsafe SQLite sidecar');
    }

    let sidecar: FileHandle | null = null;
    try {
      sidecar = await open(sidecarPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await sidecar.stat();
      if (!opened.isFile()) throw new BadRequestException('Calibre-Web Automated snapshot has an unsafe SQLite sidecar');
      const resolvedPath = await resolveOpenedFilePath(sidecar, sidecarPath);
      requireContained(authorized.canonicalRoot, resolvedPath);
      if (!sameFile(opened, await stat(resolvedPath))) {
        throw new BadRequestException('Calibre-Web Automated snapshot sidecar changed while it was being inspected');
      }
      if (opened.size > 0) {
        throw new BadRequestException('Calibre-Web Automated snapshot contains an active SQLite journal or WAL sidecar');
      }
    } finally {
      await sidecar?.close().catch(() => undefined);
    }
  }
}

function openDefensiveDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path, {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
  });
  database.enableLoadExtension(false);
  const enableDefensive = (database as unknown as { enableDefensive?: (active: boolean) => void }).enableDefensive;
  if (enableDefensive) enableDefensive.call(database, true);
  database.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF');
  return database;
}

function verifyIntegrity(database: DatabaseSync): void {
  try {
    const rows = database.prepare('PRAGMA quick_check(1)').all() as SqlRow[];
    if (rows.length === 1 && rows[0].quick_check === 'ok') return;
  } catch {
    throw new BadRequestException('Calibre-Web Automated snapshot database failed its integrity check');
  }
  throw new BadRequestException('Calibre-Web Automated snapshot database failed its integrity check');
}

function readSourceRecords(appDatabase: DatabaseSync, metadataDatabase: DatabaseSync): CalibreWebAutomatedSourceRecords {
  const warnings = new WarningCollector();
  const compatibilityWarnings = ['Schema compatibility was verified against Calibre-Web Automated v4.0.6'];
  const appTables = getAvailableTables(appDatabase);
  const metadataTables = getAvailableTables(metadataDatabase);
  if (!appTables.has('user') && appTables.has('books') && metadataTables.has('user')) {
    throw new BadRequestException('Calibre-Web Automated app.db and metadata.db snapshot paths appear to be reversed');
  }
  verifyRequiredSchema(appDatabase, appTables, APP_REQUIRED_SCHEMA, 'app.db');
  verifyRequiredSchema(metadataDatabase, metadataTables, METADATA_REQUIRED_SCHEMA, 'metadata.db');

  const userColumns = getColumns(appDatabase, 'user');
  if (!['magic_shelf', 'kosync_progress', 'kobo_annotation_sync'].some((table) => appTables.has(table)) && !userColumns.has('hardcover_token')) {
    compatibilityWarnings.push('No Calibre-Web Automated schema signatures were found; the snapshot may come from stock Calibre-Web');
  }

  const capabilities: CalibreWebAutomatedCapabilities = {
    settings: verifyOptionalSchema(appDatabase, appTables, ['settings'], APP_OPTIONAL_SCHEMA, compatibilityWarnings, 'settings'),
    authors: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['books_authors_link', 'authors'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'authors',
    ),
    publishers: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['books_publishers_link', 'publishers'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'publishers',
    ),
    languages: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['books_languages_link', 'languages'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'languages',
    ),
    series: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['books_series_link', 'series'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'series',
    ),
    ratings: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['books_ratings_link', 'ratings'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'ratings',
    ),
    comments: verifyOptionalSchema(metadataDatabase, metadataTables, ['comments'], METADATA_OPTIONAL_SCHEMA, compatibilityWarnings, 'comments'),
    tags: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['books_tags_link', 'tags'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'tags',
    ),
    identifiers: verifyOptionalSchema(
      metadataDatabase,
      metadataTables,
      ['identifiers'],
      METADATA_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'identifiers',
    ),
    userBookStatuses: verifyOptionalSchema(appDatabase, appTables, ['book_read_link'], APP_OPTIONAL_SCHEMA, compatibilityWarnings, 'read status'),
    webProgress: verifyOptionalSchema(appDatabase, appTables, ['bookmark'], APP_OPTIONAL_SCHEMA, compatibilityWarnings, 'web progress'),
    koboProgress: verifyOptionalSchema(
      appDatabase,
      appTables,
      ['kobo_reading_state', 'kobo_bookmark'],
      APP_OPTIONAL_SCHEMA,
      compatibilityWarnings,
      'Kobo progress',
    ),
    koreaderProgress:
      verifyOptionalSchema(appDatabase, appTables, ['kosync_progress'], APP_OPTIONAL_SCHEMA, compatibilityWarnings, 'KOReader progress') &&
      verifyOptionalSchema(
        metadataDatabase,
        metadataTables,
        ['book_format_checksums'],
        METADATA_OPTIONAL_SCHEMA,
        compatibilityWarnings,
        'KOReader checksum index',
      ),
    shelves: verifyOptionalSchema(appDatabase, appTables, ['shelf', 'book_shelf_link'], APP_OPTIONAL_SCHEMA, compatibilityWarnings, 'shelves'),
  };

  const users = readMapped(appDatabase, USER_SQL, CORE_PAGE_SIZE, (row) => mapUser(row, warnings));
  const userIds = new Set(users.map((row) => row.id));
  const books = readMapped(metadataDatabase, BOOK_SQL, CORE_PAGE_SIZE, (row) => mapBook(row, warnings));
  const bookIds = new Set(books.map((row) => row.id));
  const files = readMapped(metadataDatabase, FILE_SQL, CORE_PAGE_SIZE, (row) => mapFile(row, bookIds, warnings));

  const settings = capabilities.settings ? readSettings(appDatabase, getColumns(appDatabase, 'settings'), warnings) : [];
  const authorLinks = capabilities.authors
    ? readMapped(metadataDatabase, AUTHOR_LINK_SQL, RELATION_PAGE_SIZE, (row) => mapAuthorLink(row, bookIds, warnings))
    : [];
  const publisherLinks = capabilities.publishers
    ? readMapped(metadataDatabase, PUBLISHER_LINK_SQL, RELATION_PAGE_SIZE, (row) => mapNamedLink(row, bookIds, warnings, 'publisher'))
    : [];
  const languageLinks = capabilities.languages
    ? readMapped(metadataDatabase, LANGUAGE_LINK_SQL, RELATION_PAGE_SIZE, (row) => mapLanguageLink(row, bookIds, warnings))
    : [];
  const seriesLinks = capabilities.series
    ? readMapped(metadataDatabase, SERIES_LINK_SQL, RELATION_PAGE_SIZE, (row) => mapSeriesLink(row, bookIds, warnings))
    : [];
  const ratingLinks = capabilities.ratings
    ? readMapped(metadataDatabase, RATING_LINK_SQL, RELATION_PAGE_SIZE, (row) => mapRatingLink(row, bookIds, warnings))
    : [];
  const comments = capabilities.comments
    ? readMapped(metadataDatabase, COMMENT_SQL, RELATION_PAGE_SIZE, (row) => mapComment(row, bookIds, warnings))
    : [];
  const tagLinks = capabilities.tags
    ? readMapped(metadataDatabase, TAG_LINK_SQL, RELATION_PAGE_SIZE, (row) => mapNamedLink(row, bookIds, warnings, 'tag'))
    : [];
  const identifiers = capabilities.identifiers
    ? readMapped(metadataDatabase, IDENTIFIER_SQL, RELATION_PAGE_SIZE, (row) => mapIdentifier(row, bookIds, warnings))
    : [];
  const statuses = capabilities.userBookStatuses
    ? readMapped(appDatabase, STATUS_SQL, CORE_PAGE_SIZE, (row) => mapStatus(row, userIds, bookIds, warnings))
    : [];
  const webProgress = capabilities.webProgress
    ? readMapped(appDatabase, WEB_PROGRESS_SQL, CORE_PAGE_SIZE, (row) => mapWebProgress(row, userIds, bookIds, warnings))
    : [];
  const koboReadingStates = capabilities.koboProgress
    ? readMapped(appDatabase, KOBO_STATE_SQL, CORE_PAGE_SIZE, (row) => mapKoboState(row, userIds, bookIds, warnings))
    : [];
  const koboStateIds = new Set(koboReadingStates.map((row) => row.id));
  const koboBookmarks = capabilities.koboProgress
    ? readMapped(appDatabase, KOBO_BOOKMARK_SQL, CORE_PAGE_SIZE, (row) => mapKoboBookmark(row, koboStateIds, warnings))
    : [];
  const koreaderProgress = capabilities.koreaderProgress
    ? readMapped(appDatabase, KOREADER_PROGRESS_SQL, CORE_PAGE_SIZE, (row) => mapKoreaderProgress(row, userIds, warnings))
    : [];
  const checksums = capabilities.koreaderProgress
    ? readMapped(metadataDatabase, CHECKSUM_SQL, RELATION_PAGE_SIZE, (row) => mapChecksum(row, bookIds, warnings))
    : [];
  const shelves = capabilities.shelves ? readMapped(appDatabase, SHELF_SQL, CORE_PAGE_SIZE, (row) => mapShelf(row, userIds, warnings)) : [];
  const shelfIds = new Set(shelves.map((row) => row.id));
  const shelfBooks = capabilities.shelves
    ? readMapped(appDatabase, SHELF_BOOK_SQL, CORE_PAGE_SIZE, (row) => mapShelfBook(row, shelfIds, bookIds, warnings))
    : [];

  return {
    sourceVersion: null,
    compatibilityWarnings,
    warnings: warnings.values(),
    capabilities,
    settings,
    users,
    books,
    files,
    authorLinks,
    publisherLinks,
    languageLinks,
    seriesLinks,
    ratingLinks,
    comments,
    tagLinks,
    identifiers,
    statuses,
    webProgress,
    koboReadingStates,
    koboBookmarks,
    koreaderProgress,
    checksums,
    shelves,
    shelfBooks,
  };
}

function getAvailableTables(database: DatabaseSync): Set<string> {
  const rows = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as SqlRow[];
  return new Set(rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : [])));
}

function getColumns(database: DatabaseSync, table: string): Set<string> {
  const statement = TABLE_INFO_SQL[table];
  if (!statement) throw new BadRequestException('Calibre-Web Automated snapshot schema inspection failed');
  const rows = database.prepare(statement).all() as SqlRow[];
  return new Set(rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : [])));
}

function verifyRequiredSchema(database: DatabaseSync, tables: Set<string>, schema: Record<string, readonly string[]>, label: string): void {
  const missingTables = Object.keys(schema).filter((table) => !tables.has(table));
  if (missingTables.length > 0) {
    throw new BadRequestException(`Calibre-Web Automated ${label} snapshot is missing required tables: ${missingTables.join(', ')}`);
  }
  for (const [table, columns] of Object.entries(schema)) {
    const missingColumns = columns.filter((column) => !getColumns(database, table).has(column));
    if (missingColumns.length > 0) {
      throw new BadRequestException(`Calibre-Web Automated ${label} table ${table} is missing required columns: ${missingColumns.join(', ')}`);
    }
  }
}

function verifyOptionalSchema<T extends Record<string, readonly string[]>>(
  database: DatabaseSync,
  availableTables: Set<string>,
  tables: Array<keyof T & string>,
  schema: T,
  warnings: string[],
  label: string,
): boolean {
  for (const table of tables) {
    if (!availableTables.has(table)) {
      warnings.push(`Compatible ${label} data is unavailable because table ${table} is missing`);
      return false;
    }
    const missingColumns = schema[table].filter((column) => !getColumns(database, table).has(column));
    if (missingColumns.length > 0) {
      warnings.push(`Compatible ${label} data is unavailable because table ${table} is missing required columns`);
      return false;
    }
  }
  return true;
}

function readMapped<T>(database: DatabaseSync, query: string, pageSize: number, map: (row: SqlRow) => T | null): T[] {
  const statement = database.prepare(query);
  const results: T[] = [];
  let lastId = -1;
  let processed = 0;
  while (processed < MAX_ROWS_PER_QUERY) {
    const rows = statement.all(lastId, pageSize) as SqlRow[];
    if (rows.length === 0) return results;
    for (const row of rows) {
      const rowId = positiveInteger(row.id);
      if (rowId == null || rowId <= lastId) {
        throw new BadRequestException('Calibre-Web Automated snapshot contains an invalid pagination key');
      }
      lastId = rowId;
      processed += 1;
      const mapped = map(row);
      if (mapped) results.push(mapped);
    }
    if (rows.length < pageSize) return results;
  }
  throw new BadRequestException('Calibre-Web Automated snapshot table exceeds the migration row limit');
}

function readSettings(database: DatabaseSync, columns: Set<string>, warnings: WarningCollector): CalibreWebAutomatedSettingsRecord[] {
  const splitSql = columns.has('config_calibre_split') ? 'config_calibre_split' : '0';
  const splitDirectorySql = columns.has('config_calibre_split_dir') ? 'config_calibre_split_dir' : 'NULL';
  const rows = database
    .prepare(
      `SELECT id, config_calibre_dir AS calibreDirectory, ${splitSql} AS splitLibrary, ${splitDirectorySql} AS splitDirectory FROM settings ORDER BY id LIMIT 2`,
    )
    .all() as SqlRow[];
  if (rows.length > 1) warnings.add('multiple_settings_rows');
  return rows.flatMap((row) => {
    const id = positiveInteger(row.id);
    if (id == null) {
      warnings.add('invalid_settings_row');
      return [];
    }
    return [
      {
        id,
        calibreDirectory: nullableText(row.calibreDirectory, MAX_TEXT_BYTES, warnings, 'invalid_settings_path'),
        splitLibrary: sqliteBoolean(row.splitLibrary),
        splitDirectory: nullableText(row.splitDirectory, MAX_TEXT_BYTES, warnings, 'invalid_settings_path'),
      },
    ];
  });
}

function mapUser(row: SqlRow, warnings: WarningCollector): CalibreWebAutomatedUserRecord | null {
  const id = positiveInteger(row.id);
  const name = requiredText(row.name, MAX_TEXT_BYTES, warnings, 'invalid_user');
  const role = integer(row.role);
  if (id == null || !name || role == null) {
    warnings.add('invalid_user');
    return null;
  }
  return { id, name, email: nullableText(row.email, MAX_TEXT_BYTES, warnings, 'invalid_user_email'), role };
}

function mapBook(row: SqlRow, warnings: WarningCollector): CalibreWebAutomatedBookRecord | null {
  const id = positiveInteger(row.id);
  const title = requiredText(row.title, MAX_TEXT_BYTES, warnings, 'invalid_book');
  const path = boundedText(row.path, MAX_TEXT_BYTES);
  const seriesIndex = finiteNumber(row.seriesIndex);
  if (id == null || !title || path == null || seriesIndex == null) {
    warnings.add('invalid_book');
    return null;
  }
  return {
    id,
    title,
    pubdate: nullableDate(row.pubdate, warnings, 'invalid_book_date'),
    seriesIndex,
    authorSort: nullableText(row.authorSort, MAX_TEXT_BYTES, warnings, 'invalid_author_sort'),
    path,
  };
}

function mapFile(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedFileRecord | null {
  const id = positiveInteger(row.id);
  const bookId = positiveInteger(row.bookId);
  const format = requiredText(row.format, MAX_TEXT_BYTES, warnings, 'invalid_file');
  const name = requiredText(row.name, MAX_TEXT_BYTES, warnings, 'invalid_file');
  if (id == null || bookId == null || !format || !name) {
    warnings.add('invalid_file');
    return null;
  }
  if (!bookIds.has(bookId)) {
    warnings.add('orphaned_file');
    return null;
  }
  return { id, bookId, format, name };
}

function mapAuthorLink(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedAuthorLinkRecord | null {
  const base = mapLinkBase(row, bookIds, warnings, 'author');
  const name = requiredText(row.name, MAX_TEXT_BYTES, warnings, 'invalid_author_link');
  if (!base || !name) return null;
  return {
    id: base.id,
    bookId: base.bookId,
    authorId: base.valueId,
    name,
    sort: nullableText(row.sort, MAX_TEXT_BYTES, warnings, 'invalid_author_sort'),
  };
}

function mapNamedLink(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector, category: string): CalibreWebAutomatedNamedLinkRecord | null {
  const base = mapLinkBase(row, bookIds, warnings, category);
  const value = requiredText(row.value, MAX_TEXT_BYTES, warnings, `invalid_${category}_link`);
  return base && value ? { ...base, value } : null;
}

function mapLanguageLink(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedLanguageLinkRecord | null {
  const base = mapNamedLink(row, bookIds, warnings, 'language');
  const itemOrder = integer(row.itemOrder);
  if (!base || itemOrder == null) {
    warnings.add('invalid_language_link');
    return null;
  }
  return { ...base, itemOrder };
}

function mapSeriesLink(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedSeriesLinkRecord | null {
  const base = mapNamedLink(row, bookIds, warnings, 'series');
  return base ? { ...base, sort: nullableText(row.sort, MAX_TEXT_BYTES, warnings, 'invalid_series_sort') } : null;
}

function mapRatingLink(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedRatingLinkRecord | null {
  const id = positiveInteger(row.id);
  const bookId = positiveInteger(row.bookId);
  const ratingId = positiveInteger(row.ratingId);
  const rating = integer(row.rating);
  if (id == null || bookId == null || ratingId == null || rating == null) {
    warnings.add('invalid_rating_link');
    return null;
  }
  if (!bookIds.has(bookId)) {
    warnings.add('orphaned_rating_link');
    return null;
  }
  return { id, bookId, ratingId, rating };
}

function mapComment(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedCommentRecord | null {
  const id = positiveInteger(row.id);
  const bookId = positiveInteger(row.bookId);
  const text = boundedText(row.text, MAX_LONG_TEXT_BYTES);
  if (id == null || bookId == null || text == null) {
    warnings.add('invalid_comment');
    return null;
  }
  if (!bookIds.has(bookId)) {
    warnings.add('orphaned_comment');
    return null;
  }
  return { id, bookId, text };
}

function mapIdentifier(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedIdentifierRecord | null {
  const id = positiveInteger(row.id);
  const bookId = positiveInteger(row.bookId);
  const type = requiredText(row.type, MAX_TEXT_BYTES, warnings, 'invalid_identifier');
  const value = requiredText(row.value, MAX_TEXT_BYTES, warnings, 'invalid_identifier');
  if (id == null || bookId == null || !type || !value) return null;
  if (!bookIds.has(bookId)) {
    warnings.add('orphaned_identifier');
    return null;
  }
  return { id, bookId, type, value };
}

function mapStatus(row: SqlRow, userIds: Set<number>, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedStatusRecord | null {
  const id = positiveInteger(row.id);
  const userId = positiveInteger(row.userId);
  const bookId = positiveInteger(row.bookId);
  const readStatus = integer(row.readStatus);
  if (id == null || userId == null || bookId == null || readStatus == null) {
    warnings.add('invalid_status');
    return null;
  }
  if (!userIds.has(userId) || !bookIds.has(bookId)) {
    warnings.add('orphaned_status');
    return null;
  }
  return {
    id,
    userId,
    bookId,
    readStatus,
    lastModified: nullableDate(row.lastModified, warnings, 'invalid_status_date'),
    lastTimeStartedReading: nullableDate(row.lastTimeStartedReading, warnings, 'invalid_status_date'),
  };
}

function mapWebProgress(
  row: SqlRow,
  userIds: Set<number>,
  bookIds: Set<number>,
  warnings: WarningCollector,
): CalibreWebAutomatedWebProgressRecord | null {
  const id = positiveInteger(row.id);
  const userId = positiveInteger(row.userId);
  const bookId = positiveInteger(row.bookId);
  const format = requiredText(row.format, MAX_TEXT_BYTES, warnings, 'invalid_web_progress');
  const bookmarkKey = requiredText(row.bookmarkKey, MAX_TEXT_BYTES, warnings, 'invalid_web_progress');
  if (id == null || userId == null || bookId == null || !format || !bookmarkKey) return null;
  if (!userIds.has(userId) || !bookIds.has(bookId)) {
    warnings.add('orphaned_web_progress');
    return null;
  }
  return { id, userId, bookId, format, bookmarkKey };
}

function mapKoboState(
  row: SqlRow,
  userIds: Set<number>,
  bookIds: Set<number>,
  warnings: WarningCollector,
): CalibreWebAutomatedKoboReadingStateRecord | null {
  const id = positiveInteger(row.id);
  const userId = positiveInteger(row.userId);
  const bookId = positiveInteger(row.bookId);
  if (id == null || userId == null || bookId == null) {
    warnings.add('invalid_kobo_state');
    return null;
  }
  if (!userIds.has(userId) || !bookIds.has(bookId)) {
    warnings.add('orphaned_kobo_state');
    return null;
  }
  return {
    id,
    userId,
    bookId,
    lastModified: nullableDate(row.lastModified, warnings, 'invalid_kobo_date'),
    priorityTimestamp: nullableDate(row.priorityTimestamp, warnings, 'invalid_kobo_date'),
  };
}

function mapKoboBookmark(row: SqlRow, stateIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedKoboBookmarkRecord | null {
  const id = positiveInteger(row.id);
  const readingStateId = positiveInteger(row.readingStateId);
  if (id == null || readingStateId == null) {
    warnings.add('invalid_kobo_bookmark');
    return null;
  }
  if (!stateIds.has(readingStateId)) {
    warnings.add('orphaned_kobo_bookmark');
    return null;
  }
  return {
    id,
    readingStateId,
    lastModified: nullableDate(row.lastModified, warnings, 'invalid_kobo_date'),
    locationSource: nullableText(row.locationSource, MAX_TEXT_BYTES, warnings, 'invalid_kobo_location'),
    locationType: nullableText(row.locationType, MAX_TEXT_BYTES, warnings, 'invalid_kobo_location'),
    locationValue: nullableText(row.locationValue, MAX_TEXT_BYTES, warnings, 'invalid_kobo_location'),
    progressPercent: nullableFiniteNumber(row.progressPercent, warnings, 'invalid_kobo_percentage'),
    contentSourceProgressPercent: nullableFiniteNumber(row.contentSourceProgressPercent, warnings, 'invalid_kobo_percentage'),
  };
}

function mapKoreaderProgress(row: SqlRow, userIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedKoreaderProgressRecord | null {
  const id = positiveInteger(row.id);
  const userId = positiveInteger(row.userId);
  const document = requiredText(row.document, MAX_TEXT_BYTES, warnings, 'invalid_koreader_progress');
  const progress = requiredText(row.progress, MAX_TEXT_BYTES, warnings, 'invalid_koreader_progress');
  const percentage = finiteNumber(row.percentage);
  if (id == null || userId == null || !document || !progress || percentage == null) {
    warnings.add('invalid_koreader_progress');
    return null;
  }
  if (!userIds.has(userId)) {
    warnings.add('orphaned_koreader_progress');
    return null;
  }
  return { id, userId, document, progress, percentage, timestamp: nullableDate(row.timestamp, warnings, 'invalid_koreader_date') };
}

function mapChecksum(row: SqlRow, bookIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedChecksumRecord | null {
  const id = positiveInteger(row.id);
  const bookId = positiveInteger(row.bookId);
  const format = requiredText(row.format, MAX_TEXT_BYTES, warnings, 'invalid_checksum');
  const checksum = requiredText(row.checksum, MAX_TEXT_BYTES, warnings, 'invalid_checksum');
  const version = requiredText(row.version, MAX_TEXT_BYTES, warnings, 'invalid_checksum');
  if (id == null || bookId == null || !format || !checksum || !version) return null;
  if (!bookIds.has(bookId)) {
    warnings.add('orphaned_checksum');
    return null;
  }
  return { id, bookId, format, checksum, version, created: nullableDate(row.created, warnings, 'invalid_checksum_date') };
}

function mapShelf(row: SqlRow, userIds: Set<number>, warnings: WarningCollector): CalibreWebAutomatedShelfRecord | null {
  const id = positiveInteger(row.id);
  const userId = positiveInteger(row.userId);
  const name = requiredText(row.name, MAX_TEXT_BYTES, warnings, 'invalid_shelf');
  if (id == null || userId == null || !name) return null;
  if (!userIds.has(userId)) {
    warnings.add('orphaned_shelf');
    return null;
  }
  return { id, userId, name, isPublic: sqliteBoolean(row.isPublic) };
}

function mapShelfBook(
  row: SqlRow,
  shelfIds: Set<number>,
  bookIds: Set<number>,
  warnings: WarningCollector,
): CalibreWebAutomatedShelfBookRecord | null {
  const id = positiveInteger(row.id);
  const shelfId = positiveInteger(row.shelfId);
  const bookId = positiveInteger(row.bookId);
  if (id == null || shelfId == null || bookId == null) {
    warnings.add('invalid_shelf_book');
    return null;
  }
  if (!shelfIds.has(shelfId) || !bookIds.has(bookId)) {
    warnings.add('orphaned_shelf_book');
    return null;
  }
  const position = row.position == null ? null : integer(row.position);
  if (row.position != null && position == null) warnings.add('invalid_shelf_position');
  return { id, shelfId, bookId, position };
}

function mapLinkBase(
  row: SqlRow,
  bookIds: Set<number>,
  warnings: WarningCollector,
  category: string,
): { id: number; bookId: number; valueId: number } | null {
  const id = positiveInteger(row.id);
  const bookId = positiveInteger(row.bookId);
  const valueId = positiveInteger(row.valueId ?? row.authorId);
  if (id == null || bookId == null || valueId == null) {
    warnings.add(`invalid_${category}_link`);
    return null;
  }
  if (!bookIds.has(bookId)) {
    warnings.add(`orphaned_${category}_link`);
    return null;
  }
  return { id, bookId, valueId };
}

class WarningCollector {
  private readonly counts = new Map<string, number>();

  add(category: string): void {
    if (!this.counts.has(category) && this.counts.size >= MAX_WARNING_CATEGORIES) return;
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
  }

  values(): CalibreWebAutomatedConnectorWarning[] {
    return [...this.counts].map(([category, count]) => ({ category, count }));
  }
}

function requiredText(value: unknown, maximumBytes: number, warnings: WarningCollector, category: string): string | null {
  const text = boundedText(value, maximumBytes)?.trim() ?? '';
  if (!text) {
    warnings.add(category);
    return null;
  }
  return text;
}

function nullableText(value: unknown, maximumBytes: number, warnings: WarningCollector, category: string): string | null {
  if (value == null || value === '') return null;
  const text = boundedText(value, maximumBytes);
  if (text == null) warnings.add(category);
  return text;
}

function boundedText(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes || value.includes('\0')) return null;
  return value;
}

function nullableDate(value: unknown, warnings: WarningCollector, category: string): string | null {
  if (value == null || value === '') return null;
  const text = boundedText(value, MAX_TEXT_BYTES);
  if (!text || !Number.isFinite(Date.parse(text))) {
    warnings.add(category);
    return null;
  }
  return text;
}

function positiveInteger(value: unknown): number | null {
  const number = integer(value);
  return number != null && number > 0 ? number : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableFiniteNumber(value: unknown, warnings: WarningCollector, category: string): number | null {
  if (value == null) return null;
  const parsed = finiteNumber(value);
  if (parsed == null) warnings.add(category);
  return parsed;
}

function sqliteBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function requireContained(root: string, candidate: string): void {
  const displacement = relative(root, candidate);
  if (displacement === '..' || displacement.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(displacement)) {
    throw new BadRequestException('Calibre-Web Automated snapshot path is outside the configured migration import root');
  }
}

function sameFile(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function closeDatabaseQuietly(database: DatabaseSync | null): void {
  try {
    database?.close();
  } catch {
    return;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
