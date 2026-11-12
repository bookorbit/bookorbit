import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { Permission } from '@bookorbit/types';
import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/authorization-matrix/authorization-matrix-fixture-builder';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

const KOREADER_USERNAME = `device-names-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'DeviceNamesPass123';
const DEVICE_ID = 'device-names-phone';
// An Android codename, the case the feature exists for.
const DEVICE_MODEL = 'blazer';

/**
 * A name a user gives a KOReader device is display only. The model the device reports stays
 * what progress rows are keyed by and what the device recognises its own pushes by, so naming
 * a device must never split its progress or change what the kosync reply calls `device`.
 */
describe('KOReader device names (e2e)', { timeout: 180_000 }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let otherUser!: TestUserSession;
  let unauthorizedUser!: TestUserSession;
  let bookId!: number;
  let bookFileId!: number;
  let bookHash!: string;

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    otherUser = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    unauthorizedUser = await createUserAndLogin(ctx);

    const library = await createLibraryWithFolder(ctx, { name: `koreader-device-names-${randomUUID()}` });
    const epubPath = await createEpubFixture(library.folderPath, 'device-names-book.epub', { title: `Device Names Book ${randomUUID()}` });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const located = await locateBookByAbsolutePath(ctx, epubPath);
    bookId = located.bookId;
    bookFileId = located.bookFileId;
    const [row] = await ctx.db.select({ fileHash: schema.bookFiles.fileHash }).from(schema.bookFiles).where(eq(schema.bookFiles.id, bookFileId));
    expect(row?.fileHash).toBeTruthy();
    bookHash = row!.fileHash!;

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(ctx.adminToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);

    await pushFromDevice(0.25);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('shows the name wherever the device is listed and keeps the reported model', async () => {
    const saved = await putName(ctx.adminToken, '  Pixel 8  ');
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ deviceId: DEVICE_ID, name: 'Pixel 8' });

    const status = await syncStatus(ctx.adminToken);
    expect(status.devices).toEqual([expect.objectContaining({ device: DEVICE_MODEL, deviceId: DEVICE_ID, deviceName: 'Pixel 8' })]);

    const progress = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/books/${bookId}/progress`, headers: authHeader(ctx.adminToken) });
    expect(progress.statusCode, progress.body).toBe(200);
    expect(progress.json().devices).toEqual([expect.objectContaining({ device: DEVICE_MODEL, deviceId: DEVICE_ID, deviceName: 'Pixel 8' })]);

    const pulled = await pullFromDevice();
    expect(pulled).toEqual(expect.objectContaining({ device: DEVICE_MODEL, device_id: DEVICE_ID, device_name: 'Pixel 8' }));
  });

  it('keeps one progress row for a named device that syncs again', async () => {
    await putName(ctx.adminToken, 'Pixel 8');
    await pushFromDevice(0.5);

    const rows = await ctx.db
      .select({ device: schema.koreaderDeviceProgress.device, percentage: schema.koreaderDeviceProgress.percentage })
      .from(schema.koreaderDeviceProgress)
      .where(and(eq(schema.koreaderDeviceProgress.bookFileId, bookFileId), eq(schema.koreaderDeviceProgress.deviceId, DEVICE_ID)));
    expect(rows).toEqual([{ device: DEVICE_MODEL, percentage: 0.5 }]);
  });

  it('clears the name and leaves it out of the kosync reply', async () => {
    await putName(ctx.adminToken, 'Pixel 8');

    const cleared = await ctx.app.inject({ method: 'DELETE', url: nameUrl(), headers: authHeader(ctx.adminToken) });
    expect(cleared.statusCode, cleared.body).toBe(200);

    const status = await syncStatus(ctx.adminToken);
    expect(status.devices).toEqual([expect.objectContaining({ deviceId: DEVICE_ID, deviceName: null })]);
    const pulled = await pullFromDevice();
    expect(pulled).toEqual(expect.objectContaining({ device: DEVICE_MODEL, device_id: DEVICE_ID }));
    expect(pulled).not.toHaveProperty('device_name');
  });

  it.each([
    ['blank', '   '],
    ['too long', 'x'.repeat(101)],
    ['multi-line', 'Pixel\n8'],
  ])('rejects a %s name', async (_label, name) => {
    const response = await putName(ctx.adminToken, name);
    expect(response.statusCode, response.body).toBe(400);
  });

  it('refuses to name a device of another user or without the KOReader permission', async () => {
    const otherResponse = await putName(otherUser.accessToken, 'Not mine');
    expect(otherResponse.statusCode, otherResponse.body).toBe(404);
    const otherClear = await ctx.app.inject({ method: 'DELETE', url: nameUrl(), headers: authHeader(otherUser.accessToken) });
    expect(otherClear.statusCode, otherClear.body).toBe(404);

    const unauthorized = await putName(unauthorizedUser.accessToken, 'Not allowed');
    expect(unauthorized.statusCode, unauthorized.body).toBe(403);

    const otherNames = await ctx.db
      .select({ deviceId: schema.koreaderDeviceNames.deviceId })
      .from(schema.koreaderDeviceNames)
      .where(eq(schema.koreaderDeviceNames.userId, otherUser.userId));
    expect(otherNames).toEqual([]);
  });

  it('removes the name with the device synced data', async () => {
    await putName(ctx.adminToken, 'Pixel 8');

    const removed = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/koreader/devices/${DEVICE_ID}`, headers: authHeader(ctx.adminToken) });
    expect(removed.statusCode, removed.body).toBe(200);

    const names = await ctx.db
      .select({ deviceId: schema.koreaderDeviceNames.deviceId })
      .from(schema.koreaderDeviceNames)
      .where(eq(schema.koreaderDeviceNames.deviceId, DEVICE_ID));
    expect(names).toEqual([]);
  });

  function nameUrl(): string {
    return `/api/v1/koreader/devices/${DEVICE_ID}/name`;
  }

  function putName(token: string, name: string): Promise<InjectResponse> {
    return ctx.app.inject({ method: 'PUT', url: nameUrl(), headers: authHeader(token), payload: { name } });
  }

  async function syncStatus(token: string) {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/sync-status', headers: authHeader(token) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { devices: unknown[] };
  }

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function pushFromDevice(percentage: number): Promise<void> {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: deviceHeaders(),
      payload: { document: bookHash, percentage, progress: '/body/DocFragment[2]/body/p[1]/text().0', device: DEVICE_MODEL, device_id: DEVICE_ID },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  /** The kosync reply speaks for the device only while its row is newer than the shared position. */
  async function pullFromDevice(): Promise<Record<string, unknown>> {
    await ctx.db
      .update(schema.readingProgress)
      .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(schema.readingProgress.bookFileId, bookFileId));
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${bookHash}`, headers: deviceHeaders() });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Record<string, unknown>;
  }
});
