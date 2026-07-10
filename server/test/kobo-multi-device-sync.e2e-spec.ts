import { randomUUID } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { and, eq, inArray } from 'drizzle-orm';
import { Client } from 'pg';

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
  type ReaderStateIsolationE2EContext,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

type KoboDevice = { id: number; token: string };
type SyncResponse = { entries: unknown[]; hasMore: boolean; syncToken: string };

const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function applyMigrations(client: Client, filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    await client.query(await readFile(join(MIGRATIONS_DIRECTORY, filename), 'utf8'));
  }
}

function entitlementIds(entries: unknown[]): string[] {
  return entries.flatMap((entry) => {
    const value = entry as Record<string, Record<string, Record<string, string>>>;
    const bookEntitlement = value.NewEntitlement?.BookEntitlement ?? value.ChangedProductMetadata?.BookEntitlement;
    return bookEntitlement?.Id ? [bookEntitlement.Id] : [];
  });
}

function newEntitlementIds(entries: unknown[]): string[] {
  return entries.flatMap((entry) => {
    const value = entry as Record<string, Record<string, Record<string, string>>>;
    const bookEntitlement = value.NewEntitlement?.BookEntitlement;
    return bookEntitlement?.Id ? [bookEntitlement.Id] : [];
  });
}

function removedEntitlementIds(entries: unknown[]): string[] {
  return entries.flatMap((entry) => {
    const value = entry as Record<string, Record<string, Record<string, string>>>;
    const bookEntitlement = value.ChangedEntitlement?.BookEntitlement;
    return bookEntitlement?.Id ? [bookEntitlement.Id] : [];
  });
}

describe('Kobo device snapshot migration (e2e)', { timeout: 180_000 }, () => {
  it('retains populated legacy snapshot data for the per-device transition bridge', async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    const databaseName = `kobo_snapshot_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';

    const admin = new Client({ connectionString: adminUrl.toString() });
    let target: Client | undefined;
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
      target = new Client({ connectionString: targetUrl.toString() });
      await target.connect();
      await target.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await target.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await target.query('CREATE EXTENSION IF NOT EXISTS vector');

      const migrationFiles = (await readdir(MIGRATIONS_DIRECTORY)).filter((filename) => filename.endsWith('.sql')).sort();
      await applyMigrations(
        target,
        migrationFiles.filter((filename) => filename < '0045_kobo-device-owner-key.sql'),
      );

      const userId = (
        await target.query<{ id: number }>(
          "INSERT INTO users (username, name, password_hash) VALUES ('kobo-migration-legacy', 'Kobo Migration Legacy', 'hash') RETURNING id",
        )
      ).rows[0]!.id;
      const libraryId = (await target.query<{ id: number }>("INSERT INTO libraries (name) VALUES ('Kobo Migration Library') RETURNING id")).rows[0]!
        .id;
      const folderId = (
        await target.query<{ id: number }>("INSERT INTO library_folders (library_id, path) VALUES ($1, '/kobo-migration') RETURNING id", [libraryId])
      ).rows[0]!.id;
      const bookId = (
        await target.query<{ id: number }>(
          "INSERT INTO books (library_id, library_folder_id, folder_path) VALUES ($1, $2, '/kobo-migration/book') RETURNING id",
          [libraryId, folderId],
        )
      ).rows[0]!.id;
      await target.query("INSERT INTO kobo_devices (user_id, name, token) VALUES ($1, 'Legacy Kobo', 'legacy-kobo-migration-token')", [userId]);
      const snapshotId = (await target.query<{ id: number }>('INSERT INTO kobo_library_snapshots (user_id) VALUES ($1) RETURNING id', [userId]))
        .rows[0]!.id;
      await target.query('INSERT INTO kobo_snapshot_books (snapshot_id, book_id, synced) VALUES ($1, $2, true)', [snapshotId, bookId]);

      await applyMigrations(target, ['0045_kobo-device-owner-key.sql', '0046_kobo-device-snapshots.sql']);

      const [bridge] = (
        await target.query<{ legacyDeviceCutoffAt: Date; legacyBookCount: string }>(
          `SELECT legacy_device_cutoff_at AS "legacyDeviceCutoffAt", count(sb.book_id) AS "legacyBookCount"
           FROM kobo_library_snapshots AS s
           LEFT JOIN kobo_snapshot_books AS sb ON sb.snapshot_id = s.id
           WHERE s.user_id = $1
           GROUP BY s.legacy_device_cutoff_at`,
          [userId],
        )
      ).rows;
      const [deviceSnapshotCount] = (await target.query<{ count: string }>('SELECT count(*) FROM kobo_device_library_snapshots')).rows;

      expect(bridge?.legacyDeviceCutoffAt).toBeInstanceOf(Date);
      expect(bridge?.legacyBookCount).toBe('1');
      expect(deviceSnapshotCount?.count).toBe('0');
    } finally {
      await target?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
      await admin.end();
    }
  });
});

describe('Kobo multi-device library sync (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let userId!: number;
  let bookIds!: number[];
  let collectionId!: number;
  let deviceA!: KoboDevice;
  let deviceB!: KoboDevice;

  function syncUrl(device: KoboDevice): string {
    return `/api/v1/kobo/${device.token}/v1/library/sync`;
  }

  async function sync(device: KoboDevice, syncToken?: string): Promise<SyncResponse> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: syncUrl(device),
      headers: syncToken ? { 'x-kobo-synctoken': syncToken } : undefined,
    });
    expect(response.statusCode).toBe(200);

    const responseSyncToken = response.headers['x-kobo-synctoken'];
    expect(typeof responseSyncToken).toBe('string');
    return {
      entries: response.json() as unknown[],
      hasMore: response.headers['x-kobo-sync'] === 'continue',
      syncToken: responseSyncToken as string,
    };
  }

  async function drainEntries(device: KoboDevice): Promise<unknown[]> {
    const delivered: unknown[] = [];
    let syncToken: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const response = await sync(device, syncToken);
      delivered.push(...response.entries);
      if (!response.hasMore) return delivered;
      syncToken = response.syncToken;
    }

    throw new Error(`Kobo device ${device.id} did not finish syncing within ten pages`);
  }

  async function drain(device: KoboDevice): Promise<string[]> {
    return entitlementIds(await drainEntries(device));
  }

  async function createDevice(name: string): Promise<KoboDevice> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kobo/devices',
      headers: authHeader(ctx.adminToken),
      payload: { name },
    });
    expect([200, 201]).toContain(response.statusCode);
    const body = response.json() as KoboDevice;
    expect(body.id).toBeTypeOf('number');
    expect(body.token).toEqual(expect.any(String));
    return body;
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `kobo-multi-device-${randomUUID()}` });

    const paths = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createEpubFixture(library.folderPath, `kobo-multi-device-${index + 1}.epub`, {
          title: `Kobo Multi Device ${index + 1}`,
          uid: `urn:uuid:${randomUUID()}`,
        }),
      ),
    );
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    bookIds = (await Promise.all(paths.map((path) => locateBookByAbsolutePath(ctx, path)))).map((book) => book.bookId);

    const [user] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'reader-state-e2e-admin'));
    userId = user!.id;

    const collectionResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/collections',
      headers: authHeader(ctx.adminToken),
      payload: { name: `Kobo Multi Device ${randomUUID().slice(0, 8)}`, icon: 'book', syncToKobo: true },
    });
    expect([200, 201]).toContain(collectionResponse.statusCode);
    collectionId = (collectionResponse.json() as { id: number }).id;

    const addBooksResponse = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/collections/${collectionId}/books`,
      headers: authHeader(ctx.adminToken),
      payload: { bookIds },
    });
    expect([200, 201]).toContain(addBooksResponse.statusCode);

    deviceA = await createDevice('Kobo A');
    deviceB = await createDevice('Kobo B');
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('delivers every initial page independently when two devices interleave', async () => {
    const aFirst = await sync(deviceA);
    const bFirst = await sync(deviceB);
    expect(aFirst.hasMore).toBe(true);
    expect(bFirst.hasMore).toBe(true);
    expect(entitlementIds(aFirst.entries)).toHaveLength(5);
    expect(entitlementIds(bFirst.entries)).toHaveLength(5);

    const aSecond = await sync(deviceA, aFirst.syncToken);
    const bSecond = await sync(deviceB, bFirst.syncToken);
    expect(aSecond.hasMore).toBe(false);
    expect(bSecond.hasMore).toBe(false);

    const expectedIds = await ctx.db
      .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, bookIds)));
    const expected = expectedIds.map((row) => row.entitlementId).sort();
    expect([...entitlementIds([...aFirst.entries, ...aSecond.entries])].sort()).toEqual(expected);
    expect([...entitlementIds([...bFirst.entries, ...bSecond.entries])].sort()).toEqual(expected);

    const snapshots = await ctx.db
      .select({ id: schema.koboLibrarySnapshots.id, deviceId: schema.koboLibrarySnapshots.deviceId })
      .from(schema.koboLibrarySnapshots)
      .where(eq(schema.koboLibrarySnapshots.userId, userId));
    expect(snapshots.map((snapshot) => snapshot.deviceId).sort()).toEqual([deviceA.id, deviceB.id].sort());

    const rows = await ctx.db
      .select({ snapshotId: schema.koboSnapshotBooks.snapshotId, synced: schema.koboSnapshotBooks.synced })
      .from(schema.koboSnapshotBooks)
      .where(
        inArray(
          schema.koboSnapshotBooks.snapshotId,
          snapshots.map((snapshot) => snapshot.id),
        ),
      );
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.synced)).toBe(true);
  });

  it('fans metadata and delivery changes out to every device independently', async () => {
    const changedBookId = bookIds[0]!;
    await ctx.db
      .update(schema.bookMetadata)
      .set({ title: 'Kobo Multi Device Updated', updatedAt: new Date() })
      .where(eq(schema.bookMetadata.bookId, changedBookId));

    const [changedIdentity] = await ctx.db
      .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), eq(schema.koboBookEntitlements.bookId, changedBookId)));

    const aMetadata = await sync(deviceA);
    const bMetadata = await sync(deviceB);
    expect(entitlementIds(aMetadata.entries)).toEqual([changedIdentity!.entitlementId]);
    expect(entitlementIds(bMetadata.entries)).toEqual([changedIdentity!.entitlementId]);
    expect((aMetadata.entries[0] as Record<string, unknown>).ChangedProductMetadata).toBeDefined();
    expect((bMetadata.entries[0] as Record<string, unknown>).ChangedProductMetadata).toBeDefined();

    const settingsResponse = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/kobo/settings',
      headers: authHeader(ctx.adminToken),
      payload: { forceEnableHyphenation: true },
    });
    expect(settingsResponse.statusCode).toBe(200);

    const [aDeliveryEntries, bDeliveryEntries, expectedIdentityRows] = await Promise.all([
      drainEntries(deviceA),
      drainEntries(deviceB),
      ctx.db
        .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
        .from(schema.koboBookEntitlements)
        .where(and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, bookIds))),
    ]);
    const expectedIds = expectedIdentityRows.map((row) => row.entitlementId).sort();
    expect(newEntitlementIds(aDeliveryEntries).sort()).toEqual(expectedIds);
    expect(newEntitlementIds(bDeliveryEntries).sort()).toEqual(expectedIds);
  });

  it('keeps new-device delivery and device-local removal isolated', async () => {
    const deviceC = await createDevice('Kobo C');
    const deviceCDelivered = await drain(deviceC);
    const expectedIdentityRows = await ctx.db
      .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, bookIds)));
    expect(deviceCDelivered.sort()).toEqual(expectedIdentityRows.map((row) => row.entitlementId).sort());

    const snapshotsBeforeDelete = await ctx.db
      .select({ id: schema.koboLibrarySnapshots.id, deviceId: schema.koboLibrarySnapshots.deviceId })
      .from(schema.koboLibrarySnapshots)
      .where(eq(schema.koboLibrarySnapshots.userId, userId));
    const aAndBRows = await ctx.db
      .select({ snapshotId: schema.koboSnapshotBooks.snapshotId, synced: schema.koboSnapshotBooks.synced })
      .from(schema.koboSnapshotBooks)
      .where(
        inArray(
          schema.koboSnapshotBooks.snapshotId,
          snapshotsBeforeDelete
            .filter((snapshot) => snapshot.deviceId === deviceA.id || snapshot.deviceId === deviceB.id)
            .map((snapshot) => snapshot.id),
        ),
      );
    expect(aAndBRows).toHaveLength(12);
    expect(aAndBRows.every((row) => row.synced)).toBe(true);

    const [targetIdentity] = await ctx.db
      .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), eq(schema.koboBookEntitlements.bookId, bookIds[0]!)));
    const deleteResponse = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/kobo/${deviceA.token}/v1/library/${targetIdentity!.entitlementId}`,
    });
    expect(deleteResponse.statusCode).toBe(200);

    const deviceState = await ctx.db
      .select({
        deviceId: schema.koboLibrarySnapshots.deviceId,
        removedByDevice: schema.koboSnapshotBooks.removedByDevice,
        synced: schema.koboSnapshotBooks.synced,
      })
      .from(schema.koboSnapshotBooks)
      .innerJoin(schema.koboLibrarySnapshots, eq(schema.koboLibrarySnapshots.id, schema.koboSnapshotBooks.snapshotId))
      .where(and(eq(schema.koboLibrarySnapshots.userId, userId), eq(schema.koboSnapshotBooks.bookId, bookIds[0]!)));
    expect(deviceState.find((row) => row.deviceId === deviceA.id)).toMatchObject({ removedByDevice: true, synced: true });
    expect(deviceState.find((row) => row.deviceId === deviceB.id)).toMatchObject({ removedByDevice: false, synced: true });
    expect(deviceState.find((row) => row.deviceId === deviceC.id)).toMatchObject({ removedByDevice: false, synced: true });

    const aReadded = await sync(deviceA);
    expect(entitlementIds(aReadded.entries)).toContain(targetIdentity!.entitlementId);
    const bAfterDeviceARemoval = await sync(deviceB);
    expect(entitlementIds(bAfterDeviceARemoval.entries)).not.toContain(targetIdentity!.entitlementId);

    const revokeResponse = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/kobo/devices/${deviceC.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(revokeResponse.statusCode).toBe(204);

    const revokedSnapshot = await ctx.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.deviceId, deviceC.id),
    });
    expect(revokedSnapshot).toBeUndefined();

    const remainingSnapshots = await ctx.db
      .select({ deviceId: schema.koboLibrarySnapshots.deviceId })
      .from(schema.koboLibrarySnapshots)
      .where(eq(schema.koboLibrarySnapshots.userId, userId));
    expect(remainingSnapshots.map((snapshot) => snapshot.deviceId).sort()).toEqual([deviceA.id, deviceB.id].sort());
  });

  it('bridges every pre-upgrade device even after the global numeric-removal marker was cleared', async () => {
    const [legacyEligiblePath, legacyRemovedPath] = await Promise.all([
      createEpubFixture(library.folderPath, `kobo-legacy-bridge-${randomUUID()}.epub`, {
        title: 'Kobo Legacy Bridge',
        uid: `urn:uuid:${randomUUID()}`,
      }),
      createEpubFixture(library.folderPath, `kobo-legacy-removed-${randomUUID()}.epub`, {
        title: 'Kobo Legacy Removed',
        uid: `urn:uuid:${randomUUID()}`,
      }),
    ]);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const [legacyEligibleBookId, legacyRemovedBookId] = await Promise.all([
      locateBookByAbsolutePath(ctx, legacyEligiblePath).then((book) => book.bookId),
      locateBookByAbsolutePath(ctx, legacyRemovedPath).then((book) => book.bookId),
    ]);
    const addBookResponse = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/collections/${collectionId}/books`,
      headers: authHeader(ctx.adminToken),
      payload: { bookIds: [legacyEligibleBookId] },
    });
    expect([200, 201]).toContain(addBookResponse.statusCode);

    const legacyDeviceA = await createDevice('Kobo Legacy Bridge A');
    const legacyDeviceB = await createDevice('Kobo Legacy Bridge B');
    await ctx.db.insert(schema.koboBookEntitlements).values([
      { userId, bookId: legacyEligibleBookId, needsLegacyNumericRemoval: false },
      { userId, bookId: legacyRemovedBookId, needsLegacyNumericRemoval: false },
    ]);
    const [legacySnapshot] = await ctx.db
      .insert(schema.koboLegacyLibrarySnapshots)
      .values({ userId, legacyDeviceCutoffAt: new Date(Date.now() + 60_000) })
      .returning({ id: schema.koboLegacyLibrarySnapshots.id });
    await ctx.db.insert(schema.koboLegacySnapshotBooks).values([
      { snapshotId: legacySnapshot!.id, bookId: legacyEligibleBookId, synced: true },
      { snapshotId: legacySnapshot!.id, bookId: legacyRemovedBookId, synced: true },
    ]);

    const firstDeviceEntries = await drainEntries(legacyDeviceA);
    const markerStateAfterFirstDevice = await ctx.db
      .select({ bookId: schema.koboBookEntitlements.bookId, needsLegacyNumericRemoval: schema.koboBookEntitlements.needsLegacyNumericRemoval })
      .from(schema.koboBookEntitlements)
      .where(
        and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, [legacyEligibleBookId, legacyRemovedBookId])),
      );
    expect(markerStateAfterFirstDevice.every((row) => !row.needsLegacyNumericRemoval)).toBe(true);

    const secondDeviceEntries = await drainEntries(legacyDeviceB);
    const identityRows = await ctx.db
      .select({ bookId: schema.koboBookEntitlements.bookId, entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(
        and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, [legacyEligibleBookId, legacyRemovedBookId])),
      );
    const identitiesByBookId = new Map(identityRows.map((row) => [row.bookId, row.entitlementId]));
    const legacyEligibleEntitlementId = identitiesByBookId.get(legacyEligibleBookId);
    const legacyRemovedEntitlementId = identitiesByBookId.get(legacyRemovedBookId);
    if (!legacyEligibleEntitlementId || !legacyRemovedEntitlementId) {
      throw new Error('Legacy bridge did not create entitlement identities');
    }

    for (const deliveredEntries of [firstDeviceEntries, secondDeviceEntries]) {
      expect(removedEntitlementIds(deliveredEntries)).toEqual(
        expect.arrayContaining([String(legacyEligibleBookId), String(legacyRemovedBookId), legacyRemovedEntitlementId]),
      );
      expect(entitlementIds(deliveredEntries)).toContain(legacyEligibleEntitlementId);
      expect(entitlementIds(deliveredEntries)).not.toContain(legacyRemovedEntitlementId);
    }

    const retiredLegacySnapshot = await ctx.db.query.koboLegacyLibrarySnapshots.findFirst({
      where: eq(schema.koboLegacyLibrarySnapshots.userId, userId),
    });
    expect(retiredLegacySnapshot).toBeUndefined();
  });
});
