import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { exchangeDeviceId } from '../src/modules/koreader/koreader-exchange-device';
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
  sidecarState?: 'known' | 'new';
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

  async function exchange(books: ExchangeBookPayload[], deviceId = DEVICE_ID, extra: Record<string, unknown> = {}) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange',
      headers: deviceHeaders(),
      payload: { deviceId, deviceModel: 'E2E', pluginVersion: '0.4.0', books, ...extra },
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

    // A successful conversion is delivered in the same manual exchange.
    const first = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    const add = first.results[0].toApply.add.find((entry) => entry.serverId === webAnnotationId);
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

    const restored = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/annotations/${deviceRow.id}/restore`,
      headers: authHeader(ctx.adminToken),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().id).toBe(deviceRow.id);

    const restoredPull = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }]);
    expect(restoredPull.results[0].applied.deviceDeleted).toBe(0);
    const restoredAdd = restoredPull.results[0].toApply.add.find((entry) => entry.serverId === deviceRow.id);
    expect(restoredAdd).toBeDefined();
    expect(restoredPull.results[0].toApply.edit.some((entry) => entry.serverId === deviceRow.id)).toBe(false);

    await exchangeAck([
      {
        hash: fileHash,
        applied: [
          {
            serverId: restoredAdd!.serverId,
            version: restoredAdd!.version,
            status: 'applied',
            verified: true,
            pos0: restoredAdd!.pos0,
            pos1: restoredAdd!.pos1,
          },
        ],
        deleted: [],
      },
    ]);
    const repeated = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    expect(repeated.results[0].toApply.add.some((entry) => entry.serverId === deviceRow.id)).toBe(false);

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/annotations/${deviceRow.id}`,
      headers: authHeader(ctx.adminToken),
    });
    const unackedDelete = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }]);
    expect(unackedDelete.results[0].toApply.delete.some((entry) => entry.serverId === deviceRow.id)).toBe(true);
    await ctx.app.inject({ method: 'POST', url: `/api/v1/annotations/${deviceRow.id}/restore`, headers: authHeader(ctx.adminToken) });
    const afterLostAck = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }]);
    expect(afterLostAck.results[0].applied.deviceDeleted).toBe(0);
    expect(afterLostAck.results[0].toApply.add.some((entry) => entry.serverId === deviceRow.id)).toBe(true);
  });

  it('gives a re-downloaded copy everything back instead of deleting it, and trusts a known sidecar', async () => {
    const device = 'e2e-redownload';
    for (const color of ['#4ADE80', '#38BDF8']) {
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${epub.bookId}/annotations`,
        headers: authHeader(ctx.adminToken),
        payload: { cfi: FIXTURE_CFI, text: 'fixture', color, style: 'highlight' },
      });
      expect(created.statusCode).toBe(201);
    }

    const ackAll = async (adds: Record<string, unknown>[]) =>
      exchangeAck(
        [
          {
            hash: fileHash,
            applied: adds.map((entry) => ({ serverId: entry.serverId, version: entry.version, status: 'applied', verified: true })),
            deleted: [],
          },
        ],
        device,
      );
    const first = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], device);
    const delivered = first.results[0].toApply.add;
    expect(delivered.length).toBeGreaterThanOrEqual(2);
    await ackAll(delivered);
    const deliveredIds = delivered.map((entry) => entry.serverId as number).sort((a, b) => a - b);

    // An older plugin sends the fresh sidecar's empty list as complete.
    const redownloaded = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }], device);
    expect(redownloaded.results[0].applied.deviceDeleted).toBe(0);
    expect(redownloaded.results[0].toApply.add.map((entry) => entry.serverId as number).sort((a, b) => a - b)).toEqual(deliveredIds);
    const live = await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.bookId, epub.bookId));
    for (const id of deliveredIds) expect(live.find((row) => row.id === id)?.deletedAt).toBeNull();
    await ackAll(redownloaded.results[0].toApply.add);

    // A plugin that says so gets the same, and the device-local clock rides along.
    const reported = await exchange([{ hash: fileHash, keys: [], keysComplete: true, sidecarState: 'new', changes: [] }], device);
    expect(reported.results[0].applied.deviceDeleted).toBe(0);
    expect(reported.results[0].toApply.add).toHaveLength(deliveredIds.length);
    await ackAll(reported.results[0].toApply.add);

    // A device edit time that only restates the stored content changes nothing visible.
    const sample = reported.results[0].toApply.add[0];
    const [before] = await ctx.db
      .select()
      .from(schema.annotations)
      .where(eq(schema.annotations.id, sample.serverId as number));
    const echo = await exchange(
      [
        {
          hash: fileHash,
          keys: [],
          keysComplete: false,
          changes: [
            {
              datetime: sample.datetime,
              datetimeUpdated: '2030-01-01 00:00:00',
              drawer: sample.drawer,
              color: sample.color,
              text: sample.text,
              posFormat: 'xpointer',
              pos0: sample.pos0,
              pos1: sample.pos1,
            },
          ],
        },
      ],
      device,
    );
    expect(echo.results[0].applied.unchanged).toBe(1);
    const [after] = await ctx.db
      .select()
      .from(schema.annotations)
      .where(eq(schema.annotations.id, sample.serverId as number));
    expect(after.version).toBe(before.version);
    expect(after.deviceUpdatedAt).toBe('2030-01-01 00:00:00');
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    // A known sidecar that really lost everything is a real delete.
    const deleted = await exchange([{ hash: fileHash, keys: [], keysComplete: true, sidecarState: 'known', changes: [] }], device);
    expect(deleted.results[0].applied.deviceDeleted).toBe(deliveredIds.length);
    for (const id of deliveredIds) {
      await ctx.app.inject({ method: 'POST', url: `/api/v1/annotations/${id}/restore`, headers: authHeader(ctx.adminToken) });
    }
  });

  it('keeps a web recolor beside a device note change, and sends a note edit that lost back to the device', async () => {
    // The device clock is reported in UTC here, so device strings and server time line up.
    const deviceClock = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, text: 'fixture', color: '#FACC15', style: 'highlight', note: 'merge base' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: number }).id;

    const pull = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], DEVICE_ID, { deviceTime: deviceClock() });
    const add = pull.results[0].toApply.add.find((entry) => entry.serverId === id)!;
    expect(add).toBeDefined();
    await exchangeAck([{ hash: fileHash, applied: [{ serverId: id, version: add.version, status: 'applied', verified: true }], deleted: [] }]);

    // The device changes the note a minute before the web recolors it.
    const deviceEdit = deviceClock(-60_000);
    const recolor = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${epub.bookId}/annotations/${id}`,
      headers: authHeader(ctx.adminToken),
      payload: { color: '#38BDF8' },
    });
    expect(recolor.statusCode).toBe(200);

    const change = (note: string, datetimeUpdated: string) => ({
      datetime: add.datetime,
      datetimeUpdated,
      drawer: 'lighten',
      color: 'yellow',
      text: 'fixture',
      note,
      posFormat: 'xpointer',
      pos0: FIXTURE_XPOINTER_0,
      pos1: FIXTURE_XPOINTER_1,
    });
    const merged = await exchange(
      [{ hash: fileHash, keys: [], keysComplete: false, changes: [change('merge device note', deviceEdit)] }],
      DEVICE_ID,
      { deviceTime: deviceClock() },
    );
    let [row] = await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.id, id));
    expect(row.note).toBe('merge device note');
    expect(row.color).toBe('#38BDF8');
    const recolored = merged.results[0].toApply.edit.find((entry) => entry.serverId === id);
    expect(recolored).toMatchObject({ note: 'merge device note', color: 'blue' });
    await exchangeAck([{ hash: fileHash, applied: [{ serverId: id, version: recolored!.version, status: 'applied', verified: true }], deleted: [] }]);

    // Both change the note while the device is offline; the web's edit is the later one.
    const olderDeviceEdit = deviceClock(-60_000);
    const webNote = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${epub.bookId}/annotations/${id}`,
      headers: authHeader(ctx.adminToken),
      payload: { note: 'merge web note' },
    });
    expect(webNote.statusCode).toBe(200);
    const refused = await exchange(
      [{ hash: fileHash, keys: [], keysComplete: false, changes: [{ ...change('merge refused', olderDeviceEdit), color: 'blue' }] }],
      DEVICE_ID,
      { deviceTime: deviceClock() },
    );
    [row] = await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.id, id));
    expect(row.note).toBe('merge web note');
    expect(refused.results[0].toApply.edit.find((entry) => entry.serverId === id)).toMatchObject({ note: 'merge web note' });
  });

  it('rejects exchange calls without device credentials', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange',
      payload: { deviceId: DEVICE_ID, deviceModel: 'E2E', pluginVersion: '0.4.0', books: [] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('retains and redelivers unverified sidecar annotations missing on reopen, then accepts a verified apply', async () => {
    const device = 'e2e-sidecar-reopen';
    const first = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], device);
    const add = first.results[0].toApply.add[0];
    expect(add).toBeDefined();
    await exchangeAck(
      [
        {
          hash: fileHash,
          applied: [
            {
              serverId: add.serverId,
              version: add.version,
              status: 'applied',
              verified: false,
              pos0: add.pos0,
              pos1: add.pos1,
            },
          ],
          deleted: [],
        },
      ],
      device,
    );

    const reopened = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }], device);
    expect(reopened.results[0].applied.deviceDeleted).toBe(0);
    expect(reopened.results[0].toApply.edit).toEqual([]);
    expect(reopened.results[0].toApply.add).toContainEqual(expect.objectContaining({ serverId: add.serverId, version: add.version }));
    await exchangeAck(
      [
        {
          hash: fileHash,
          applied: [
            {
              serverId: add.serverId,
              version: add.version,
              status: 'applied',
              verified: true,
              pos0: add.pos0,
              pos1: add.pos1,
            },
          ],
          deleted: [],
        },
      ],
      device,
    );
    const applied = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], device);
    expect(applied.results[0].toApply.add.some((entry) => entry.serverId === add.serverId)).toBe(false);
  });

  // D-13: a hub bulk restore kept the device's delete-acked state, so the device's next complete
  // key set (which rightly lacks the row) trashed it again everywhere.
  it('gives a bulk-restored highlight back to a device that deleted it instead of deleting it again', async () => {
    const device = 'e2e-device-0003';
    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color: '#F472B6', style: 'highlight', note: 'bulk restore' },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: number }).id;

    const delivered = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], device);
    const add = delivered.results[0].toApply.add.find((entry) => entry.serverId === id)!;
    expect(add).toBeDefined();
    await exchangeAck(
      [
        {
          hash: fileHash,
          applied: [{ serverId: id, version: add.version, status: 'applied', verified: true, pos0: add.pos0, pos1: add.pos1 }],
          deleted: [],
        },
      ],
      device,
    );

    const trash = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/annotations/${id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(trash.statusCode).toBe(204);
    const removal = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], device);
    expect(removal.results[0].toApply.delete.some((entry) => entry.serverId === id)).toBe(true);
    await exchangeAck([{ hash: fileHash, applied: [], deleted: [{ serverId: id, status: 'applied' }] }], device);

    const bulk = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/annotations/bulk',
      headers: authHeader(ctx.adminToken),
      payload: { action: 'restore', ids: [id] },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toEqual({ affected: 1 });

    const next = await exchange([{ hash: fileHash, keys: [], keysComplete: true, changes: [] }], device);
    expect(next.results[0].applied.deviceDeleted).toBe(0);
    expect(next.results[0].toApply.add.some((entry) => entry.serverId === id)).toBe(true);
    const [row] = await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.id, id));
    expect(row.deletedAt).toBeNull();
  });

  it('removing a device drops its per-book sync rows, so its unacknowledged deletes stop blocking a purge', async () => {
    const REMOVED_DEVICE_ID = 'e2e-device-0003';
    const made = await exchange(
      [
        {
          hash: fileHash,
          keys: [],
          keysComplete: false,
          changes: [
            {
              datetime: '2026-06-03 08:00:00',
              drawer: 'lighten',
              color: 'green',
              text: 'fixture',
              posFormat: 'xpointer',
              pos0: FIXTURE_XPOINTER_0,
              pos1: FIXTURE_XPOINTER_1,
            },
          ],
        },
      ],
      REMOVED_DEVICE_ID,
    );
    expect(made.results[0].applied.created).toBe(1);
    const [row] = await ctx.db
      .select()
      .from(schema.annotations)
      .where(and(eq(schema.annotations.deviceCreatedAt, '2026-06-03 08:00:00'), eq(schema.annotations.bookId, epub.bookId)));
    const renditionId = exchangeDeviceId(REMOVED_DEVICE_ID, fileHash);

    const bookmark = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/bookmarks`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: 'epubcfi(/6/2!/4/2/1:3)', title: 'Removed device dogear' },
    });
    expect(bookmark.statusCode).toBe(201);
    await ctx.db
      .insert(schema.koreaderBookmarkLinks)
      .values({ bookmarkId: (bookmark.json() as { id: number }).id, userId: row.userId, deviceId: renditionId, koreaderKey: 'f'.repeat(32) });

    const trashed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/annotations/${row.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(trashed.statusCode).toBe(204);
    const blocked = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/annotations/${row.id}`, headers: authHeader(ctx.adminToken) });
    expect(blocked.statusCode).toBe(409);

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/koreader/devices/${REMOVED_DEVICE_ID}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(removed.statusCode).toBe(200);

    const leftStates = await ctx.db.select().from(schema.annotationSyncState).where(eq(schema.annotationSyncState.deviceId, renditionId));
    const leftLinks = await ctx.db.select().from(schema.koreaderBookmarkLinks).where(eq(schema.koreaderBookmarkLinks.deviceId, renditionId));
    expect(leftStates).toEqual([]);
    expect(leftLinks).toEqual([]);
    const otherDevices = await ctx.db
      .select()
      .from(schema.annotationSyncState)
      .where(eq(schema.annotationSyncState.deviceId, exchangeDeviceId(DEVICE_ID, fileHash)));
    expect(otherDevices.length).toBeGreaterThan(0);

    const purged = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/annotations/${row.id}`, headers: authHeader(ctx.adminToken) });
    expect(purged.statusCode).toBe(204);
  });

  it('lists a closed book as pending only while something is waiting for the device', async () => {
    const SWEEP_DEVICE_ID = 'e2e-device-0004';
    const pending = async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/koreader/plugin/annotations/pending',
        headers: deviceHeaders(),
        payload: { deviceId: SWEEP_DEVICE_ID, deviceModel: 'E2E', pluginVersion: '0.4.0', hashes: [fileHash.toUpperCase(), 'f'.repeat(32)] },
      });
      expect(response.statusCode).toBe(201);
      return (response.json() as { pending: string[] }).pending;
    };
    const deliverEverything = async () => {
      for (let round = 0; round < 5; round += 1) {
        const pull = await exchange([{ hash: fileHash, keys: [], keysComplete: false, changes: [] }], SWEEP_DEVICE_ID);
        const toApply = pull.results[0].toApply;
        if (toApply.add.length + toApply.edit.length + toApply.delete.length === 0) return;
        const applied = [...toApply.add, ...toApply.edit].map((entry) => ({
          serverId: entry.serverId,
          version: entry.version,
          status: 'applied',
          verified: true,
          pos0: entry.pos0,
          pos1: entry.pos1,
        }));
        const deleted = toApply.delete.map((entry) => ({ serverId: entry.serverId, status: 'applied' }));
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/koreader/plugin/annotations/exchange-ack',
          headers: deviceHeaders(),
          payload: { deviceId: SWEEP_DEVICE_ID, deviceModel: 'E2E', pluginVersion: '0.4.0', books: [{ hash: fileHash, applied, deleted }] },
        });
        expect(response.statusCode).toBe(201);
      }
    };

    expect(await pending()).toEqual([fileHash.toLowerCase()]);
    await deliverEverything();
    expect(await pending()).toEqual([]);

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color: '#4ADE80', style: 'highlight', note: 'made on the web' },
    });
    expect(created.statusCode).toBe(201);
    expect(await pending()).toEqual([fileHash.toLowerCase()]);

    await deliverEverything();
    expect(await pending()).toEqual([]);
  });
});
