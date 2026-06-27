import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';

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

const KOREADER_USERNAME = `exchange-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'ExchangeDevicePass123';
const DEVICE_ID = 'e2e-device-0001';
const OTHER_DEVICE_ID = 'e2e-device-0002';

// The fixture chapter body is exactly <p>fixture</p>.
const FIXTURE_CFI = 'epubcfi(/6/2!/4/2,/1:0,/1:7)';
const FIXTURE_XPOINTER_0 = '/body/DocFragment[1]/body/p/text().0';
const FIXTURE_XPOINTER_1 = '/body/DocFragment[1]/body/p/text().7';

interface ExchangeBookPayload {
  hash: string;
  keys: { k: string; dt: string }[];
  keysComplete: boolean;
  changes: Record<string, unknown>[];
}

describe('KOReader annotation exchange (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let epub!: LocatedBookFile;
  let fileHash!: string;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function exchange(books: ExchangeBookPayload[], deviceId = DEVICE_ID) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange',
      headers: deviceHeaders(),
      payload: { deviceId, deviceModel: 'E2E', pluginVersion: '0.4.0', books },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as {
      results: {
        hash: string;
        bookId: number;
        applied: Record<string, number>;
        toApply: { add: Record<string, unknown>[]; edit: Record<string, unknown>[]; delete: Record<string, unknown>[] };
        more: boolean;
        skippedNoPosition: number;
      }[];
      unmatched: string[];
    };
  }

  async function exchangeAck(books: Record<string, unknown>[], deviceId = DEVICE_ID) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange-ack',
      headers: deviceHeaders(),
      payload: { deviceId, deviceModel: 'E2E', pluginVersion: '0.4.0', books },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { results: { hash: string; acked: number }[]; unmatched: string[] };
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `koreader-exchange-${randomUUID()}` });
    const epubPath = await createEpubFixture(library.folderPath, 'exchange-book.epub', {
      title: `Exchange Book ${randomUUID()}`,
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

  it('ingests device changes, then pushes nothing back to the same device', async () => {
    const first = await exchange([
      {
        hash: fileHash,
        keys: [],
        keysComplete: false,
        changes: [
          {
            datetime: '2026-06-01 10:00:00',
            drawer: 'lighten',
            color: 'yellow',
            text: 'fixture',
            posFormat: 'xpointer',
            pos0: FIXTURE_XPOINTER_0,
            pos1: FIXTURE_XPOINTER_1,
          },
        ],
      },
    ]);

    expect(first.results[0].applied.created).toBe(1);
    expect(first.results[0].toApply.add).toEqual([]);
    expect(first.results[0].toApply.edit).toEqual([]);
    expect(first.results[0].toApply.delete).toEqual([]);

    const annotations = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
    });
    expect(annotations.statusCode).toBe(200);
    expect(annotations.json()).toHaveLength(1);

    const retry = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    expect(retry.results[0].applied.created).toBe(0);
    expect(retry.results[0].toApply.add).toEqual([]);
  });

  it('pushes the device-origin annotation to a second device and acks it', async () => {
    const pull = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], OTHER_DEVICE_ID);
    const add = pull.results[0].toApply.add[0];
    expect(add).toMatchObject({
      datetime: '2026-06-01 10:00:00',
      drawer: 'lighten',
      posFormat: 'xpointer',
      pos0: FIXTURE_XPOINTER_0,
      pos1: FIXTURE_XPOINTER_1,
      text: 'fixture',
    });

    const ack = await exchangeAck(
      [
        {
          hash: fileHash,
          applied: [{ serverId: add.serverId, version: add.version, status: 'applied', verified: true }],
          deleted: [],
        },
      ],
      OTHER_DEVICE_ID,
    );
    expect(ack.results[0].acked).toBe(1);

    const after = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], OTHER_DEVICE_ID);
    expect(after.results[0].toApply.add).toEqual([]);
  });

  it('converts a web annotation and delivers it with a minted datetime, ack-gated', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, text: 'fixture', color: '#FACC15', style: 'squiggly', note: 'from web' },
    });
    expect(created.statusCode).toBe(201);
    const webAnnotationId = (created.json() as { id: number }).id;

    // First exchange spends the conversion budget and defers the entry.
    const first = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    expect(first.results[0].toApply.add).toEqual([]);

    const second = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    const add = second.results[0].toApply.add.find((entry) => entry.serverId === webAnnotationId);
    expect(add).toBeDefined();
    expect(add).toMatchObject({
      drawer: 'underscore',
      color: 'yellow',
      text: 'fixture',
      note: 'from web',
      posFormat: 'xpointer',
      pos0: FIXTURE_XPOINTER_0,
      pos1: FIXTURE_XPOINTER_1,
    });
    expect(add!.datetime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // Idempotent retry before ack: the same entry comes back.
    const retry = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    const retryAdd = retry.results[0].toApply.add.find((entry) => entry.serverId === webAnnotationId);
    expect(retryAdd?.datetime).toBe(add!.datetime);

    const ack = await exchangeAck([
      {
        hash: fileHash,
        applied: [{ serverId: webAnnotationId, version: add!.version, status: 'applied', verified: true }],
        deleted: [],
      },
    ]);
    expect(ack.results[0].acked).toBe(1);

    const after = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    expect(after.results[0].toApply.add.find((entry) => entry.serverId === webAnnotationId)).toBeUndefined();

    // The device echoing the applied annotation back must not duplicate or bump anything.
    const echo = await exchange([
      {
        hash: fileHash,
        keys: [],
        keysComplete: false,
        changes: [
          {
            datetime: add!.datetime,
            drawer: 'underscore',
            color: 'yellow',
            text: 'fixture',
            note: 'from web',
            posFormat: 'xpointer',
            pos0: FIXTURE_XPOINTER_0,
            pos1: FIXTURE_XPOINTER_1,
          },
        ],
      },
    ]);
    expect(echo.results[0].applied.created).toBe(0);
    expect(echo.results[0].applied.unchanged).toBe(1);

    const [row] = await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.id, webAnnotationId));
    expect(row.style).toBe('squiggly');
    expect(row.color).toBe('#FACC15');
  });

  it('propagates a web deletion to the device and detects device deletions', async () => {
    const listBefore = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
    });
    const webAnnotation = (listBefore.json() as { id: number; note: string | null }[]).find((entry) => entry.note === 'from web');
    expect(webAnnotation).toBeDefined();

    const deletion = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/annotations/${webAnnotation!.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(deletion.statusCode).toBe(204);

    const pull = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    const deleteEntry = pull.results[0].toApply.delete.find((entry) => entry.serverId === webAnnotation!.id);
    expect(deleteEntry).toBeDefined();

    const ack = await exchangeAck([{ hash: fileHash, applied: [], deleted: [{ serverId: webAnnotation!.id, status: 'applied' }] }]);
    expect(ack.results[0].acked).toBe(1);

    // Device-side deletion: the device reports a complete key set missing the
    // device-origin annotation from the first test.
    const detect = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }]);
    expect(detect.results[0].applied.deviceDeleted).toBe(1);

    const [deviceRow] = await ctx.db
      .select()
      .from(schema.annotations)
      .where(and(eq(schema.annotations.deviceCreatedAt, '2026-06-01 10:00:00'), eq(schema.annotations.bookId, epub.bookId)));
    expect(deviceRow.deletedAt).not.toBeNull();
  });

  it('rejects exchange calls without device credentials', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange',
      payload: { deviceId: DEVICE_ID, deviceModel: 'E2E', pluginVersion: '0.4.0', books: [] },
    });
    expect(response.statusCode).toBe(401);
  });
});
