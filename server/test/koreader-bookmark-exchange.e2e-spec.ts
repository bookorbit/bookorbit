import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

const KOREADER_USERNAME = `bookmark-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'BookmarkDevicePass123';
const DEVICE_ID = 'e2e-bm-device-0001';
const OTHER_DEVICE_ID = 'e2e-bm-device-0002';

// The fixture chapter body is exactly <p>fixture</p>.
const FIXTURE_XPOINTER = '/body/DocFragment[1]/body/p/text().0';
const WEB_POINT_CFI = 'epubcfi(/6/2!/4/2/1:3)';

interface BookmarkBookPayload {
  hash: string;
  keys: { k: string; dt: string }[];
  keysComplete: boolean;
  changes: Record<string, unknown>[];
}

interface BookmarkExchangeResult {
  hash: string;
  bookId: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  deviceDeleted: number;
  toApply: {
    add: { serverId: number; pos: string; pageno: number | null; title: string }[];
    delete: { serverId: number; key: string; datetime: string | null }[];
  };
  more: boolean;
  skippedConversion: number;
}

interface WebBookmark {
  id: number;
  cfi: string | null;
  title: string;
}

describe('KOReader bookmark exchange (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let epub!: LocatedBookFile;
  let fileHash!: string;

  let deviceBookmarkId!: number;
  let deviceBookmarkKey!: string;
  let webBookmarkId!: number;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function exchange(books: BookmarkBookPayload[], deviceId = DEVICE_ID) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/bookmarks/exchange',
      headers: deviceHeaders(),
      payload: { deviceId, deviceModel: 'E2E', pluginVersion: '0.5.0', books },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { results: BookmarkExchangeResult[]; unmatched: string[] };
  }

  async function exchangeAck(books: Record<string, unknown>[], deviceId = DEVICE_ID) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/bookmarks/exchange-ack',
      headers: deviceHeaders(),
      payload: { deviceId, deviceModel: 'E2E', pluginVersion: '0.5.0', books },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { results: { hash: string; acked: number }[]; unmatched: string[] };
  }

  function pull(deviceId = DEVICE_ID) {
    return exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], deviceId);
  }

  async function listWebBookmarks(): Promise<WebBookmark[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${epub.bookId}/bookmarks`,
      headers: authHeader(ctx.adminToken),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as WebBookmark[];
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `koreader-bookmark-${randomUUID()}` });
    const epubPath = await createEpubFixture(library.folderPath, 'bookmark-book.epub', {
      title: `Bookmark Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    epub = await locateBookByAbsolutePath(ctx, epubPath);

    const [fileRow] = await ctx.db
      .select({ fileHash: schema.bookFiles.fileHash })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, epub.bookFileId));
    expect(fileRow?.fileHash).toBeTruthy();
    fileHash = fileRow!.fileHash!;

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(ctx.adminToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    if (credentials.statusCode === 409) {
      const updated = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/koreader/credentials',
        headers: authHeader(ctx.adminToken),
        payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
      });
      expect(updated.statusCode).toBe(200);
    } else {
      expect([200, 201]).toContain(credentials.statusCode);
    }
  }, 120_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('advertises the bookmarkSync capability the plugin gates on', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/koreader/plugin/version',
      headers: deviceHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { capabilities: string[] }).capabilities).toContain('bookmarkSync');
  });

  it('converts a device dogear into a web bookmark and pushes nothing back at that device', async () => {
    const first = await exchange([
      {
        hash: fileHash,
        keys: [],
        keysComplete: false,
        changes: [{ datetime: '2026-06-01 10:00:00', pos: FIXTURE_XPOINTER, pageno: 1, chapter: 'Chapter One' }],
      },
    ]);

    expect(first.results[0]).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(first.results[0].toApply.add).toEqual([]);
    expect(first.results[0].toApply.delete).toEqual([]);

    const bookmarks = await listWebBookmarks();
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].title).toBe('Chapter One');
    expect(bookmarks[0].cfi).toMatch(/^epubcfi\(/);
    deviceBookmarkId = bookmarks[0].id;

    const [row] = await ctx.db.select().from(schema.bookmarks).where(eq(schema.bookmarks.id, deviceBookmarkId));
    expect(row.origin).toBe('koreader');
    expect(row.devicePos).toBe(FIXTURE_XPOINTER);
    expect(row.pageno).toBe(1);

    const retry = await pull();
    expect(retry.results[0]).toMatchObject({ accepted: 0, duplicates: 0 });
    expect(retry.results[0].toApply.add).toEqual([]);
  });

  it('rejects a device position that cannot be converted instead of storing a CFI-less row', async () => {
    const result = await exchange([
      {
        hash: fileHash,
        keys: [],
        keysComplete: false,
        changes: [{ datetime: '2026-06-01 10:05:00', pos: '/body/DocFragment[99]/body/p/text().0' }],
      },
    ]);

    expect(result.results[0]).toMatchObject({ accepted: 0, rejected: 1 });
    expect(await listWebBookmarks()).toHaveLength(1);
  });

  it('delivers the device bookmark to a second device at its original position, ack-gated', async () => {
    const pulled = await pull(OTHER_DEVICE_ID);
    const add = pulled.results[0].toApply.add.find((entry) => entry.serverId === deviceBookmarkId);
    expect(add).toBeDefined();
    // Device-originated: the stored xpointer is returned verbatim, not round-tripped through the CFI.
    expect(add).toMatchObject({ pos: FIXTURE_XPOINTER, pageno: 1, title: 'Chapter One' });

    // Idempotent before the ack.
    const retry = await pull(OTHER_DEVICE_ID);
    expect(retry.results[0].toApply.add.find((entry) => entry.serverId === deviceBookmarkId)).toBeDefined();

    const ack = await exchangeAck(
      [
        {
          hash: fileHash,
          applied: [{ serverId: deviceBookmarkId, status: 'applied', datetime: '2026-06-02 08:00:00', pos: FIXTURE_XPOINTER }],
          deleted: [],
        },
      ],
      OTHER_DEVICE_ID,
    );
    expect(ack.results[0].acked).toBe(1);

    const after = await pull(OTHER_DEVICE_ID);
    expect(after.results[0].toApply.add).toEqual([]);
  });

  it('applies a device-side rename without creating a second bookmark', async () => {
    const renamed = await exchange([
      {
        hash: fileHash,
        keys: [],
        keysComplete: false,
        changes: [{ datetime: '2026-06-01 10:00:00', pos: FIXTURE_XPOINTER, pageno: 1, chapter: 'Chapter One', note: 'Remember this' }],
      },
    ]);

    expect(renamed.results[0]).toMatchObject({ accepted: 0, duplicates: 1 });
    const bookmarks = await listWebBookmarks();
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].title).toBe('Remember this');
  });

  it('converts a web bookmark and delivers it to the device, ack-gated', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/bookmarks`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: WEB_POINT_CFI, title: 'Chapter One' },
    });
    expect(created.statusCode).toBe(201);
    webBookmarkId = (created.json() as { id: number }).id;

    const pulled = await pull();
    const add = pulled.results[0].toApply.add.find((entry) => entry.serverId === webBookmarkId);
    expect(add).toBeDefined();
    expect(add!.title).toBe('Chapter One');
    expect(add!.pos).toMatch(/^\/body\/DocFragment\[1\]/);
    expect(pulled.results[0].skippedConversion).toBe(0);

    const ack = await exchangeAck([
      {
        hash: fileHash,
        applied: [{ serverId: webBookmarkId, status: 'applied', datetime: '2026-06-03 09:00:00', pos: add!.pos }],
        deleted: [],
      },
    ]);
    expect(ack.results[0].acked).toBe(1);

    const after = await pull();
    expect(after.results[0].toApply.add.find((entry) => entry.serverId === webBookmarkId)).toBeUndefined();
  });

  it('turns a web delete into a tombstone and propagates it to every linked device', async () => {
    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/bookmarks/${deviceBookmarkId}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(deleted.statusCode).toBe(204);

    // The web no longer lists it, but the row survives so devices can be told.
    expect((await listWebBookmarks()).map((bookmark) => bookmark.id)).not.toContain(deviceBookmarkId);
    const [row] = await ctx.db.select().from(schema.bookmarks).where(eq(schema.bookmarks.id, deviceBookmarkId));
    expect(row.deletedAt).not.toBeNull();

    const pulled = await pull();
    const entry = pulled.results[0].toApply.delete.find((item) => item.serverId === deviceBookmarkId);
    expect(entry).toBeDefined();
    // The device is addressed by the identity it acked with, its only local handle.
    expect(entry!.key).toMatch(/^[0-9a-f]{32}$/);
    expect(entry!.datetime).toBe('2026-06-01 10:00:00');
    deviceBookmarkKey = entry!.key;

    await exchangeAck([{ hash: fileHash, applied: [], deleted: [{ serverId: deviceBookmarkId, status: 'applied' }] }]);
    const afterAck = await pull();
    expect(afterAck.results[0].toApply.delete).toEqual([]);

    // The second device still holds it and learns about the delete on its own schedule.
    const other = await pull(OTHER_DEVICE_ID);
    expect(other.results[0].toApply.delete.find((item) => item.serverId === deviceBookmarkId)).toBeDefined();
    await exchangeAck([{ hash: fileHash, applied: [], deleted: [{ serverId: deviceBookmarkId, status: 'applied' }] }], OTHER_DEVICE_ID);
  });

  it('restores the tombstone when a device re-adds a bookmark at the same position', async () => {
    const restored = await exchange([
      {
        hash: fileHash,
        keys: [],
        keysComplete: false,
        changes: [{ datetime: '2026-06-04 12:00:00', pos: FIXTURE_XPOINTER, pageno: 1, chapter: 'Chapter One' }],
      },
    ]);
    expect(restored.results[0]).toMatchObject({ accepted: 1, rejected: 0 });

    const bookmarks = await listWebBookmarks();
    // The same row came back to life: the unique location index would have refused an insert.
    expect(bookmarks.map((bookmark) => bookmark.id)).toContain(deviceBookmarkId);
    expect(bookmarks.find((bookmark) => bookmark.id === deviceBookmarkId)!.title).toBe('Chapter One');
    expect(deviceBookmarkKey).toMatch(/^[0-9a-f]{32}$/);

    // The second device dropped its link when it acked the earlier delete, so the
    // restored row reaches it as a fresh add. Re-link it, so the next test can
    // prove a deletion on one device still propagates to the other.
    const other = await pull(OTHER_DEVICE_ID);
    const readds = other.results[0].toApply.add;
    expect(readds.map((entry) => entry.serverId)).toEqual(expect.arrayContaining([deviceBookmarkId, webBookmarkId]));
    await exchangeAck(
      [
        {
          hash: fileHash,
          applied: readds.map((entry, index) => ({
            serverId: entry.serverId,
            status: 'applied',
            datetime: `2026-06-05 09:0${index}:00`,
            pos: entry.pos,
          })),
          deleted: [],
        },
      ],
      OTHER_DEVICE_ID,
    );
  });

  it('skips deletion detection when the device could not report a complete key set', async () => {
    const result = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);

    expect(result.results[0].deviceDeleted).toBe(0);
    expect(await listWebBookmarks()).toHaveLength(2);
  });

  it('tombstones bookmarks the device no longer reports once the key set is complete', async () => {
    const result = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }]);

    // Both this device's links are gone from its key set, so both bookmarks are deleted.
    expect(result.results[0].deviceDeleted).toBe(2);
    expect(await listWebBookmarks()).toHaveLength(0);

    // A deletion on one device reaches every other device that still holds the row.
    const other = await pull(OTHER_DEVICE_ID);
    expect(other.results[0].toApply.delete.map((entry) => entry.serverId)).toEqual(expect.arrayContaining([deviceBookmarkId, webBookmarkId]));
    expect(other.results[0].toApply.add).toEqual([]);
  });

  it('reports a hash it cannot resolve as unmatched', async () => {
    const unknownHash = 'f'.repeat(32);
    const result = await exchange([{ hash: unknownHash, keys: [], keysComplete: true, changes: [] }]);

    expect(result.unmatched).toEqual([unknownHash]);
    expect(result.results).toEqual([]);
  });

  it('rejects a malformed payload at the validation boundary', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/bookmarks/exchange',
      headers: deviceHeaders(),
      payload: {
        deviceId: DEVICE_ID,
        deviceModel: 'E2E',
        pluginVersion: '0.5.0',
        books: [{ hash: fileHash, keys: [], keysComplete: true, changes: [{ datetime: 'not-a-datetime', pos: FIXTURE_XPOINTER }] }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an unauthenticated device', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/bookmarks/exchange',
      payload: {
        deviceId: DEVICE_ID,
        deviceModel: 'E2E',
        pluginVersion: '0.5.0',
        books: [{ hash: fileHash, keys: [], keysComplete: false, changes: [] }],
      },
    });
    expect(response.statusCode).toBe(401);
  });
});
