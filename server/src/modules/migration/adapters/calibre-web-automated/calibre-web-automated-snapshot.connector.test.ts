import { appendFile, chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  authorizeCalibreWebAutomatedSnapshotFile,
  CalibreWebAutomatedSnapshotConnector,
  copyAuthorizedCalibreWebAutomatedSnapshotFile,
} from './calibre-web-automated-snapshot.connector';

const FIXTURE_ROOT = join(process.cwd(), 'src/modules/migration/adapters/calibre-web-automated/test-fixtures');

describe('CalibreWebAutomatedSnapshotConnector', () => {
  let importRoot: string;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-cwa-snapshot-test-'));
    importRoot = join(testRoot, 'imports');
    await mkdir(importRoot, { mode: 0o700 });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('reads allowlisted typed records from a v4.0.6-shaped stopped snapshot pair', async () => {
    const pair = await createCompatiblePair(importRoot);
    withDatabase(pair.appDatabasePath, (database) => {
      database.exec(`
        CREATE TABLE oauth_credentials (id INTEGER PRIMARY KEY, access_token TEXT);
        INSERT INTO oauth_credentials VALUES (1, 'oauth-secret');
        CREATE TABLE user_session (id INTEGER PRIMARY KEY, session_secret TEXT);
        INSERT INTO user_session VALUES (1, 'session-secret');
      `);
    });
    const connector = makeConnector(importRoot);

    const records = await connector.fetchSourceRecords(configFor(pair));

    expect(records.sourceVersion).toBeNull();
    expect(records.compatibilityWarnings).toEqual(['Schema compatibility was verified against Calibre-Web Automated v4.0.6']);
    expect(records.capabilities).toEqual({
      settings: true,
      authors: true,
      publishers: true,
      languages: true,
      series: true,
      ratings: true,
      comments: true,
      tags: true,
      identifiers: true,
      userBookStatuses: true,
      webProgress: true,
      koboProgress: true,
      koreaderProgress: true,
      shelves: true,
    });
    expect(records.settings).toEqual([{ id: 1, calibreDirectory: '/calibre-library', splitLibrary: false, splitDirectory: null }]);
    expect(records.users).toEqual([{ id: 1, name: 'reader', email: 'reader@example.com', role: 1 }]);
    expect(records.books).toEqual([
      {
        id: 10,
        title: 'Example Book',
        pubdate: '2026-01-02T00:00:00Z',
        seriesIndex: 2,
        authorSort: 'Author, Ada',
        path: 'Ada Author/Example Book (10)',
      },
    ]);
    expect(records.files).toEqual([{ id: 100, bookId: 10, format: 'EPUB', name: 'Example Book' }]);
    expect(records.authorLinks).toEqual([{ id: 1000, bookId: 10, authorId: 20, name: 'Ada Author', sort: 'Author, Ada' }]);
    expect(records.statuses).toEqual([expect.objectContaining({ id: 200, userId: 1, bookId: 10, readStatus: 2 })]);
    expect(records.webProgress).toEqual([expect.objectContaining({ id: 201, userId: 1, bookId: 10, format: 'EPUB' })]);
    expect(records.koboBookmarks).toEqual([expect.objectContaining({ id: 203, readingStateId: 202, progressPercent: 42 })]);
    expect(records.koreaderProgress).toEqual([expect.objectContaining({ id: 204, userId: 1, document: 'partial-checksum', percentage: 43 })]);
    expect(records.shelfBooks).toEqual([{ id: 206, bookId: 10, shelfId: 205, position: 3 }]);
    expect(JSON.stringify(records)).not.toContain('password-secret');
    expect(JSON.stringify(records)).not.toContain('hardcover-secret');
    expect(JSON.stringify(records)).not.toContain('mail-secret');
    expect(JSON.stringify(records)).not.toContain('oauth-secret');
    expect(JSON.stringify(records)).not.toContain('session-secret');
  });

  it('continues with reduced capabilities when optional tables or columns are missing', async () => {
    const pair = await createMinimalPair(importRoot, { cwaSignature: false });
    const connector = makeConnector(importRoot);

    const records = await connector.fetchSourceRecords(configFor(pair));

    expect(records.users).toHaveLength(1);
    expect(records.books).toHaveLength(1);
    expect(Object.values(records.capabilities).every((available) => available === false)).toBe(true);
    expect(records.compatibilityWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('No Calibre-Web Automated schema signatures were found'),
        expect.stringContaining('table bookmark is missing'),
        expect.stringContaining('table books_authors_link is missing'),
      ]),
    );
  });

  it('supports settings schemas without optional split-library columns', async () => {
    const pair = await createMinimalPair(importRoot, { cwaSignature: true, settings: true });
    const connector = makeConnector(importRoot);

    const records = await connector.fetchSourceRecords(configFor(pair));

    expect(records.capabilities.settings).toBe(true);
    expect(records.settings).toEqual([{ id: 1, calibreDirectory: '/calibre-library', splitLibrary: false, splitDirectory: null }]);
  });

  it('disables an optional domain when its table is present with incompatible columns', async () => {
    const pair = await createMinimalPair(importRoot, { cwaSignature: true });
    withDatabase(pair.appDatabasePath, (database) => database.exec('CREATE TABLE bookmark (id INTEGER PRIMARY KEY, user_id INTEGER)'));
    const connector = makeConnector(importRoot);

    const records = await connector.fetchSourceRecords(configFor(pair));

    expect(records.capabilities.webProgress).toBe(false);
    expect(records.compatibilityWarnings).toContain('Compatible web progress data is unavailable because table bookmark is missing required columns');
  });

  it('rejects malformed, reversed, and core-schema-incompatible database pairs', async () => {
    const compatible = await createCompatiblePair(importRoot, 'valid');
    const malformedPath = join(importRoot, 'malformed.db');
    await writeFile(malformedPath, 'not sqlite');
    const missingPath = join(importRoot, 'missing.db');
    withDatabase(missingPath, (database) =>
      database.exec(`
        CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT);
        CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER, format TEXT, name TEXT);
      `),
    );
    const connector = makeConnector(importRoot);

    await expect(
      connector.fetchSourceRecords({
        mode: 'snapshot',
        appDatabasePath: malformedPath,
        metadataDatabasePath: compatible.metadataDatabasePath,
      }),
    ).rejects.toThrow('integrity check');
    await expect(
      connector.fetchSourceRecords({
        mode: 'snapshot',
        appDatabasePath: compatible.metadataDatabasePath,
        metadataDatabasePath: compatible.appDatabasePath,
      }),
    ).rejects.toThrow('appear to be reversed');
    await expect(
      connector.fetchSourceRecords({
        mode: 'snapshot',
        appDatabasePath: compatible.appDatabasePath,
        metadataDatabasePath: missingPath,
      }),
    ).rejects.toThrow('metadata.db table books is missing required columns');
  });

  it('rejects a structurally corrupt database during the bounded integrity check and cleans its copies', async () => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('bookorbit-cwa-migration-')));
    const pair = await createCompatiblePair(importRoot);
    withDatabase(pair.metadataDatabasePath, (database) => {
      database.exec(`
        PRAGMA writable_schema = ON;
        UPDATE sqlite_schema SET rootpage = 999999 WHERE name = 'books';
        PRAGMA writable_schema = OFF;
      `);
    });
    const connector = makeConnector(importRoot);

    await expect(connector.fetchSourceRecords(configFor(pair))).rejects.toThrow('integrity check');

    const leaked = (await readdir(tmpdir())).filter((name) => name.startsWith('bookorbit-cwa-migration-') && !before.has(name));
    expect(leaked).toEqual([]);
  });

  it('supports Node 24 runtimes without DatabaseSync.enableDefensive', async () => {
    const pair = await createCompatiblePair(importRoot);
    const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'enableDefensive');
    Object.defineProperty(DatabaseSync.prototype, 'enableDefensive', { ...descriptor, configurable: true, value: undefined });
    try {
      await expect(makeConnector(importRoot).fetchSourceRecords(configFor(pair))).resolves.toMatchObject({
        books: [expect.objectContaining({ id: 10 })],
      });
    } finally {
      if (descriptor) Object.defineProperty(DatabaseSync.prototype, 'enableDefensive', descriptor);
      else delete (DatabaseSync.prototype as unknown as { enableDefensive?: unknown }).enableDefensive;
    }
  });

  it('uses keyset pagination for tens of thousands of rows', async () => {
    const pair = await createMinimalPair(importRoot, { cwaSignature: true });
    withDatabase(pair.metadataDatabasePath, (database) => {
      const insert = database.prepare('INSERT INTO books (id, title, pubdate, series_index, author_sort, path) VALUES (?, ?, NULL, 1, NULL, ?)');
      database.exec('BEGIN');
      for (let id = 2; id <= 25_001; id += 1) insert.run(id, `Book ${id}`, `books/${id}`);
      database.exec('COMMIT');
    });
    const connector = makeConnector(importRoot);

    const records = await connector.fetchSourceRecords(configFor(pair));

    expect(records.books).toHaveLength(25_001);
    expect(records.books[25_000].id).toBe(25_001);
  });

  it('summarizes malformed scalar values and impossible foreign keys by category', async () => {
    const pair = await createCompatiblePair(importRoot);
    withDatabase(pair.appDatabasePath, (database) => {
      database.exec('PRAGMA foreign_keys = OFF');
      database.prepare('INSERT INTO bookmark (id, user_id, book_id, format, bookmark_key) VALUES (?, ?, ?, ?, ?)').run(300, 999, 10, 'EPUB', 'cfi');
      database.prepare('INSERT INTO book_read_link VALUES (?, ?, ?, ?, ?, ?, ?)').run(301, 10, 1, 2, 'not-a-date', null, 1);
    });
    withDatabase(pair.metadataDatabasePath, (database) => {
      database.exec('PRAGMA foreign_keys = OFF');
      database.prepare('INSERT INTO data VALUES (?, ?, ?, ?, ?)').run(999, 999, 'EPUB', 1, 'Orphan');
    });
    const connector = makeConnector(importRoot);

    const records = await connector.fetchSourceRecords(configFor(pair));

    expect(records.warnings).toEqual(
      expect.arrayContaining([
        { category: 'orphaned_file', count: 1 },
        { category: 'orphaned_web_progress', count: 1 },
        { category: 'invalid_status_date', count: 1 },
      ]),
    );
  });

  it('does not execute untrusted schema objects or mutate the source databases', async () => {
    const pair = await createCompatiblePair(importRoot);
    withDatabase(pair.metadataDatabasePath, (database) => {
      database.exec("CREATE VIEW unsafe_view AS SELECT load_extension('/tmp/not-allowed') AS value");
    });
    const before = await stat(pair.metadataDatabasePath);
    const connector = makeConnector(importRoot);

    await expect(connector.fetchSourceRecords(configFor(pair))).resolves.toMatchObject({ books: [expect.objectContaining({ id: 10 })] });

    const after = await stat(pair.metadataDatabasePath);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('cleans private snapshot copies after success and schema failure', async () => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('bookorbit-cwa-migration-')));
    const pair = await createCompatiblePair(importRoot);
    const connector = makeConnector(importRoot);

    await connector.fetchSourceRecords(configFor(pair));
    withDatabase(pair.metadataDatabasePath, (database) => database.exec('DROP TABLE data'));
    await expect(connector.fetchSourceRecords(configFor(pair))).rejects.toThrow('missing required tables');

    const leaked = (await readdir(tmpdir())).filter((name) => name.startsWith('bookorbit-cwa-migration-') && !before.has(name));
    expect(leaked).toEqual([]);
  });

  it('requires a configured root and rejects outside, sibling-prefix, symlink, and non-regular paths', async () => {
    const filePath = join(importRoot, 'app.db');
    const outsidePath = join(testRoot, 'outside.db');
    const siblingRoot = `${importRoot}-sibling`;
    await writeFile(filePath, 'inside');
    await writeFile(outsidePath, 'outside');
    await mkdir(siblingRoot);
    const siblingPath = join(siblingRoot, 'outside.db');
    await writeFile(siblingPath, 'sibling');
    const finalSymlink = join(importRoot, 'final-link.db');
    await symlink(filePath, finalSymlink);
    const intermediateLink = join(importRoot, 'linked-directory');
    await symlink(testRoot, intermediateLink);

    await expect(authorizeCalibreWebAutomatedSnapshotFile(undefined, filePath)).rejects.toThrow('not configured');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, outsidePath)).rejects.toThrow('outside the configured migration import root');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, siblingPath)).rejects.toThrow('outside the configured migration import root');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, finalSymlink)).rejects.toThrow('opened safely');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, join(intermediateLink, 'outside.db'))).rejects.toThrow(
      'outside the configured migration import root',
    );
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, importRoot)).rejects.toThrow('regular file');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, outsidePath)).rejects.not.toThrow(outsidePath);
  });

  it('accepts a server-configured symlink root while binding the opened inode', async () => {
    const filePath = join(importRoot, 'app.db');
    const rootLink = join(testRoot, 'configured-import-root');
    await writeFile(filePath, 'inside');
    await symlink(importRoot, rootLink);

    const authorized = await authorizeCalibreWebAutomatedSnapshotFile(rootLink, join(rootLink, 'app.db'));

    await expect(authorized.handle.stat()).resolves.toMatchObject({ size: 6 });
    await authorized.handle.close();
  });

  it('rejects active journals, WAL files, and symlinked sidecars', async () => {
    const databasePath = join(importRoot, 'app.db');
    await writeFile(databasePath, 'database');
    await writeFile(`${databasePath}-journal`, 'journal');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, databasePath)).rejects.toThrow('active SQLite journal');

    await rm(`${databasePath}-journal`);
    await writeFile(`${databasePath}-wal`, 'wal');
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, databasePath)).rejects.toThrow('active SQLite journal');

    await rm(`${databasePath}-wal`);
    await symlink(databasePath, `${databasePath}-wal`);
    await expect(authorizeCalibreWebAutomatedSnapshotFile(importRoot, databasePath)).rejects.toThrow('unsafe SQLite sidecar');
  });

  it('rejects two paths that resolve to the same inode', async () => {
    const pair = await createCompatiblePair(importRoot);
    const aliasPath = join(importRoot, 'metadata-alias.db');
    await rm(pair.metadataDatabasePath);
    await link(pair.appDatabasePath, aliasPath);
    const connector = makeConnector(importRoot);

    await expect(
      connector.fetchSourceRecords({
        mode: 'snapshot',
        appDatabasePath: pair.appDatabasePath,
        metadataDatabasePath: aliasPath,
      }),
    ).rejects.toThrow('different database files');
  });

  it('keeps reads bound to the opened inode and creates owner-only bounded copies', async () => {
    const originalPath = join(importRoot, 'snapshot.db');
    const movedPath = join(importRoot, 'moved.db');
    const copyPath = join(testRoot, 'copy.db');
    await writeFile(originalPath, 'original', { mode: 0o600 });
    const authorized = await authorizeCalibreWebAutomatedSnapshotFile(importRoot, originalPath);
    await rename(originalPath, movedPath);
    await writeFile(originalPath, 'replacement');

    await copyAuthorizedCalibreWebAutomatedSnapshotFile(authorized, copyPath, 64);

    expect(await readFile(copyPath, 'utf8')).toBe('original');
    expect((await stat(copyPath)).mode & 0o777).toBe(0o600);
    await authorized.handle.close();
  });

  it('enforces the streaming size limit when a source grows after authorization', async () => {
    const sourcePath = join(importRoot, 'growing.db');
    const copyPath = join(testRoot, 'copy.db');
    await writeFile(sourcePath, Buffer.alloc(32, 1));
    const authorized = await authorizeCalibreWebAutomatedSnapshotFile(importRoot, sourcePath);
    await appendFile(sourcePath, Buffer.alloc(64, 2));

    await expect(copyAuthorizedCalibreWebAutomatedSnapshotFile(authorized, copyPath, 64)).rejects.toThrow('exceeds the allowed size');

    await authorized.handle.close();
  });
});

interface SnapshotPair {
  appDatabasePath: string;
  metadataDatabasePath: string;
}

function makeConnector(root: string): CalibreWebAutomatedSnapshotConnector {
  return new CalibreWebAutomatedSnapshotConnector({ encryptionKey: '', importRoot: root } as never);
}

function configFor(pair: SnapshotPair) {
  return { mode: 'snapshot' as const, ...pair };
}

async function createCompatiblePair(root: string, prefix = 'compatible'): Promise<SnapshotPair> {
  const pair = await createEmptyPair(root, prefix);
  const [appSchema, metadataSchema] = await Promise.all([
    readFile(join(FIXTURE_ROOT, 'cwa-v4.0.6-app-schema.sql'), 'utf8'),
    readFile(join(FIXTURE_ROOT, 'cwa-v4.0.6-metadata-schema.sql'), 'utf8'),
  ]);
  withDatabase(pair.appDatabasePath, (database) => {
    database.exec(appSchema);
    database
      .prepare('INSERT INTO user (id, name, email, role, password, hardcover_token) VALUES (?, ?, ?, ?, ?, ?)')
      .run(1, 'reader', 'reader@example.com', 1, 'password-secret', 'hardcover-secret');
    database
      .prepare('INSERT INTO settings (id, mail_password, config_calibre_dir, config_calibre_split, config_calibre_split_dir) VALUES (?, ?, ?, ?, ?)')
      .run(1, 'mail-secret', '/calibre-library', 0, null);
    database.prepare('INSERT INTO book_read_link VALUES (?, ?, ?, ?, ?, ?, ?)').run(200, 10, 1, 2, '2026-01-03T00:00:00Z', '2026-01-02T00:00:00Z', 1);
    database.prepare('INSERT INTO bookmark VALUES (?, ?, ?, ?, ?)').run(201, 1, 10, 'EPUB', 'epubcfi(/6/2)');
    database.prepare('INSERT INTO kobo_reading_state VALUES (?, ?, ?, ?, ?)').run(202, 1, 10, '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z');
    database
      .prepare('INSERT INTO kobo_bookmark VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(203, 202, '2026-01-04T00:00:00Z', 'body', 'epub', 'epubcfi(/6/4)', 42, 41);
    database
      .prepare('INSERT INTO kosync_progress VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(204, 1, 'partial-checksum', 'epubcfi(/6/6)', 43, 'KOReader', 'device', '2026-01-05T00:00:00Z');
    database.prepare('INSERT INTO shelf (id, name, is_public, user_id) VALUES (?, ?, ?, ?)').run(205, 'Favorites', 0, 1);
    database.prepare('INSERT INTO book_shelf_link (id, book_id, "order", shelf) VALUES (?, ?, ?, ?)').run(206, 10, 3, 205);
  });
  withDatabase(pair.metadataDatabasePath, (database) => {
    database.exec(metadataSchema);
    database
      .prepare('INSERT INTO books (id, title, pubdate, series_index, author_sort, path) VALUES (?, ?, ?, ?, ?, ?)')
      .run(10, 'Example Book', '2026-01-02T00:00:00Z', 2, 'Author, Ada', 'Ada Author/Example Book (10)');
    database.prepare('INSERT INTO data VALUES (?, ?, ?, ?, ?)').run(100, 10, 'EPUB', 1234, 'Example Book');
    database.prepare('INSERT INTO authors VALUES (?, ?, ?, ?)').run(20, 'Ada Author', 'Author, Ada', '');
    database.prepare('INSERT INTO books_authors_link VALUES (?, ?, ?)').run(1000, 10, 20);
    database.prepare('INSERT INTO publishers VALUES (?, ?, ?)').run(21, 'Example Press', 'Example Press');
    database.prepare('INSERT INTO books_publishers_link VALUES (?, ?, ?)').run(1001, 10, 21);
    database.prepare('INSERT INTO languages VALUES (?, ?)').run(22, 'eng');
    database.prepare('INSERT INTO books_languages_link VALUES (?, ?, ?, ?)').run(1002, 10, 22, 0);
    database.prepare('INSERT INTO series VALUES (?, ?, ?)').run(23, 'Examples', 'Examples');
    database.prepare('INSERT INTO books_series_link VALUES (?, ?, ?)').run(1003, 10, 23);
    database.prepare('INSERT INTO ratings VALUES (?, ?)').run(24, 8);
    database.prepare('INSERT INTO books_ratings_link VALUES (?, ?, ?)').run(1004, 10, 24);
    database.prepare('INSERT INTO comments VALUES (?, ?, ?)').run(25, 10, 'Description');
    database.prepare('INSERT INTO tags VALUES (?, ?)').run(26, 'Fiction');
    database.prepare('INSERT INTO books_tags_link VALUES (?, ?, ?)').run(1005, 10, 26);
    database.prepare('INSERT INTO identifiers VALUES (?, ?, ?, ?)').run(27, 10, 'isbn', '9780000000002');
    database
      .prepare('INSERT INTO book_format_checksums (id, book, format, checksum, version, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(28, 10, 'EPUB', 'partial-checksum', 'koreader', '2026-01-01T00:00:00Z');
  });
  return pair;
}

async function createMinimalPair(root: string, options: { cwaSignature: boolean; settings?: boolean }): Promise<SnapshotPair> {
  const pair = await createEmptyPair(root, 'minimal');
  withDatabase(pair.appDatabasePath, (database) => {
    database.exec(`
      CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role INTEGER${options.cwaSignature ? ', hardcover_token TEXT' : ''});
      ${options.settings ? 'CREATE TABLE settings (id INTEGER PRIMARY KEY, config_calibre_dir TEXT);' : ''}
    `);
    database.prepare('INSERT INTO user (id, name, email, role) VALUES (?, ?, ?, ?)').run(1, 'reader', null, 1);
    if (options.settings) database.prepare('INSERT INTO settings VALUES (?, ?)').run(1, '/calibre-library');
  });
  withDatabase(pair.metadataDatabasePath, (database) => {
    database.exec(`
      CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, pubdate TEXT, series_index REAL, author_sort TEXT, path TEXT);
      CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER, format TEXT, name TEXT);
    `);
    database.prepare('INSERT INTO books VALUES (?, ?, ?, ?, ?, ?)').run(1, 'Book One', null, 1, null, 'books/1');
  });
  return pair;
}

async function createEmptyPair(root: string, prefix: string): Promise<SnapshotPair> {
  const appDatabasePath = join(root, `${prefix}-app.db`);
  const metadataDatabasePath = join(root, `${prefix}-metadata.db`);
  withDatabase(appDatabasePath, () => undefined);
  withDatabase(metadataDatabasePath, () => undefined);
  await chmod(appDatabasePath, 0o600);
  await chmod(metadataDatabasePath, 0o600);
  return { appDatabasePath, metadataDatabasePath };
}

function withDatabase(path: string, callback: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(path);
  try {
    callback(database);
  } finally {
    database.close();
  }
}
