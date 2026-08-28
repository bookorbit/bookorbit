import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
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
  type ReaderStateIsolationE2EContext,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

type KoboDevice = { id: number; token: string };
type BookMetadata = { EntitlementId: string; CoverImageId: string; Title: string | null; Publisher: { Name: string } | null };
type SyncEntry = { NewEntitlement?: { BookMetadata: BookMetadata }; ChangedProductMetadata?: { BookMetadata: BookMetadata } };

// A one pixel JPEG, so the cover on disk is real bytes rather than a placeholder string.
const COVER_BYTES = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/**
 * A Kobo stores a downloaded book's cover locally under the CoverImageId it was given, so an id
 * that churns on unrelated metadata edits strands the device on the placeholder cover whenever it
 * is offline. These tests pin the id to the cover itself. See issue #943.
 */
describe('Kobo cover image identity (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let userId!: number;
  let bookId!: number;
  let device!: KoboDevice;
  let entitlementId!: string;
  let coverIdHeldByDevice!: string;

  async function sync(syncToken?: string): Promise<{ entries: SyncEntry[]; hasMore: boolean; syncToken: string }> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/kobo/${device.token}/v1/library/sync`,
      headers: syncToken ? { 'x-kobo-synctoken': syncToken } : undefined,
    });
    expect(response.statusCode).toBe(200);
    return {
      entries: response.json() as SyncEntry[],
      hasMore: response.headers['x-kobo-sync'] === 'continue',
      syncToken: response.headers['x-kobo-synctoken'] as string,
    };
  }

  async function drainEntries(): Promise<SyncEntry[]> {
    const delivered: SyncEntry[] = [];
    let syncToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await sync(syncToken);
      delivered.push(...response.entries);
      if (!response.hasMore) return delivered;
      syncToken = response.syncToken;
    }
    throw new Error('sync did not finish within ten pages');
  }

  // Scoped to this book: the shared e2e database can still hold Kobo-eligible books from an
  // earlier suite, and this one is not about how many entries a sync carries.
  function deliveredMetadata(entries: SyncEntry[]): BookMetadata[] {
    return entries.flatMap((entry) => {
      const metadata = entry.NewEntitlement?.BookMetadata ?? entry.ChangedProductMetadata?.BookMetadata;
      return metadata && metadata.EntitlementId === entitlementId ? [metadata] : [];
    });
  }

  // A drained device is told nothing until something changes, so the id last delivered is the id
  // the device is holding. Every test compares against that rather than re-syncing for it.
  async function drainDelivered(): Promise<BookMetadata[]> {
    const delivered = deliveredMetadata(await drainEntries());
    const last = delivered[delivered.length - 1];
    if (last) coverIdHeldByDevice = last.CoverImageId;
    return delivered;
  }

  // A book only reports a metadata change once its snapshot row is settled, so quiet this book
  // before each test. A sync is never entirely empty: a syncToKobo collection re-sends its
  // ChangedTag every time, which is why this waits on the book rather than on the whole payload.
  async function settleDevice(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const delivered = await drainDelivered();
      if (delivered.length === 0) return;
    }
    throw new Error('device never settled: the book kept reporting changes');
  }

  async function thumbnailStatus(coverImageId: string): Promise<number> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/kobo/${device.token}/v1/books/${coverImageId}/thumbnail/400/600/false/image.jpg`,
    });
    return response.statusCode;
  }

  async function editMetadata(payload: Record<string, unknown>): Promise<void> {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/metadata`,
      headers: authHeader(ctx.adminToken),
      payload,
    });
    expect(response.statusCode).toBe(200);
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `kobo-cover-identity-${randomUUID()}` });

    const path = await createEpubFixture(library.folderPath, 'kobo-cover-identity.epub', {
      title: 'Kobo Cover Identity',
      uid: `urn:uuid:${randomUUID()}`,
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    bookId = (await locateBookByAbsolutePath(ctx, path)).bookId;

    const [user] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'reader-state-e2e-admin'));
    userId = user!.id;

    const coverDir = join(process.env.APP_DATA_PATH!, 'covers', String(bookId));
    await mkdir(coverDir, { recursive: true });
    await writeFile(join(coverDir, 'cover_custom.jpg'), COVER_BYTES);
    await ctx.db.update(schema.bookMetadata).set({ coverSource: 'custom', coverUpdatedAt: new Date() }).where(eq(schema.bookMetadata.bookId, bookId));

    const collectionResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/collections',
      headers: authHeader(ctx.adminToken),
      payload: { name: `Kobo Cover Identity ${randomUUID().slice(0, 8)}`, icon: 'book', syncToKobo: true },
    });
    expect([200, 201]).toContain(collectionResponse.statusCode);

    const addBooksResponse = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/collections/${(collectionResponse.json() as { id: number }).id}/books`,
      headers: authHeader(ctx.adminToken),
      payload: { bookIds: [bookId] },
    });
    expect([200, 201]).toContain(addBooksResponse.statusCode);

    const deviceResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kobo/devices',
      headers: authHeader(ctx.adminToken),
      payload: { name: 'Kobo Cover Identity' },
    });
    expect([200, 201]).toContain(deviceResponse.statusCode);
    device = deviceResponse.json() as KoboDevice;

    // The entitlement row is minted lazily by the first sync, so drain first and resolve after.
    const initialEntries = await drainEntries();
    const [identity] = await ctx.db
      .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), eq(schema.koboBookEntitlements.bookId, bookId)));
    entitlementId = identity!.entitlementId;

    const initial = deliveredMetadata(initialEntries);
    expect(initial).toHaveLength(1);
    coverIdHeldByDevice = initial[0]!.CoverImageId;
    await settleDevice();
  }, 180_000);

  beforeEach(async () => {
    await settleDevice();
  });

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('keeps the CoverImageId across a metadata edit while still delivering the change', async () => {
    const coverIdBefore = coverIdHeldByDevice;
    expect(await thumbnailStatus(coverIdBefore)).toBe(200);

    await editMetadata({ title: 'Kobo Cover Identity, Revised', publisher: 'Repro Press' });

    const delivered = await drainDelivered();
    expect(delivered).toHaveLength(1);
    // The edit still reaches the device; only the cover identity holds still.
    expect(delivered[0]!.Title).toBe('Kobo Cover Identity, Revised');
    expect(delivered[0]!.Publisher?.Name).toBe('Repro Press');
    expect(delivered[0]!.CoverImageId).toBe(coverIdBefore);
    expect(await thumbnailStatus(coverIdBefore)).toBe(200);
  });

  it('keeps the CoverImageId across a series edit', async () => {
    const coverIdBefore = coverIdHeldByDevice;

    await editMetadata({ seriesName: 'Repro Cycle', seriesIndex: '2' });

    const delivered = await drainDelivered();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.CoverImageId).toBe(coverIdBefore);
  });

  it('keeps the CoverImageId across a derived write no user ever made', async () => {
    const coverIdBefore = coverIdHeldByDevice;
    const [before] = await ctx.db
      .select({ coverUpdatedAt: schema.bookMetadata.coverUpdatedAt })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, bookId));

    // The shape of BookEmbedderRepository.saveEmbedding and updateMetadataScore: one derived
    // column, no mention of updatedAt, which $onUpdateFn bumps anyway.
    await ctx.db.update(schema.bookMetadata).set({ metadataScore: 42 }).where(eq(schema.bookMetadata.bookId, bookId));

    const [after] = await ctx.db
      .select({ coverUpdatedAt: schema.bookMetadata.coverUpdatedAt, updatedAt: schema.bookMetadata.updatedAt })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, bookId));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.coverUpdatedAt!.getTime());
    expect(after!.coverUpdatedAt!.getTime()).toBe(before!.coverUpdatedAt!.getTime());

    // And the id the device is actually handed on the next delivery is still the same one.
    await editMetadata({ title: 'Kobo Cover Identity, Rescored' });
    const delivered = await drainDelivered();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.CoverImageId).toBe(coverIdBefore);
  });

  it('still resolves cover ids a device was handed before the id scheme settled', async () => {
    const [identity] = await ctx.db
      .select({ coverImageId: schema.koboBookEntitlements.coverImageId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), eq(schema.koboBookEntitlements.bookId, bookId)));

    expect(await thumbnailStatus(identity!.coverImageId)).toBe(200);
    expect(await thumbnailStatus(`${identity!.coverImageId}_1700000000000`)).toBe(200);
  });

  it('changes the CoverImageId when the cover itself changes', async () => {
    const coverIdBefore = coverIdHeldByDevice;

    const deleteResponse = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${bookId}/cover`,
      headers: authHeader(ctx.adminToken),
    });
    expect(deleteResponse.statusCode).toBe(200);

    const delivered = await drainDelivered();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.CoverImageId).not.toBe(coverIdBefore);

    const [row] = await ctx.db
      .select({ coverUpdatedAt: schema.bookMetadata.coverUpdatedAt })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, bookId));
    expect(delivered[0]!.CoverImageId).toBe(`${delivered[0]!.CoverImageId.split('_')[0]}_${row!.coverUpdatedAt!.getTime()}`);
  });
});
