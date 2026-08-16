import { ZipArchive } from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { File as ZipEntry } from 'unzipper';

import { AudiobookshelfBackupConnector, authorizeBackupFile, inspectRequiredEntries } from './audiobookshelf-backup.connector';

const DETAILS = '2026-08-14T1200\nsqlite\n1786737600000\n2.36.0';

describe('AudiobookshelfBackupConnector', () => {
  let importRoot: string;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-abs-backup-test-'));
    importRoot = join(testRoot, 'imports');
    await mkdir(importRoot, { mode: 0o700 });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('reads only migration fields from a valid backup into common source records', async () => {
    const backupPath = await createBackup(importRoot, 'valid.audiobookshelf', createCompleteDatabase);
    const connector = new AudiobookshelfBackupConnector({ encryptionKey: '', importRoot });

    const records = await connector.fetchSourceRecords({ mode: 'backup', backupPath });

    expect(records.sourceVersion).toBe('2.36.0');
    expect(records.users).toEqual([{ id: 'user-1', username: 'reader', email: 'reader@example.com', isActive: true }]);
    expect(records.bookmarks).toEqual([
      {
        userId: 'user-1',
        libraryItemId: 'item-1',
        time: 42,
        title: 'A bookmark',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    expect(records.libraryItems).toHaveLength(1);
    expect(records.libraryItems[0]).toMatchObject({
      id: 'item-1',
      mediaType: 'book',
      path: '/audiobooks/Example',
      book: {
        id: 'book-1',
        title: 'Example Book',
        authors: [{ id: 'author-1', name: 'Ada Author', sortName: 'Author, Ada', description: 'Bio' }],
        series: [{ id: 'series-1', name: 'Examples', sequence: '2' }],
        audioFiles: [{ ino: '101', index: 0, duration: 120 }],
        ebookFile: { ino: '102', ebookFormat: 'epub' },
      },
    });
    expect(records.mediaProgress).toEqual([
      expect.objectContaining({
        id: 'progress-1',
        userId: 'user-1',
        mediaItemId: 'book-1',
        libraryItemId: 'item-1',
        progress: 0.5,
        currentTime: 60,
        isFinished: false,
      }),
    ]);
    expect(records.playbackSessions).toEqual([
      expect.objectContaining({ id: 'session-1', userId: 'user-1', mediaItemId: 'book-1', mediaItemType: 'book', timeListening: 30 }),
    ]);
    expect(records.libraryFolders).toEqual([{ id: 'folder-1', libraryId: 'library-1', path: '/audiobooks' }]);
    expect(records.authorsAvailable).toBe(true);
    expect(JSON.stringify(records)).not.toContain('password-hash');
    expect(JSON.stringify(records)).not.toContain('source-api-token');
    expect(await readdir(importRoot)).toEqual(['valid.audiobookshelf']);
  });

  it('continues with warnings when optional relationship tables and row JSON are unavailable', async () => {
    const backupPath = await createBackup(importRoot, 'reduced.audiobookshelf', (path) =>
      createRequiredDatabase(path, { userBookmarks: '{bad json', audioFiles: '{bad json' }),
    );
    const connector = new AudiobookshelfBackupConnector({ encryptionKey: '', importRoot });

    const records = await connector.fetchSourceRecords({ mode: 'backup', backupPath });

    expect(records.users).toHaveLength(1);
    expect(records.libraryItems).toHaveLength(1);
    expect(records.playbackSessions).toBeNull();
    expect(records.libraryFolders).toBeNull();
    expect(records.authorsAvailable).toBe(false);
    expect(records.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('table authors is missing'),
        expect.stringContaining('table playbackSessions is missing'),
        expect.stringContaining('malformed JSON'),
      ]),
    );
  });

  it('keeps author relationships when the optional enrichment columns are absent', async () => {
    const backupPath = await createBackup(importRoot, 'lean-authors.audiobookshelf', (path) => {
      createRequiredDatabase(path);
      const database = new DatabaseSync(path);
      database.exec(`
        CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE bookAuthors (id TEXT PRIMARY KEY, bookId TEXT, authorId TEXT, createdAt TEXT);
      `);
      database.prepare('INSERT INTO authors VALUES (?, ?)').run('author-1', 'Ada Author');
      database.prepare('INSERT INTO bookAuthors VALUES (?, ?, ?, ?)').run('book-author-1', 'book-1', 'author-1', '2026-01-01');
      database.close();
    });
    const connector = new AudiobookshelfBackupConnector({ encryptionKey: '', importRoot });

    const records = await connector.fetchSourceRecords({ mode: 'backup', backupPath });

    expect(records.authorsAvailable).toBe(true);
    expect(records.libraryItems[0]).toMatchObject({
      book: { authors: [{ id: 'author-1', name: 'Ada Author', sortName: null, description: null }] },
    });
  });

  it('rejects a backup with a missing required table and removes temporary data', async () => {
    const backupPath = await createBackup(importRoot, 'missing-schema.audiobookshelf', (databasePath) => {
      const database = new DatabaseSync(databasePath);
      database.exec('CREATE TABLE users (id TEXT, username TEXT, email TEXT, isActive INTEGER, bookmarks TEXT)');
      database.close();
    });
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('bookorbit-abs-migration-')));
    const connector = new AudiobookshelfBackupConnector({ encryptionKey: '', importRoot });

    await expect(connector.fetchSourceRecords({ mode: 'backup', backupPath })).rejects.toThrow('missing required tables');

    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('bookorbit-abs-migration-') && !before.has(name));
    expect(after).toEqual([]);
  });

  it('rejects malformed, duplicate-entry, and oversized-details archives', async () => {
    const malformedPath = join(importRoot, 'malformed.audiobookshelf');
    await writeFile(malformedPath, 'not a zip');
    const duplicatePath = await createBackup(importRoot, 'duplicate.audiobookshelf', createRequiredDatabase, {
      duplicateDetails: true,
    });
    const oversizedPath = await createBackup(importRoot, 'oversized.audiobookshelf', createRequiredDatabase, {
      details: Buffer.alloc(1024 * 1024 + 1, 65),
    });
    const connector = new AudiobookshelfBackupConnector({ encryptionKey: '', importRoot });

    await expect(connector.fetchSourceRecords({ mode: 'backup', backupPath: malformedPath })).rejects.toThrow('valid ZIP archive');
    await expect(connector.fetchSourceRecords({ mode: 'backup', backupPath: duplicatePath })).rejects.toThrow('duplicate required entries');
    await expect(connector.fetchSourceRecords({ mode: 'backup', backupPath: oversizedPath })).rejects.toThrow('details exceeds the allowed size');
  });

  it('rejects excessive archive entry counts before reading entries', () => {
    const fakeEntry = { path: 'metadata-items/item', type: 'File', uncompressedSize: 0 } as ZipEntry;
    expect(() => inspectRequiredEntries(Array.from({ length: 20_001 }, () => fakeEntry))).toThrow('too many archive entries');
  });

  it('requires a configured root and rejects canonical paths outside it', async () => {
    const outsidePath = join(testRoot, 'outside.audiobookshelf');
    await writeFile(outsidePath, 'outside');
    const escapePath = join(importRoot, 'escape.audiobookshelf');
    await symlink(outsidePath, escapePath);

    await expect(authorizeBackupFile(undefined, outsidePath)).rejects.toThrow('not configured');
    await expect(authorizeBackupFile(importRoot, outsidePath)).rejects.toThrow('outside the configured migration import root');
    await expect(authorizeBackupFile(importRoot, escapePath)).rejects.toThrow('outside the configured migration import root');
  });

  it('keeps authorized reads bound to the opened file after the request path is replaced', async () => {
    const backupPath = join(importRoot, 'bound.audiobookshelf');
    const movedPath = join(importRoot, 'moved.audiobookshelf');
    await writeFile(backupPath, 'original');
    const authorized = await authorizeBackupFile(importRoot, backupPath);

    await rename(backupPath, movedPath);
    await writeFile(backupPath, 'replacement');
    const content = Buffer.alloc(authorized.size);
    await authorized.handle.read(content, 0, content.length, 0);

    expect(content.toString()).toBe('original');
    await authorized.handle.close();
  });
});

interface BackupOptions {
  details?: string | Buffer;
  duplicateDetails?: boolean;
}

async function createBackup(
  root: string,
  filename: string,
  createDatabase: (databasePath: string) => void,
  options: BackupOptions = {},
): Promise<string> {
  const databasePath = join(root, `${filename}.sqlite`);
  const backupPath = join(root, filename);
  createDatabase(databasePath);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(backupPath, { mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 1 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(options.details ?? DETAILS, { name: 'details' });
    if (options.duplicateDetails) archive.append(DETAILS, { name: 'details' });
    archive.file(databasePath, { name: 'absdatabase.sqlite' });
    archive.append('ignored', { name: 'metadata-items/item.json' });
    void archive.finalize();
  });

  await rm(databasePath, { force: true });
  return backupPath;
}

function createCompleteDatabase(path: string): void {
  createRequiredDatabase(path);
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT, lastFirst TEXT, description TEXT);
    CREATE TABLE bookAuthors (id TEXT PRIMARY KEY, bookId TEXT, authorId TEXT, createdAt TEXT);
    CREATE TABLE series (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE bookSeries (id TEXT PRIMARY KEY, bookId TEXT, seriesId TEXT, sequence TEXT, createdAt TEXT);
    CREATE TABLE playbackSessions (
      id TEXT PRIMARY KEY, mediaItemId TEXT, mediaItemType TEXT, duration REAL, startTime REAL, currentTime REAL,
      timeListening INTEGER, userId TEXT, extraData TEXT, createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE libraryFolders (id TEXT PRIMARY KEY, libraryId TEXT, path TEXT);
  `);
  database.prepare('INSERT INTO authors VALUES (?, ?, ?, ?)').run('author-1', 'Ada Author', 'Author, Ada', 'Bio');
  database.prepare('INSERT INTO bookAuthors VALUES (?, ?, ?, ?)').run('book-author-1', 'book-1', 'author-1', '2026-01-01');
  database.prepare('INSERT INTO series VALUES (?, ?)').run('series-1', 'Examples');
  database.prepare('INSERT INTO bookSeries VALUES (?, ?, ?, ?, ?)').run('book-series-1', 'book-1', 'series-1', '2', '2026-01-01');
  database
    .prepare('INSERT INTO playbackSessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('session-1', 'book-1', 'book', 120, 30, 60, 30, 'user-1', JSON.stringify({ libraryItemId: 'item-1' }), '2026-08-01', '2026-08-01T00:00:30Z');
  database.prepare('INSERT INTO libraryFolders VALUES (?, ?, ?)').run('folder-1', 'library-1', '/audiobooks');
  database.close();
}

function createRequiredDatabase(path: string, options: { userBookmarks?: string; audioFiles?: string } = {}): void {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT, email TEXT, pash TEXT, token TEXT, isActive INTEGER, bookmarks TEXT
    );
    CREATE TABLE libraryItems (
      id TEXT PRIMARY KEY, libraryId TEXT, libraryFolderId TEXT, path TEXT, relPath TEXT, mediaType TEXT, mediaId TEXT
    );
    CREATE TABLE books (
      id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, publishedYear TEXT, publisher TEXT, description TEXT, isbn TEXT,
      asin TEXT, language TEXT, abridged INTEGER, duration REAL, narrators TEXT, audioFiles TEXT, ebookFile TEXT,
      tags TEXT, genres TEXT
    );
    CREATE TABLE mediaProgresses (
      id TEXT PRIMARY KEY, mediaItemId TEXT, mediaItemType TEXT, duration REAL, currentTime REAL, isFinished INTEGER,
      ebookLocation TEXT, ebookProgress REAL, finishedAt TEXT, extraData TEXT, userId TEXT, createdAt TEXT, updatedAt TEXT
    );
  `);
  const bookmarks =
    options.userBookmarks ?? JSON.stringify([{ libraryItemId: 'item-1', time: 42, title: 'A bookmark', createdAt: '2026-08-01T00:00:00.000Z' }]);
  database
    .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('user-1', 'reader', 'reader@example.com', 'password-hash', 'source-api-token', 1, bookmarks);
  database
    .prepare('INSERT INTO libraryItems VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('item-1', 'library-1', 'folder-1', '/audiobooks/Example', 'Example', 'book', 'book-1');
  const audioFiles =
    options.audioFiles ??
    JSON.stringify([
      {
        ino: '101',
        index: 0,
        format: 'mp3',
        duration: 120,
        metadata: { path: '/audiobooks/Example/track.mp3', relPath: 'track.mp3', filename: 'track.mp3', ext: '.mp3' },
      },
    ]);
  const ebookFile = JSON.stringify({
    ino: '102',
    ebookFormat: 'epub',
    metadata: { path: '/audiobooks/Example/book.epub', relPath: 'book.epub', filename: 'book.epub', ext: '.epub' },
  });
  database
    .prepare('INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      'book-1',
      'Example Book',
      'A subtitle',
      '2026',
      'Publisher',
      'Description',
      '9781234567890',
      'B012345678',
      'en',
      0,
      120,
      JSON.stringify(['Nora Narrator']),
      audioFiles,
      ebookFile,
      JSON.stringify(['favorite']),
      JSON.stringify(['Fiction']),
    );
  database
    .prepare('INSERT INTO mediaProgresses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      'progress-1',
      'book-1',
      'book',
      120,
      60,
      0,
      'epubcfi(/6/2)',
      0.5,
      null,
      JSON.stringify({ libraryItemId: 'item-1', progress: 0.5 }),
      'user-1',
      '2026-08-01T00:00:00Z',
      '2026-08-02T00:00:00Z',
    );
  database.close();
}
