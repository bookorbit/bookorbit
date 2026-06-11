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

// The fixture chapter (OPS/chapter.xhtml) body is exactly <p>fixture</p>; kepubify
// wraps it in a single koboSpan with id kobo.1.1.
const FIXTURE_CFI = 'epubcfi(/6/2!/4/2,/1:0,/1:7)';
const FIXTURE_XPOINTER_0 = '/body/DocFragment[1]/body/p/text().0';
const FIXTURE_XPOINTER_1 = '/body/DocFragment[1]/body/p/text().7';
const KOBO_LOCATION = {
  span: {
    startPath: 'span#kobo\\.1\\.1',
    startChar: 0,
    endPath: 'span#kobo\\.1\\.1',
    endChar: 7,
    chapterFilename: 'OPS/chapter.xhtml',
    chapterProgress: 0,
    chapterTitle: 'Chapter 1',
  },
};

const KOREADER_USERNAME = `kobo-mesh-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'KoboMeshDevicePass123';

function flushTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

describe('Kobo annotation sync (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let epub!: LocatedBookFile;
  let deviceToken!: string;
  let deviceDbId!: number;
  let contentId!: string;
  let deviceAnnotationId!: string;
  let fileHash!: string;
  let adminUserId!: number;

  function v3Url(path: string): string {
    return `/api/v1/kobo/${deviceToken}/${path}`;
  }

  async function getAnnotations() {
    const response = await ctx.app.inject({
      method: 'GET',
      url: v3Url(`api/v3/content/${contentId}/annotations`),
      headers: { 'if-none-match': 'W/"0"' },
    });
    expect(response.statusCode).toBe(200);
    await flushTick();
    return response.json() as { annotations: Record<string, unknown>[]; nextPageOffsetToken: null };
  }

  async function patchAnnotations(payload: Record<string, unknown>) {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: v3Url(`api/v3/content/${contentId}/annotations`),
      payload,
    });
    expect(response.statusCode).toBe(204);
  }

  async function checkForChanges(): Promise<string[]> {
    const response = await ctx.app.inject({ method: 'POST', url: v3Url('api/v3/content/checkforchanges'), payload: {} });
    expect(response.statusCode).toBe(200);
    return response.json() as string[];
  }

  async function findCanonicalAnnotations() {
    return ctx.db
      .select()
      .from(schema.annotations)
      .where(and(eq(schema.annotations.userId, adminUserId), eq(schema.annotations.bookId, epub.bookId)));
  }

  async function findPositions(annotationId: number) {
    const rows = await ctx.db.select().from(schema.annotationPositions).where(eq(schema.annotationPositions.annotationId, annotationId));
    return new Map(rows.map((row) => [row.format, row]));
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `kobo-annotations-${randomUUID()}` });
    const epubPath = await createEpubFixture(library.folderPath, 'kobo-sync-book.epub', {
      title: `Kobo Sync Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    epub = await locateBookByAbsolutePath(ctx, epubPath);

    const [admin] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'reader-state-e2e-admin'));
    adminUserId = admin!.id;

    const [fileRow] = await ctx.db
      .select({ fileHash: schema.bookFiles.fileHash })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, epub.bookFileId));
    fileHash = fileRow!.fileHash!;
    expect(fileHash).toBeTruthy();

    const device = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kobo/devices',
      headers: authHeader(ctx.adminToken),
      payload: { name: 'E2E Kobo' },
    });
    expect([200, 201]).toContain(device.statusCode);
    const deviceBody = device.json() as { id: number; token: string };
    deviceToken = deviceBody.token;
    deviceDbId = deviceBody.id;

    const settings = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/kobo/settings',
      headers: authHeader(ctx.adminToken),
      payload: { convertToKepub: true },
    });
    expect(settings.statusCode).toBe(200);

    // Kobo library sync only covers books in collections flagged syncToKobo.
    const collection = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/collections',
      headers: authHeader(ctx.adminToken),
      payload: { name: `Kobo Sync ${randomUUID().slice(0, 8)}`, icon: 'book', syncToKobo: true },
    });
    expect([200, 201]).toContain(collection.statusCode);
    const collectionId = (collection.json() as { id: number }).id;
    const addBooks = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/collections/${collectionId}/books`,
      headers: authHeader(ctx.adminToken),
      payload: { bookIds: [epub.bookId] },
    });
    expect([200, 201]).toContain(addBooks.statusCode);

    // Library sync mints the entitlement contentId the v3 API addresses books by.
    const sync = await ctx.app.inject({ method: 'GET', url: v3Url('v1/library/sync') });
    expect(sync.statusCode).toBe(200);

    const [entitlement] = await ctx.db
      .select({ entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, adminUserId), eq(schema.koboBookEntitlements.bookId, epub.bookId)));
    expect(entitlement?.entitlementId).toBeTruthy();
    contentId = entitlement!.entitlementId;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('ingests a device highlight into the hub with exact cfi and xpointer positions', async () => {
    deviceAnnotationId = randomUUID();
    await patchAnnotations({
      updatedAnnotations: [
        {
          id: deviceAnnotationId,
          type: 'highlight',
          highlightColor: '#C6E09E',
          highlightedText: 'fixture',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: '2026-06-10T10:00:00Z',
        },
      ],
    });

    const canonical = await findCanonicalAnnotations();
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toMatchObject({
      text: 'fixture',
      origin: 'kobo',
      color: '#4ADE80',
      style: 'highlight',
      deviceCreatedAt: '2026-06-10 10:00:00',
    });

    const positions = await findPositions(canonical[0].id);
    expect(positions.get('kobo_span')).toMatchObject({ pos0: 'kobo.1.1:0', pos1: 'kobo.1.1:7', status: 'exact' });
    expect(positions.get('cfi')).toMatchObject({ pos0: FIXTURE_CFI, status: 'exact' });
    expect(positions.get('xpointer')).toMatchObject({ pos0: FIXTURE_XPOINTER_0, pos1: FIXTURE_XPOINTER_1, status: 'exact' });

    const [state] = await ctx.db
      .select()
      .from(schema.annotationSyncState)
      .where(and(eq(schema.annotationSyncState.annotationId, canonical[0].id), eq(schema.annotationSyncState.source, 'kobo')));
    expect(state).toMatchObject({ externalKey: deviceAnnotationId, deviceId: String(deviceDbId) });
  });

  it('echoes the device annotation back on GET and converges checkforchanges', async () => {
    const body = await getAnnotations();
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0]).toMatchObject({
      id: deviceAnnotationId,
      highlightColor: '#C6E09E',
      highlightedText: 'fixture',
      type: 'highlight',
    });
    expect(body.annotations[0].location).toEqual(KOBO_LOCATION);

    expect(await checkForChanges()).toEqual([]);
  });

  it('reports the content changed after a hub edit and serves the edit', async () => {
    const [annotation] = await findCanonicalAnnotations();
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${epub.bookId}/annotations/${annotation.id}`,
      headers: authHeader(ctx.adminToken),
      payload: { note: 'hub note', color: '#38BDF8' },
    });
    expect(edit.statusCode).toBe(200);

    expect(await checkForChanges()).toEqual([contentId]);

    const body = await getAnnotations();
    expect(body.annotations[0]).toMatchObject({ noteText: 'hub note', highlightColor: '#B2E1E8', type: 'note' });

    expect(await checkForChanges()).toEqual([]);
  });

  it('does not re-ingest the device echo of a served edit', async () => {
    const body = await getAnnotations();
    const served = body.annotations[0] as { clientLastModifiedUtc: string };
    await patchAnnotations({
      updatedAnnotations: [
        {
          id: deviceAnnotationId,
          type: 'note',
          highlightColor: '#B2E1E8',
          highlightedText: 'fixture',
          noteText: 'hub note',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: served.clientLastModifiedUtc,
        },
      ],
    });

    const [annotation] = await findCanonicalAnnotations();
    expect(annotation).toMatchObject({ note: 'hub note', color: '#38BDF8' });
  });

  it('serves web-origin annotations once push is enabled, with a synthesized location', async () => {
    const enable = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/kobo/settings',
      headers: authHeader(ctx.adminToken),
      payload: { syncBookOrbitAnnotationsToKobo: true },
    });
    expect(enable.statusCode).toBe(200);

    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color: '#FB923C', style: 'highlight' },
    });
    expect(create.statusCode).toBe(201);

    expect(await checkForChanges()).toEqual([contentId]);

    const body = await getAnnotations();
    expect(body.annotations).toHaveLength(2);
    const webServed = body.annotations.find((a) => a.id !== deviceAnnotationId)!;
    expect(webServed).toMatchObject({ highlightedText: 'fixture', highlightColor: '#F6F3B3', type: 'highlight' });
    const location = webServed.location as typeof KOBO_LOCATION;
    expect(location.span).toMatchObject({ startPath: 'span#kobo\\.1\\.1', startChar: 0, endPath: 'span#kobo\\.1\\.1', endChar: 7 });
    expect(location.span.chapterFilename).toBe('OPS/chapter.xhtml');

    expect(await checkForChanges()).toEqual([]);

    const created = (await findCanonicalAnnotations()).find((row) => row.origin === 'web')!;
    const positions = await findPositions(created.id);
    expect(positions.get('kobo_span')).toMatchObject({ pos0: 'kobo.1.1:0', pos1: 'kobo.1.1:7' });
  });

  it('applies device deletes to the hub', async () => {
    const body = await getAnnotations();
    const webServedId = (body.annotations.find((a) => a.id !== deviceAnnotationId) as { id: string }).id;

    await patchAnnotations({ deletedAnnotationIds: [webServedId] });

    const remaining = (await findCanonicalAnnotations()).filter((row) => row.deletedAt === null);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].origin).toBe('kobo');

    const after = await getAnnotations();
    expect(after.annotations.map((a) => a.id)).toEqual([deviceAnnotationId]);
  });

  it('propagates hub deletions by omission and acks the tombstone', async () => {
    const [annotation] = (await findCanonicalAnnotations()).filter((row) => row.deletedAt === null);
    const remove = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/annotations/${annotation.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect([200, 204]).toContain(remove.statusCode);

    expect(await checkForChanges()).toEqual([contentId]);

    const body = await getAnnotations();
    expect(body.annotations).toHaveLength(0);

    const [state] = await ctx.db
      .select()
      .from(schema.annotationSyncState)
      .where(
        and(
          eq(schema.annotationSyncState.annotationId, annotation.id),
          eq(schema.annotationSyncState.source, 'kobo'),
          eq(schema.annotationSyncState.deviceId, String(deviceDbId)),
        ),
      );
    expect(state.deleteAckedAt).not.toBeNull();

    expect(await checkForChanges()).toEqual([]);
  });

  it('converts a KoboSpan reading-state bookmark to precise cfi and xpointer progress', async () => {
    const enable = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/kobo/settings',
      headers: authHeader(ctx.adminToken),
      payload: { twoWayProgressSync: true },
    });
    expect(enable.statusCode).toBe(200);

    const put = await ctx.app.inject({
      method: 'PUT',
      url: v3Url(`v1/library/${contentId}/state`),
      payload: {
        ReadingStates: [
          {
            EntitlementId: contentId,
            LastModified: '2026-06-11T10:00:00Z',
            CurrentBookmark: {
              LastModified: '2026-06-11T10:00:00Z',
              ProgressPercent: 42,
              ContentSourceProgressPercent: 10,
              Location: { Source: 'OPS/chapter.xhtml', Type: 'KoboSpan', Value: 'kobo.1.1' },
            },
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);

    const [progress] = await ctx.db
      .select()
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.userId, adminUserId), eq(schema.readingProgress.bookFileId, epub.bookFileId)));
    expect(progress).toBeDefined();
    expect(progress.percentage).toBe(42);
    expect(progress.cfi).toBe('epubcfi(/6/2!/4/2/1:0)');
    expect(progress.koreaderProgress).toBe(FIXTURE_XPOINTER_0);
    expect(progress.koboLocationValue).toBe('kobo.1.1');
  });

  it('serves a recomputed KoboSpan Location after the web reader moves the position', async () => {
    const save = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${epub.bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
      payload: { percentage: 55, cfi: 'epubcfi(/6/2!/4/2/1:4)' },
    });
    expect([200, 201, 204]).toContain(save.statusCode);

    const state = await ctx.app.inject({ method: 'GET', url: v3Url(`v1/library/${contentId}/state`) });
    expect(state.statusCode).toBe(200);
    const body = state.json() as { CurrentBookmark: { ProgressPercent: number; Location: { Source: string; Type: string; Value: string } } }[];
    const bookmark = (Array.isArray(body) ? body[0] : body).CurrentBookmark;
    expect(bookmark.ProgressPercent).toBe(55);
    expect(bookmark.Location).toMatchObject({ Type: 'KoboSpan', Value: 'kobo.1.1', Source: 'OPS/chapter.xhtml' });
  });

  it('completes the mesh: a kobo upload reaches a koreader device as an xpointer add', async () => {
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

    const koboUploadId = randomUUID();
    await patchAnnotations({
      updatedAnnotations: [
        {
          id: koboUploadId,
          type: 'highlight',
          highlightColor: '#E8AFCF',
          highlightedText: 'fixture',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: '2026-06-11T09:30:00Z',
        },
      ],
    });

    const exchange = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange',
      headers: { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD },
      payload: {
        deviceId: 'mesh-koreader-001',
        deviceModel: 'E2E',
        pluginVersion: '0.4.0',
        books: [{ hash: fileHash, keys: [], keysComplete: true, changes: [] }],
      },
    });
    expect(exchange.statusCode).toBe(201);
    const result = (exchange.json() as { results: { toApply: { add: { text: string; posFormat: string; pos0: string }[] } }[] }).results[0];
    const added = result.toApply.add.find((entry) => entry.text === 'fixture');
    expect(added).toBeDefined();
    expect(added!.posFormat).toBe('xpointer');
    expect(added!.pos0).toBe(FIXTURE_XPOINTER_0);
  });
});
