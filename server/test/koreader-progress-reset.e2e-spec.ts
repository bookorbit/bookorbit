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

const KOREADER_USERNAME = `progress-reset-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'ProgressResetPass123';
const XPOINTER = '/body/DocFragment[8]/body/p[12]/text().0';

/**
 * A reset made in BookOrbit has to survive contact with a device that still holds the old
 * position in its sidecar. The device cannot tell the server when it reached that position,
 * only when it sent it, so these cases pin the behaviour that makes the reset win anyway:
 * the pull answers with a position rather than with silence, and a push that predates the
 * reset is recorded without moving the book.
 */
describe('KOReader progress reset propagation (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let epub!: LocatedBookFile;
  let epubHash!: string;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function pushFromDevice(percentage: number, progress = XPOINTER, deviceId = 'reset-device-1') {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: deviceHeaders(),
      payload: { document: epubHash, percentage, progress, device: 'Kobo Libra', device_id: deviceId },
    });
    expect(response.statusCode).toBe(200);
  }

  async function pullFromDevice() {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/syncs/progress/${epubHash}`,
      headers: deviceHeaders(),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { percentage?: number; progress?: string | null; device?: string; device_id?: string; timestamp?: number };
  }

  async function clearProgressFromWeb() {
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/files/${epub.bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
    });
    expect([200, 204]).toContain(response.statusCode);
  }

  async function storedPercentage(): Promise<number | null> {
    const [row] = await ctx.db
      .select({ percentage: schema.readingProgress.percentage })
      .from(schema.readingProgress)
      .where(eq(schema.readingProgress.bookFileId, epub.bookFileId));
    return row?.percentage ?? null;
  }

  async function deviceRows() {
    return ctx.db
      .select({ percentage: schema.koreaderDeviceProgress.percentage })
      .from(schema.koreaderDeviceProgress)
      .where(eq(schema.koreaderDeviceProgress.bookFileId, epub.bookFileId));
  }

  async function convergedDevices() {
    return ctx.db
      .select({ deviceId: schema.koreaderProgressResetDevices.deviceId })
      .from(schema.koreaderProgressResetDevices)
      .where(eq(schema.koreaderProgressResetDevices.bookFileId, epub.bookFileId));
  }

  async function pendingResets() {
    return ctx.db
      .select({ resetAt: schema.koreaderProgressResets.resetAt })
      .from(schema.koreaderProgressResets)
      .where(eq(schema.koreaderProgressResets.bookFileId, epub.bookFileId));
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `koreader-progress-reset-${randomUUID()}` });

    const epubPath = await createEpubFixture(library.folderPath, 'progress-reset-book.epub', {
      title: `Progress Reset Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });

    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    epub = await locateBookByAbsolutePath(ctx, epubPath);
    const [row] = await ctx.db.select({ fileHash: schema.bookFiles.fileHash }).from(schema.bookFiles).where(eq(schema.bookFiles.id, epub.bookFileId));
    expect(row?.fileHash).toBeTruthy();
    epubHash = row!.fileHash!;

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(ctx.adminToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(schema.koreaderProgressResets).where(eq(schema.koreaderProgressResets.bookFileId, epub.bookFileId));
    await ctx.db.delete(schema.koreaderDeviceProgress).where(eq(schema.koreaderDeviceProgress.bookFileId, epub.bookFileId));
    await ctx.db.delete(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, epub.bookFileId));
  });

  it('clears the device position alongside the shared one', async () => {
    await pushFromDevice(0.42);
    expect(await deviceRows()).toHaveLength(1);

    await clearProgressFromWeb();

    // Leaving the device row behind is what let the old position be served straight back.
    expect(await deviceRows()).toHaveLength(0);
    expect(await storedPercentage()).toBeNull();
    expect(await pendingResets()).toHaveLength(1);
  });

  it('answers the next pull with a start position a stock client can act on', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();

    const pulled = await pullFromDevice();

    expect(pulled.percentage).toBe(0);
    // Stock kosync has no percentage fallback, so an empty position would leave it put.
    expect(pulled.progress).toBe('/body/DocFragment[1]/body');
    expect(pulled.device).toBe('web');
    expect(pulled.device_id).toBe('bookorbit-web');
  });

  it('stamps the delivery as current so the client reads it as a forward sync', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();
    const [marker] = await pendingResets();

    const pulled = await pullFromDevice();

    expect(pulled.timestamp).toBeGreaterThanOrEqual(Math.floor(marker!.resetAt.getTime() / 1000));
  });

  it('keeps the reset after serving it, because the client can discard it silently', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();

    await pullFromDevice();

    expect(await pendingResets()).toHaveLength(1);
    // Still held, so a reset the reader never saw cannot be undone by the next push.
    await pushFromDevice(0.42);
    expect(await storedPercentage()).toBeNull();
  });

  it('holds a push that predates the reset without losing what the device reported', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();

    await pushFromDevice(0.42);

    // The push clock says "now" either way, so only the reset marker can tell these apart.
    expect(await storedPercentage()).toBeNull();
    expect(await deviceRows()).toHaveLength(1);
    expect(await pendingResets()).toHaveLength(1);
  });

  it('keeps answering the reset while a device keeps replaying its old position', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();
    await pushFromDevice(0.42);

    expect((await pullFromDevice()).percentage).toBe(0);
  });

  it('accepts a device once it reports the start position, and lets it read on', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();

    await pushFromDevice(0.004, '/body/DocFragment[1]/body');
    expect(await convergedDevices()).toHaveLength(1);
    expect(await storedPercentage()).toBeCloseTo(0.4, 5);

    await pushFromDevice(0.15);
    expect(await storedPercentage()).toBeCloseTo(15, 5);
  });

  it('stops answering with the reset once a device has taken it and read on', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();
    await pushFromDevice(0.004, '/body/DocFragment[1]/body');
    await pushFromDevice(0.5, '/body/DocFragment[9]/body');

    const pulled = await pullFromDevice();

    expect(pulled.percentage).toBeCloseTo(0.5, 5);
  });

  it('keeps holding a second device after the first one has taken the reset', async () => {
    await pushFromDevice(0.42, XPOINTER, 'reset-device-1');
    await pushFromDevice(0.42, XPOINTER, 'reset-device-2');
    await clearProgressFromWeb();

    await pushFromDevice(0.004, '/body/DocFragment[1]/body', 'reset-device-1');
    expect(await storedPercentage()).toBeCloseTo(0.4, 5);

    // Device two never saw the reset, so its position is still not the book's.
    await pushFromDevice(0.42, XPOINTER, 'reset-device-2');
    expect(await storedPercentage()).toBeCloseTo(0.4, 5);
  });

  it('stops protecting a second device once the first has read on, which is the accepted bound', async () => {
    await pushFromDevice(0.42, XPOINTER, 'reset-device-1');
    await pushFromDevice(0.42, XPOINTER, 'reset-device-2');
    await clearProgressFromWeb();
    await pushFromDevice(0.004, '/body/DocFragment[1]/body', 'reset-device-1');

    // Reading on retires the marker, because the pull carries no device identity and a marker
    // kept alive for device two would send device one back to the start on every sync.
    await pushFromDevice(0.5, '/body/DocFragment[9]/body', 'reset-device-1');
    expect(await pendingResets()).toHaveLength(0);

    // So device two's stale position lands. This is a deliberate bound, not an oversight:
    // holding it would need device_id on the pull, which is a plugin change.
    await pushFromDevice(0.42, XPOINTER, 'reset-device-2');
    expect(await storedPercentage()).toBeCloseTo(42, 5);
  });

  it('a released hold is not re-served on the next pull', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();
    await pushFromDevice(0.42);

    const released = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/koreader/books/${epub.bookId}/reset-hold/release`,
      headers: authHeader(ctx.adminToken),
      payload: { deviceId: 'reset-device-1' },
    });
    expect([200, 201]).toContain(released.statusCode);

    // Leaving the marker live here would ask the device that was just released to go back.
    expect((await pullFromDevice()).percentage).toBeCloseTo(0.42, 5);
  });

  it('answers a release with no pending reset as not found', async () => {
    await pushFromDevice(0.42);

    const released = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/koreader/books/${epub.bookId}/reset-hold/release`,
      headers: authHeader(ctx.adminToken),
      payload: { deviceId: 'reset-device-1' },
    });

    expect(released.statusCode).toBe(404);
  });

  it('releases a hold on request and takes that device position', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();
    await pushFromDevice(0.42);

    const released = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/koreader/books/${epub.bookId}/reset-hold/release`,
      headers: authHeader(ctx.adminToken),
      payload: { deviceId: 'reset-device-1' },
    });
    expect([200, 201]).toContain(released.statusCode);

    expect(await storedPercentage()).toBeCloseTo(42, 5);
  });

  it('re-arms every device when the book is reset a second time', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();
    await pushFromDevice(0.004, '/body/DocFragment[1]/body');
    expect(await convergedDevices()).toHaveLength(1);

    await pushFromDevice(0.5);
    await clearProgressFromWeb();

    // A device that took the previous reset has not taken this one.
    expect(await convergedDevices()).toHaveLength(0);
    await pushFromDevice(0.5);
    expect(await storedPercentage()).toBeNull();
  });

  it('lets reading in BookOrbit retire a reset the device never collected', async () => {
    await pushFromDevice(0.42);
    await clearProgressFromWeb();

    const saved = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${epub.bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
      payload: { percentage: 30, cfi: 'epubcfi(/6/4!/4/2/2:10)' },
    });
    expect([200, 201, 204]).toContain(saved.statusCode);

    expect(await pendingResets()).toHaveLength(0);
    expect(await storedPercentage()).toBeCloseTo(30, 5);
  });

  it('arms the same reset when the whole reading state is wiped', async () => {
    await pushFromDevice(0.42);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/reset-reading-state`,
      headers: authHeader(ctx.adminToken),
    });
    expect([200, 201]).toContain(reset.statusCode);

    expect(await pendingResets()).toHaveLength(1);
    expect((await pullFromDevice()).percentage).toBe(0);
  });
});
