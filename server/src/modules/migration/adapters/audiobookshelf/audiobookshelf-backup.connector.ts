import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { chmod, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import type { File as ZipEntry } from 'unzipper';
import { Open } from 'unzipper';

import { migrationConfig } from '../../../../config/config';
import type { AudiobookshelfConnectionConfig } from './audiobookshelf-connection-config';
import type {
  AudiobookshelfAudioFileRecord,
  AudiobookshelfAuthorRecord,
  AudiobookshelfBookmarkRecord,
  AudiobookshelfBookRecord,
  AudiobookshelfEbookFileRecord,
  AudiobookshelfLibraryItemRecord,
  AudiobookshelfMediaProgressRecord,
  AudiobookshelfPlaybackSessionRecord,
  AudiobookshelfSeriesRecord,
  AudiobookshelfSourceRecords,
  AudiobookshelfTimestamp,
  AudiobookshelfUserRecord,
} from './audiobookshelf-source.types';

type BackupConfig = Extract<AudiobookshelfConnectionConfig, { mode: 'backup' }>;
type SqlRow = Record<string, unknown>;

interface AuthorizedBackupFile {
  handle: FileHandle;
  size: number;
}

interface RequiredArchiveEntries {
  details: ZipEntry;
  database: ZipEntry;
}

interface BookAuthorLink {
  bookId: string;
  author: AudiobookshelfAuthorRecord;
}

interface BookSeriesLink {
  bookId: string;
  series: AudiobookshelfSeriesRecord;
}

const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_DETAILS_BYTES = 1024 * 1024;
const MAX_SQLITE_BYTES = 8 * 1024 * 1024 * 1024;
const SQLITE_QUERY_BATCH_SIZE = 1_000;
const MAX_SQL_ROWS_PER_TABLE = 1_000_000;
const MAX_WARNINGS = 100;

const REQUIRED_SCHEMA = {
  users: ['id', 'username', 'email', 'isActive', 'bookmarks'],
  libraryItems: ['id', 'libraryId', 'libraryFolderId', 'path', 'relPath', 'mediaType', 'mediaId'],
  books: [
    'id',
    'title',
    'subtitle',
    'publishedYear',
    'publisher',
    'description',
    'isbn',
    'asin',
    'language',
    'abridged',
    'duration',
    'narrators',
    'audioFiles',
    'ebookFile',
    'tags',
    'genres',
  ],
  mediaProgresses: [
    'id',
    'mediaItemId',
    'mediaItemType',
    'duration',
    'currentTime',
    'isFinished',
    'ebookLocation',
    'ebookProgress',
    'finishedAt',
    'extraData',
    'userId',
    'createdAt',
    'updatedAt',
  ],
} as const;

const OPTIONAL_SCHEMA = {
  authors: ['id', 'name'],
  bookAuthors: ['id', 'bookId', 'authorId', 'createdAt'],
  series: ['id', 'name'],
  bookSeries: ['id', 'bookId', 'seriesId', 'sequence', 'createdAt'],
  playbackSessions: [
    'id',
    'mediaItemId',
    'mediaItemType',
    'duration',
    'startTime',
    'currentTime',
    'timeListening',
    'userId',
    'extraData',
    'createdAt',
    'updatedAt',
  ],
  libraryFolders: ['id', 'libraryId', 'path'],
} as const;

const TABLE_INFO_SQL: Record<string, string> = {
  users: 'PRAGMA table_info("users")',
  libraryItems: 'PRAGMA table_info("libraryItems")',
  books: 'PRAGMA table_info("books")',
  mediaProgresses: 'PRAGMA table_info("mediaProgresses")',
  authors: 'PRAGMA table_info("authors")',
  bookAuthors: 'PRAGMA table_info("bookAuthors")',
  series: 'PRAGMA table_info("series")',
  bookSeries: 'PRAGMA table_info("bookSeries")',
  playbackSessions: 'PRAGMA table_info("playbackSessions")',
  libraryFolders: 'PRAGMA table_info("libraryFolders")',
};

const USER_SQL = 'SELECT id, username, email, isActive, bookmarks FROM users ORDER BY id LIMIT ? OFFSET ?';
const LIBRARY_ITEM_SQL = 'SELECT id, libraryId, libraryFolderId, path, relPath, mediaType, mediaId FROM libraryItems ORDER BY id LIMIT ? OFFSET ?';
const BOOK_SQL =
  'SELECT id, title, subtitle, publishedYear, publisher, description, isbn, asin, language, abridged, duration, narrators, audioFiles, ebookFile, tags, genres FROM books ORDER BY id LIMIT ? OFFSET ?';
const MEDIA_PROGRESS_SQL =
  'SELECT id, mediaItemId, mediaItemType, duration, currentTime, isFinished, ebookLocation, ebookProgress, finishedAt, extraData, userId, createdAt, updatedAt FROM mediaProgresses ORDER BY id LIMIT ? OFFSET ?';
// `lastFirst` and `description` are enrichment columns, not identity: older and newer
// Audiobookshelf schemas may omit either without invalidating author relationships. The
// projection is assembled from these fixed constants only, never from source-controlled text.
const AUTHOR_OPTIONAL_COLUMN_SQL: Record<string, string> = {
  lastFirst: 'authors.lastFirst AS lastFirst',
  description: 'authors.description AS description',
};

function buildAuthorLinkSql(availableAuthorColumns: Set<string>): string {
  const projected = Object.entries(AUTHOR_OPTIONAL_COLUMN_SQL)
    .filter(([column]) => availableAuthorColumns.has(column))
    .map(([, expression]) => `, ${expression}`)
    .join('');
  return `SELECT bookAuthors.id, bookAuthors.bookId, authors.id AS authorId, authors.name${projected} FROM bookAuthors INNER JOIN authors ON authors.id = bookAuthors.authorId ORDER BY bookAuthors.id LIMIT ? OFFSET ?`;
}
const SERIES_LINK_SQL =
  'SELECT bookSeries.id, bookSeries.bookId, series.id AS seriesId, series.name, bookSeries.sequence FROM bookSeries INNER JOIN series ON series.id = bookSeries.seriesId ORDER BY bookSeries.id LIMIT ? OFFSET ?';
const PLAYBACK_SESSION_SQL =
  'SELECT id, mediaItemId, mediaItemType, duration, startTime, currentTime, timeListening, userId, extraData, createdAt, updatedAt FROM playbackSessions ORDER BY id LIMIT ? OFFSET ?';
const LIBRARY_FOLDER_SQL = 'SELECT id, libraryId, path FROM libraryFolders ORDER BY id LIMIT ? OFFSET ?';

@Injectable()
export class AudiobookshelfBackupConnector {
  constructor(@Inject(migrationConfig.KEY) private readonly config: ConfigType<typeof migrationConfig>) {}

  async fetchSourceRecords(config: BackupConfig): Promise<AudiobookshelfSourceRecords> {
    let authorized: AuthorizedBackupFile | null = null;
    let temporaryDirectory: string | null = null;
    let database: DatabaseSync | null = null;

    try {
      authorized = await authorizeBackupFile(this.config.importRoot, config.backupPath);
      const archive = await openArchiveFromHandle(authorized);
      const entries = inspectRequiredEntries(archive.files);
      const details = await readEntryBounded(entries.details, MAX_DETAILS_BYTES);

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'bookorbit-abs-migration-'));
      await chmod(temporaryDirectory, 0o700);
      const databasePath = join(temporaryDirectory, 'absdatabase.sqlite');
      await writeEntryToOwnerOnlyFile(entries.database, databasePath, MAX_SQLITE_BYTES);

      database = new DatabaseSync(databasePath, { readOnly: true });
      database.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON');
      database.enableDefensive?.(true);
      return readSourceRecords(database, parseSourceVersion(details));
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The Audiobookshelf backup could not be read safely');
    } finally {
      closeDatabaseQuietly(database);
      await authorized?.handle.close().catch(() => undefined);
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function closeDatabaseQuietly(database: DatabaseSync | null): void {
  try {
    database?.close();
  } catch {
    return;
  }
}

export async function authorizeBackupFile(importRoot: string | undefined, backupPath: string): Promise<AuthorizedBackupFile> {
  if (!importRoot) throw new BadRequestException('Audiobookshelf backup migration is not configured on this server');
  if (!isAbsolute(backupPath)) throw new BadRequestException('Audiobookshelf backup path must be absolute');

  let canonicalRoot: string;
  let canonicalCandidate: string;
  try {
    [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(importRoot), realpath(backupPath)]);
  } catch {
    throw new BadRequestException('Audiobookshelf backup path could not be resolved');
  }
  requireContained(canonicalRoot, canonicalCandidate);

  const beforeOpen = await stat(canonicalCandidate).catch(() => null);
  if (!beforeOpen?.isFile()) throw new BadRequestException('Audiobookshelf backup path must identify a regular file');

  let handle: FileHandle | null = null;
  try {
    handle = await open(canonicalCandidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile()) throw new BadRequestException('Audiobookshelf backup path must identify a regular file');
    if (!sameFile(beforeOpen, opened)) throw new BadRequestException('Audiobookshelf backup file changed while it was being opened');

    const postOpenCanonical = await realpath(backupPath);
    requireContained(canonicalRoot, postOpenCanonical);
    const postOpen = await stat(postOpenCanonical);
    if (!sameFile(opened, postOpen)) throw new BadRequestException('Audiobookshelf backup file changed while it was being opened');

    const result = { handle, size: opened.size };
    handle = null;
    return result;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Audiobookshelf backup file could not be opened safely');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function requireContained(root: string, candidate: string): void {
  const displacement = relative(root, candidate);
  if (displacement === '..' || displacement.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(displacement)) {
    throw new BadRequestException('Audiobookshelf backup path is outside the configured migration import root');
  }
}

function sameFile(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

async function openArchiveFromHandle(authorized: AuthorizedBackupFile) {
  try {
    return await Open.custom({
      size: () => Promise.resolve(authorized.size),
      stream: (offset, length) => createHandleRangeStream(authorized.handle, authorized.size, offset, length),
    });
  } catch {
    throw new BadRequestException('Audiobookshelf backup is not a valid ZIP archive');
  }
}

function createHandleRangeStream(handle: FileHandle, fileSize: number, offset: number, length: number | undefined): Readable {
  async function* readRange() {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > fileSize) throw new Error('Invalid ZIP read offset');
    if (length !== undefined && (!Number.isSafeInteger(length) || length < 0)) throw new Error('Invalid ZIP read length');
    const requestedEnd = length === undefined ? fileSize : offset + length;
    if (!Number.isSafeInteger(requestedEnd)) throw new Error('Invalid ZIP read range');
    const end = Math.min(fileSize, requestedEnd);
    let position = offset;
    while (position < end) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
  }
  return Readable.from(readRange());
}

export function inspectRequiredEntries(files: ZipEntry[]): RequiredArchiveEntries {
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new BadRequestException('Audiobookshelf backup contains too many archive entries');
  const details = files.filter((entry) => entry.path === 'details');
  const databases = files.filter((entry) => entry.path === 'absdatabase.sqlite');
  if (details.length !== 1 || databases.length !== 1) {
    throw new BadRequestException(
      details.length > 1 || databases.length > 1
        ? 'Audiobookshelf backup contains duplicate required entries'
        : 'Audiobookshelf backup is missing required entries',
    );
  }
  if (details[0].type !== 'File' || databases[0].type !== 'File') {
    throw new BadRequestException('Audiobookshelf backup required entries must be regular files');
  }
  requireEntrySize(details[0], MAX_DETAILS_BYTES, 'details');
  requireEntrySize(databases[0], MAX_SQLITE_BYTES, 'SQLite database');
  return { details: details[0], database: databases[0] };
}

function requireEntrySize(entry: ZipEntry, maximum: number, label: string): void {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > maximum) {
    throw new BadRequestException(`Audiobookshelf backup ${label} exceeds the allowed size`);
  }
}

async function readEntryBounded(entry: ZipEntry, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of entry.stream()) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maximum) throw new BadRequestException('Audiobookshelf backup entry exceeded the allowed size while reading');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Audiobookshelf backup contains a malformed archive entry');
  }
}

async function writeEntryToOwnerOnlyFile(entry: ZipEntry, outputPath: string, maximum: number): Promise<void> {
  const output = await open(outputPath, 'wx', 0o600);
  let offset = 0;
  try {
    for await (const chunk of entry.stream()) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (offset + buffer.byteLength > maximum) {
        throw new BadRequestException('Audiobookshelf backup SQLite database exceeded the allowed size while reading');
      }
      let written = 0;
      while (written < buffer.byteLength) {
        const result = await output.write(buffer, written, buffer.byteLength - written, offset + written);
        written += result.bytesWritten;
      }
      offset += buffer.byteLength;
    }
    await output.sync();
    await chmod(outputPath, 0o600);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Audiobookshelf backup contains a malformed SQLite entry');
  } finally {
    await output.close();
  }
}

function parseSourceVersion(details: Buffer): string | null {
  const lines = details.toString('utf8').split(/\r?\n/);
  const version = lines[3]?.trim();
  return version || null;
}

function readSourceRecords(database: DatabaseSync, sourceVersion: string | null): AudiobookshelfSourceRecords {
  const warnings = new WarningCollector();
  const availableTables = getAvailableTables(database);
  verifyRequiredSchema(database, availableTables);

  const authorRelationsAvailable = verifyOptionalGroup(database, availableTables, ['authors', 'bookAuthors'], warnings, 'authors');
  const seriesRelationsAvailable = verifyOptionalGroup(database, availableTables, ['series', 'bookSeries'], warnings, 'series');
  const playbackSessionsAvailable = verifyOptionalGroup(database, availableTables, ['playbackSessions'], warnings, 'playback sessions');
  const libraryFoldersAvailable = verifyOptionalGroup(database, availableTables, ['libraryFolders'], warnings, 'library folders');

  const users = readBatched(database, USER_SQL).flatMap((row) => mapUser(row, warnings));
  const authorLinks = authorRelationsAvailable
    ? readBatched(database, buildAuthorLinkSql(getColumns(database, 'authors'))).flatMap(mapBookAuthorLink)
    : [];
  const seriesLinks = seriesRelationsAvailable ? readBatched(database, SERIES_LINK_SQL).flatMap(mapBookSeriesLink) : [];
  const authorsByBook = groupByBook(authorLinks);
  const seriesByBook = groupByBook(seriesLinks);
  const booksById = new Map(
    readBatched(database, BOOK_SQL)
      .flatMap((row) => mapBook(row, authorsByBook, seriesByBook, warnings))
      .map((book) => [book.id, book]),
  );
  const libraryItems = readBatched(database, LIBRARY_ITEM_SQL).flatMap((row) => mapLibraryItem(row, booksById, warnings));
  const mediaProgress = readBatched(database, MEDIA_PROGRESS_SQL).flatMap((row) => mapMediaProgress(row, warnings));
  const bookmarks = users.flatMap((user) => readBookmarks(user, warnings));
  const playbackSessions = playbackSessionsAvailable
    ? readBatched(database, PLAYBACK_SESSION_SQL).flatMap((row) => mapPlaybackSession(row, warnings))
    : null;
  const libraryFolders = libraryFoldersAvailable ? readBatched(database, LIBRARY_FOLDER_SQL).flatMap((row) => mapLibraryFolder(row, warnings)) : null;

  return {
    sourceVersion,
    users: users.map((user) => ({ id: user.id, username: user.username, email: user.email, isActive: user.isActive })),
    libraryItems,
    mediaProgress,
    bookmarks,
    playbackSessions,
    libraryFolders,
    authorsAvailable: authorRelationsAvailable,
    warnings: warnings.values(),
  };
}

function getAvailableTables(database: DatabaseSync): Set<string> {
  const rows = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as SqlRow[];
  return new Set(rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : [])));
}

function verifyRequiredSchema(database: DatabaseSync, availableTables: Set<string>): void {
  const missingTables = Object.keys(REQUIRED_SCHEMA).filter((table) => !availableTables.has(table));
  if (missingTables.length > 0) {
    throw new BadRequestException(`Audiobookshelf backup is missing required tables: ${missingTables.join(', ')}`);
  }
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    const missingColumns = columns.filter((column) => !getColumns(database, table).has(column));
    if (missingColumns.length > 0) {
      throw new BadRequestException(`Audiobookshelf backup table ${table} is missing required columns: ${missingColumns.join(', ')}`);
    }
  }
}

function verifyOptionalGroup(
  database: DatabaseSync,
  availableTables: Set<string>,
  tables: Array<keyof typeof OPTIONAL_SCHEMA>,
  warnings: WarningCollector,
  label: string,
): boolean {
  for (const table of tables) {
    if (!availableTables.has(table)) {
      warnings.add(`Audiobookshelf backup does not contain compatible ${label} data because table ${table} is missing`);
      return false;
    }
    const missingColumns = OPTIONAL_SCHEMA[table].filter((column) => !getColumns(database, table).has(column));
    if (missingColumns.length > 0) {
      warnings.add(`Audiobookshelf backup does not contain compatible ${label} data because table ${table} is missing columns`);
      return false;
    }
  }
  return true;
}

function getColumns(database: DatabaseSync, table: string): Set<string> {
  const sql = TABLE_INFO_SQL[table];
  if (!sql) throw new BadRequestException('Audiobookshelf backup schema inspection failed');
  const rows = database.prepare(sql).all() as SqlRow[];
  return new Set(rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : [])));
}

function readBatched(database: DatabaseSync, sql: string): SqlRow[] {
  const statement = database.prepare(sql);
  const rows: SqlRow[] = [];
  for (let offset = 0; offset < MAX_SQL_ROWS_PER_TABLE; offset += SQLITE_QUERY_BATCH_SIZE) {
    const batch = statement.all(SQLITE_QUERY_BATCH_SIZE, offset) as SqlRow[];
    rows.push(...batch);
    if (batch.length < SQLITE_QUERY_BATCH_SIZE) return rows;
  }
  throw new BadRequestException('Audiobookshelf backup table exceeds the migration row limit');
}

interface BackupUserRecord extends AudiobookshelfUserRecord {
  bookmarks: unknown[];
}

function mapUser(row: SqlRow, warnings: WarningCollector): BackupUserRecord[] {
  const id = requiredText(row.id);
  const username = requiredText(row.username);
  if (!id || !username) {
    warnings.add('Skipped an Audiobookshelf user row with an invalid id or username');
    return [];
  }
  return [
    {
      id,
      username,
      email: nullableText(row.email),
      isActive: sqliteBoolean(row.isActive),
      bookmarks: parseJsonArray(row.bookmarks, `user ${id} bookmarks`, warnings),
    },
  ];
}

function mapBookAuthorLink(row: SqlRow): BookAuthorLink[] {
  const bookId = requiredText(row.bookId);
  const name = requiredText(row.name);
  if (!bookId || !name) return [];
  return [
    {
      bookId,
      author: {
        id: nullableText(row.authorId),
        name,
        sortName: nullableText(row.lastFirst),
        description: nullableText(row.description),
      },
    },
  ];
}

function mapBookSeriesLink(row: SqlRow): BookSeriesLink[] {
  const bookId = requiredText(row.bookId);
  const name = requiredText(row.name);
  if (!bookId || !name) return [];
  return [{ bookId, series: { id: nullableText(row.seriesId), name, sequence: stringOrNumber(row.sequence) } }];
}

function groupByBook<T extends { bookId: string }>(relations: T[]): Map<string, Array<Omit<T, 'bookId'>>> {
  const grouped = new Map<string, Array<Omit<T, 'bookId'>>>();
  for (const { bookId, ...value } of relations) {
    const entries = grouped.get(bookId) ?? [];
    entries.push(value);
    grouped.set(bookId, entries);
  }
  return grouped;
}

function mapBook(
  row: SqlRow,
  authorsByBook: Map<string, Array<{ author: AudiobookshelfAuthorRecord }>>,
  seriesByBook: Map<string, Array<{ series: AudiobookshelfSeriesRecord }>>,
  warnings: WarningCollector,
): AudiobookshelfBookRecord[] {
  const id = requiredText(row.id);
  if (!id) {
    warnings.add('Skipped an Audiobookshelf book row with an invalid id');
    return [];
  }
  const narrators = parseJsonArray(row.narrators, `book ${id} narrators`, warnings).flatMap((value) => (typeof value === 'string' ? [value] : []));
  const genres = parseJsonArray(row.genres, `book ${id} genres`, warnings).flatMap((value) => (typeof value === 'string' ? [value] : []));
  const tags = parseJsonArray(row.tags, `book ${id} tags`, warnings).flatMap((value) => (typeof value === 'string' ? [value] : []));
  const audioFiles = parseJsonArray(row.audioFiles, `book ${id} audioFiles`, warnings).flatMap((value) => mapAudioFile(value, id, warnings));
  const ebookFile = mapEbookFile(parseJsonObject(row.ebookFile, `book ${id} ebookFile`, warnings), id, warnings);
  return [
    {
      id,
      title: nullableText(row.title),
      subtitle: nullableText(row.subtitle),
      authors: (authorsByBook.get(id) ?? []).map((entry) => entry.author),
      narrators,
      isbn: nullableText(row.isbn),
      asin: nullableText(row.asin),
      description: nullableText(row.description),
      publisher: nullableText(row.publisher),
      publishedYear: stringOrNumber(row.publishedYear),
      language: nullableText(row.language),
      duration: finiteNumber(row.duration),
      abridged: sqliteBoolean(row.abridged),
      genres,
      tags,
      series: (seriesByBook.get(id) ?? []).map((entry) => entry.series),
      audioFiles,
      ebookFile,
    },
  ];
}

function mapAudioFile(value: unknown, bookId: string, warnings: WarningCollector): AudiobookshelfAudioFileRecord[] {
  const row = asRecord(value);
  const metadata = asRecord(row.metadata);
  if (Object.keys(row).length === 0 || Object.keys(metadata).length === 0) {
    warnings.add(`Skipped an invalid audio file JSON value for Audiobookshelf book ${bookId}`);
    return [];
  }
  return [
    {
      ino: stringOrNumber(row.ino),
      index: finiteNumber(row.index),
      format: nullableText(row.format),
      duration: finiteNumber(row.duration),
      exclude: booleanValue(row.exclude),
      invalid: booleanValue(row.invalid),
      metadata: {
        path: nullableText(metadata.path),
        relPath: nullableText(metadata.relPath),
        filename: nullableText(metadata.filename),
        ext: nullableText(metadata.ext),
      },
    },
  ];
}

function mapEbookFile(value: Record<string, unknown> | null, bookId: string, warnings: WarningCollector): AudiobookshelfEbookFileRecord | null {
  if (!value) return null;
  const metadata = asRecord(value.metadata);
  if (Object.keys(metadata).length === 0) {
    warnings.add(`Skipped an invalid ebook file JSON value for Audiobookshelf book ${bookId}`);
    return null;
  }
  return {
    ino: stringOrNumber(value.ino),
    ebookFormat: nullableText(value.ebookFormat),
    metadata: {
      path: nullableText(metadata.path),
      relPath: nullableText(metadata.relPath),
      filename: nullableText(metadata.filename),
      ext: nullableText(metadata.ext),
    },
  };
}

function mapLibraryItem(
  row: SqlRow,
  booksById: Map<string, AudiobookshelfBookRecord>,
  warnings: WarningCollector,
): AudiobookshelfLibraryItemRecord[] {
  const id = requiredText(row.id);
  const mediaType = requiredText(row.mediaType)?.toLowerCase();
  if (!id || !mediaType) {
    warnings.add('Skipped an Audiobookshelf library item row with invalid identity fields');
    return [];
  }
  const mediaId = nullableText(row.mediaId);
  if (mediaType !== 'book') {
    return [{ id, mediaType: 'podcast', path: nullableText(row.path), relPath: nullableText(row.relPath), mediaId }];
  }
  const book = mediaId ? booksById.get(mediaId) : null;
  if (!book) {
    warnings.add(`Skipped Audiobookshelf library item ${id} because its book record is missing`);
    return [];
  }
  return [{ id, mediaType: 'book', path: nullableText(row.path), relPath: nullableText(row.relPath), book }];
}

function mapMediaProgress(row: SqlRow, warnings: WarningCollector): AudiobookshelfMediaProgressRecord[] {
  const id = nullableText(row.id);
  const userId = requiredText(row.userId);
  const mediaItemId = requiredText(row.mediaItemId);
  const mediaItemType = requiredText(row.mediaItemType);
  if (!userId || !mediaItemId || !mediaItemType) {
    warnings.add(`Skipped Audiobookshelf media progress ${id ?? 'with unknown id'} because its relationship fields are invalid`);
    return [];
  }
  const extraData = parseJsonObject(row.extraData, `media progress ${id ?? mediaItemId} extraData`, warnings);
  return [
    {
      id,
      userId,
      mediaItemId,
      mediaItemType,
      libraryItemId: nullableText(extraData?.libraryItemId),
      duration: finiteNumber(row.duration),
      progress: finiteNumber(extraData?.progress),
      currentTime: finiteNumber(row.currentTime),
      ebookProgress: finiteNumber(row.ebookProgress),
      ebookLocation: nullableText(row.ebookLocation),
      isFinished: sqliteBoolean(row.isFinished),
      startedAt: timestampValue(row.createdAt),
      lastUpdate: timestampValue(row.updatedAt),
      createdAt: timestampValue(row.createdAt),
      updatedAt: timestampValue(row.updatedAt),
      finishedAt: timestampValue(row.finishedAt),
    },
  ];
}

function readBookmarks(user: BackupUserRecord, warnings: WarningCollector): AudiobookshelfBookmarkRecord[] {
  return user.bookmarks.flatMap((value) => {
    const row = asRecord(value);
    const libraryItemId = requiredText(row.libraryItemId);
    const time = finiteNumber(row.time);
    if (!libraryItemId || time === null) {
      warnings.add(`Skipped an invalid bookmark JSON value for Audiobookshelf user ${user.id}`);
      return [];
    }
    return [{ userId: user.id, libraryItemId, time, title: nullableText(row.title), createdAt: timestampValue(row.createdAt) }];
  });
}

function mapPlaybackSession(row: SqlRow, warnings: WarningCollector): AudiobookshelfPlaybackSessionRecord[] {
  const id = requiredText(row.id);
  const userId = requiredText(row.userId);
  const mediaItemId = requiredText(row.mediaItemId);
  const mediaItemType = requiredText(row.mediaItemType);
  const duration = finiteNumber(row.duration);
  const startTime = finiteNumber(row.startTime);
  const currentTime = finiteNumber(row.currentTime);
  const timeListening = finiteNumber(row.timeListening);
  if (!id || !userId || !mediaItemId || !mediaItemType || duration === null || startTime === null || currentTime === null || timeListening === null) {
    warnings.add(`Skipped an invalid Audiobookshelf playback session ${id ?? 'with unknown id'}`);
    return [];
  }
  return [
    {
      id,
      userId,
      mediaItemId,
      mediaItemType,
      duration,
      startTime,
      currentTime,
      timeListening,
      startedAt: timestampValue(row.createdAt),
      createdAt: timestampValue(row.createdAt),
      updatedAt: timestampValue(row.updatedAt),
    },
  ];
}

function mapLibraryFolder(row: SqlRow, warnings: WarningCollector) {
  const path = requiredText(row.path);
  if (!path) {
    warnings.add('Skipped an Audiobookshelf library folder with an invalid path');
    return [];
  }
  return [{ id: nullableText(row.id), libraryId: nullableText(row.libraryId), path }];
}

function parseJsonArray(value: unknown, label: string, warnings: WarningCollector): unknown[] {
  if (value == null || value === '') return [];
  const parsed = parseJson(value, label, warnings);
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null) warnings.add(`Ignored Audiobookshelf ${label} because it is not a JSON array`);
  return [];
}

function parseJsonObject(value: unknown, label: string, warnings: WarningCollector): Record<string, unknown> | null {
  if (value == null || value === '') return null;
  const parsed = parseJson(value, label, warnings);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  if (parsed !== null) warnings.add(`Ignored Audiobookshelf ${label} because it is not a JSON object`);
  return null;
}

function parseJson(value: unknown, label: string, warnings: WarningCollector): unknown {
  if (typeof value !== 'string') {
    warnings.add(`Ignored Audiobookshelf ${label} because it is not JSON text`);
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    warnings.add(`Ignored malformed JSON in Audiobookshelf ${label}`);
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredText(value: unknown): string | null {
  return nullableText(value);
}

function nullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNumber(value: unknown): string | number | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function sqliteBoolean(value: unknown): boolean | null {
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  return null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : sqliteBoolean(value);
}

function timestampValue(value: unknown): AudiobookshelfTimestamp {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || value instanceof Date ? value : null;
}

class WarningCollector {
  private readonly warnings: string[] = [];
  private suppressed = 0;

  add(warning: string): void {
    if (this.warnings.length < MAX_WARNINGS) this.warnings.push(warning);
    else this.suppressed++;
  }

  values(): string[] {
    return this.suppressed > 0 ? [...this.warnings, `${this.suppressed} additional Audiobookshelf backup warnings were suppressed`] : this.warnings;
  }
}
