import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { readdir, rename, rm } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { KoboDeliveryService } from '../src/modules/kobo/services/kobo-delivery.service';
import { KoboKepubContextService } from '../src/modules/kobo/services/kobo-kepub-context.service';
import { KoboSpanConverterService } from '../src/modules/position-converter/kobo-span-converter.service';
import { KepubifyBinaryService } from '../src/modules/kobo/services/kepubify-binary.service';
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

const DOGEAR_LOCATION = {
  span: {
    startPath: 'span#kobo\\.1\\.1',
    startChar: 0,
    endPath: 'span#kobo\\.1\\.1',
    endChar: 0,
    chapterFilename: 'OPS/chapter.xhtml',
    chapterProgress: 0,
    chapterTitle: 'Chapter 1',
  },
};
const DOGEAR_CFI = 'epubcfi(/6/2!/4/2/1:0)';

const KOREADER_USERNAME = `kobo-mesh-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'KoboMeshDevicePass123';

function flushTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

describe.each(['epub', 'kepub'])('Kobo annotation sync with %s (e2e)', { timeout: 180_000 }, (format) => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let epub!: LocatedBookFile;
  let deviceToken!: string;
  let deviceDbId!: number;
  let contentId!: string;
  let deviceAnnotationId!: string;
  let fileHash!: string;
  let adminUserId!: number;
  const reportedEtags = new Map<string, string>();

  function v3Url(path: string): string {
    return `/api/v1/kobo/${deviceToken}/${path}`;
  }

  async function pullAnnotations(recordEtag = true) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: v3Url(`api/v3/content/${contentId}/annotations`),
      headers: { 'if-none-match': 'W/"0"' },
    });
    expect(response.statusCode).toBe(200);
    const etag = response.headers.etag;
    expect(typeof etag).toBe('string');
    if (recordEtag) reportedEtags.set(contentId, String(etag));
    await flushTick();
    return {
      body: response.json() as { annotations: Record<string, unknown>[]; nextPageOffsetToken: null },
      etag: String(etag),
    };
  }

  async function getAnnotations() {
    return (await pullAnnotations()).body;
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
    const response = await ctx.app.inject({
      method: 'POST',
      url: v3Url('api/v3/content/checkforchanges'),
      payload: [...reportedEtags].map(([ContentId, etag]) => ({ ContentId, etag })),
    });
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
    let epubPath = await createEpubFixture(library.folderPath, 'kobo-sync-book.epub', {
      title: `Kobo Sync Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
    if (format === 'kepub') {
      const nativePath = join(library.folderPath, 'kobo-sync-book.kepub');
      const binary = ctx.app.get(KepubifyBinaryService);
      await promisify(execFile)(await binary.getBinaryPath(), ['--no-add-dummy-titlepage', '--output', `${nativePath}.epub`, epubPath], {
        timeout: 60_000,
      });
      // Keep the paired fixture's spine identical; production conversion remains unchanged.
      // kepubify copies instead of converting when its output does not end in .epub.
      await rename(`${nativePath}.epub`, nativePath);
      await rm(epubPath);
      epubPath = nativePath;
    }
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    epub = await locateBookByAbsolutePath(ctx, epubPath);
    const [scanned] = await ctx.db.select({ format: schema.bookFiles.format }).from(schema.bookFiles).where(eq(schema.bookFiles.id, epub.bookFileId));
    expect(scanned!.format).toBe(format);

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

    const context = await ctx.app.get(KoboKepubContextService).resolveForBook(adminUserId, epub.bookId);
    expect(context.ok).toBe(true);
    if (context.ok) {
      const point = await ctx.app
        .get(KoboSpanConverterService)
        .koboBookmarkToPositions({ bookFileId: context.file.id, ctx: context.ctx, chapterFilename: 'OPS/chapter.xhtml', spanId: 'kobo.1.1' });
      expect(point.reason).toBeUndefined();
      expect(point).toMatchObject({ status: 'exact', cfi: 'epubcfi(/6/2!/4/2/1:0)' });
    }

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
    const transfer = await ctx.app.inject({ method: 'GET', url: v3Url(`v1/books/${contentId}/download`) });
    expect(transfer.statusCode).toBe(200);
    await flushTick();
    const delivery = await ctx.app.get(KoboDeliveryService).current(adminUserId, deviceDbId, epub.bookId);
    expect(delivery?.state).toBe('transfer_observed');
    const deliveredContext = await ctx.app.get(KoboKepubContextService).resolveForBook(adminUserId, epub.bookId, deviceDbId);
    expect(deliveredContext).toMatchObject({ ok: true });
    if (deliveredContext.ok) await deliveredContext.release?.();
  }, 180_000);

  afterAll(async () => {
    if (ctx) {
      if (library) await ctx.db.delete(schema.libraries).where(eq(schema.libraries.id, library.libraryId));
      await closeReaderStateIsolationE2EContext(ctx);
    }
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

  it('retries a hub edit until the device reports the response etag', async () => {
    const [annotation] = await findCanonicalAnnotations();
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${epub.bookId}/annotations/${annotation.id}`,
      headers: authHeader(ctx.adminToken),
      payload: { note: 'hub note retry' },
    });
    expect(edit.statusCode).toBe(200);

    expect(await checkForChanges()).toEqual([contentId]);
    const abandoned = await pullAnnotations(false);
    expect(abandoned.body.annotations[0]).toMatchObject({ noteText: 'hub note retry' });

    expect(await checkForChanges()).toEqual([contentId]);
    reportedEtags.set(contentId, abandoned.etag);
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
          noteText: 'hub note retry',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: served.clientLastModifiedUtc,
        },
      ],
    });

    const [annotation] = await findCanonicalAnnotations();
    expect(annotation).toMatchObject({ note: 'hub note retry', color: '#38BDF8' });
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
    expect(positions.get('cfi')).toMatchObject({ pos0: FIXTURE_CFI });
    expect(positions.get('kobo_span')).toBeUndefined();
    expect((await getAnnotations()).annotations.find((annotation) => annotation.id === webServed.id)?.location).toEqual(webServed.location);
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

    expect(await checkForChanges()).toEqual([]);

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

  it('serves a recomputed KoboSpan Location after an API reader moves the position', async () => {
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
  it('projects KOReader-only xpointers without requiring the web reader to backfill CFI', async () => {
    const note = 'KOReader-only projection';
    const exchange = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/annotations/exchange',
      headers: { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD },
      payload: {
        deviceId: 'mesh-koreader-002',
        deviceModel: 'E2E',
        pluginVersion: '0.4.0',
        books: [
          {
            hash: fileHash,
            keys: [],
            keysComplete: false,
            changes: [
              {
                datetime: '2026-06-12 09:30:00',
                drawer: 'lighten',
                text: 'fixture',
                note,
                posFormat: 'xpointer',
                pos0: FIXTURE_XPOINTER_0,
                pos1: FIXTURE_XPOINTER_1,
              },
            ],
          },
        ],
      },
    });
    expect(exchange.statusCode).toBe(201);
    const annotation = (await findCanonicalAnnotations()).find((row) => row.note === note)!;
    expect(annotation).toBeDefined();
    expect((await findPositions(annotation.id)).get('cfi')).toBeUndefined();
    const served = (await getAnnotations()).annotations.find((row) => row.noteText === note);
    expect(served).toBeDefined();
    expect(served?.location).toMatchObject({ span: { startChar: 0, endChar: 7, chapterFilename: 'OPS/chapter.xhtml' } });
    expect((await findPositions(annotation.id)).get('cfi')).toMatchObject({ status: 'exact', pos0: FIXTURE_CFI });
  });

  async function findBookmarks() {
    return ctx.db
      .select()
      .from(schema.bookmarks)
      .where(and(eq(schema.bookmarks.userId, adminUserId), eq(schema.bookmarks.bookId, epub.bookId)));
  }

  async function findBookmarkLinks() {
    return ctx.db.select().from(schema.koboBookmarkLinks).where(eq(schema.koboBookmarkLinks.deviceId, deviceDbId));
  }

  function dogear(id: string) {
    return { id, type: 'dogear', highlightedText: '', location: DOGEAR_LOCATION, clientLastModifiedUtc: '2026-06-13T08:00:00Z' };
  }

  it('serves a BookOrbit bookmark as a Kobo dogear and waits for its etag acknowledgment', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/bookmarks`,
      headers: authHeader(ctx.adminToken),
      payload: { bookFileId: epub.bookFileId, cfi: DOGEAR_CFI, title: 'BookOrbit bookmark' },
    });
    expect(create.statusCode).toBe(201);

    expect(await checkForChanges()).toContain(contentId);

    const body = await getAnnotations();
    const served = body.annotations.find((row) => row.type === 'dogear') as { id: string; location: typeof DOGEAR_LOCATION } | undefined;
    expect(served).toBeDefined();
    expect(served?.location.span).toMatchObject({
      startPath: 'OPS/chapter.xhtml#kobo.1.1',
      endPath: 'OPS/chapter.xhtml#kobo.1.1',
      startChar: 0,
      endChar: 0,
      chapterTitle: 'BookOrbit bookmark',
    });

    const [pending] = await findBookmarkLinks();
    expect(pending?.appliedAt).toBeNull();
    expect(await checkForChanges()).not.toContain(contentId);
    expect((await findBookmarkLinks())[0]?.appliedAt).not.toBeNull();

    await patchAnnotations({ deletedAnnotationIds: [served!.id] });
    expect((await findBookmarks()).filter((row) => row.deletedAt === null)).toEqual([]);
    expect(await findBookmarkLinks()).toEqual([]);
  });

  it('lands a device dogear as a bookmark and serves it back as a dogear', async () => {
    const dogearId = randomUUID();
    const log = vi.spyOn(Logger.prototype, 'log');
    try {
      await patchAnnotations({ updatedAnnotations: [dogear(dogearId)] });
      const patchEnd = log.mock.calls.map(([line]) => String(line)).find((line) => line.startsWith('[kobo.annotation_patch] [end]'));
      expect(patchEnd).toContain('bookmarksCreated=1');
    } finally {
      log.mockRestore();
    }

    const live = (await findBookmarks()).filter((row) => row.deletedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ origin: 'kobo', title: 'Chapter 1', cfi: DOGEAR_CFI, bookFileId: epub.bookFileId });
    expect((await findCanonicalAnnotations()).filter((row) => row.text === '' && row.deletedAt === null)).toEqual([]);

    await ctx.db.update(schema.bookmarks).set({ bookFileId: null }).where(eq(schema.bookmarks.id, live[0]!.id));

    const served = (await getAnnotations()).annotations.find((row) => row.id === dogearId);
    expect(served).toMatchObject({ type: 'dogear', highlightedText: '' });
    expect(served).not.toHaveProperty('highlightColor');
    expect(served?.location).toEqual(DOGEAR_LOCATION);
    expect((await findBookmarks()).find((row) => row.id === live[0]!.id)?.bookFileId).toBe(epub.bookFileId);
  });

  it('reports a bookmark deleted in BookOrbit and leaves it out of the next pull', async () => {
    const [bookmark] = (await findBookmarks()).filter((row) => row.deletedAt === null);
    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/bookmarks/${bookmark!.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(removed.statusCode).toBe(204);

    expect(await checkForChanges()).toContain(contentId);
    expect((await getAnnotations()).annotations.some((row) => row.type === 'dogear')).toBe(false);
    expect(await checkForChanges()).not.toContain(contentId);
    expect(await findBookmarkLinks()).toEqual([]);
  });

  it('deletes the bookmark when the device deletes its dogear', async () => {
    const dogearId = randomUUID();
    await patchAnnotations({ updatedAnnotations: [dogear(dogearId)] });
    expect((await findBookmarks()).filter((row) => row.deletedAt === null)).toHaveLength(1);

    await patchAnnotations({ deletedAnnotationIds: [dogearId] });

    expect((await findBookmarks()).filter((row) => row.deletedAt === null)).toEqual([]);
    expect(await findBookmarkLinks()).toEqual([]);
  });

  it('keeps a note added to a dogear as the bookmark note and serves it back as that note', async () => {
    const dogearId = randomUUID();
    await patchAnnotations({ updatedAnnotations: [dogear(dogearId)] });
    const [bookmark] = (await findBookmarks()).filter((row) => row.deletedAt === null);

    await patchAnnotations({
      updatedAnnotations: [
        { ...dogear(dogearId), type: 'note', highlightColor: '#F6F3B3', noteText: 'Kobo dogear note', clientLastModifiedUtc: '2099-01-01T00:00:00Z' },
      ],
    });

    expect((await findCanonicalAnnotations()).filter((row) => row.text === '' && row.deletedAt === null)).toEqual([]);
    expect((await findBookmarks()).filter((row) => row.deletedAt === null)).toEqual([
      expect.objectContaining({ id: bookmark!.id, title: 'Chapter 1', note: 'Kobo dogear note' }),
    ]);
    const served = (await getAnnotations()).annotations.find((row) => row.id === dogearId);
    expect(served).toMatchObject({ type: 'note', noteText: 'Kobo dogear note', highlightedText: '', highlightColor: '#F6F3B3' });

    // The device re-sending what it was served, or an older copy, is an echo and leaves the note alone.
    await patchAnnotations({ updatedAnnotations: [dogear(dogearId)] });
    expect((await findBookmarks()).find((row) => row.id === bookmark!.id)?.note).toBe('Kobo dogear note');

    await patchAnnotations({ deletedAnnotationIds: [dogearId] });
  });

  it('lands a dogear the device first uploads with a note as a bookmark with that note', async () => {
    const dogearId = randomUUID();
    await patchAnnotations({
      updatedAnnotations: [{ ...dogear(dogearId), type: 'note', highlightColor: '#F6F3B3', noteText: 'Noted on the device' }],
    });

    expect((await findCanonicalAnnotations()).filter((row) => row.text === '' && row.deletedAt === null)).toEqual([]);
    expect((await findBookmarks()).filter((row) => row.deletedAt === null)).toEqual([
      expect.objectContaining({ origin: 'kobo', title: 'Chapter 1', note: 'Noted on the device' }),
    ]);

    await patchAnnotations({ deletedAnnotationIds: [dogearId] });
  });

  it('moves a dogear stored as an empty highlight to a bookmark under the same id', async () => {
    const legacyId = randomUUID();
    await patchAnnotations({
      updatedAnnotations: [{ ...dogear(legacyId), type: 'highlight', highlightColor: '#C6E09E' }],
    });
    const legacy = (await findCanonicalAnnotations()).find((row) => row.text === '' && row.deletedAt === null);
    expect(legacy).toBeDefined();

    const served = (await getAnnotations()).annotations.find((row) => row.id === legacyId);

    expect(served).toMatchObject({ type: 'dogear' });
    expect((await findCanonicalAnnotations()).find((row) => row.id === legacy!.id)?.deletedAt).not.toBeNull();
    expect((await findBookmarks()).filter((row) => row.deletedAt === null)).toEqual([expect.objectContaining({ origin: 'kobo', cfi: DOGEAR_CFI })]);
    expect(await findBookmarkLinks()).toEqual([expect.objectContaining({ externalKey: legacyId })]);
  });

  it('serves a known annotation at the location the device reported when this copy cannot place it', async () => {
    const highlightId = randomUUID();
    await patchAnnotations({
      updatedAnnotations: [
        {
          id: highlightId,
          type: 'highlight',
          highlightColor: '#C6E09E',
          highlightedText: 'fixture',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: '2026-06-14T08:00:00Z',
        },
      ],
    });
    await getAnnotations();
    const annotation = (await findCanonicalAnnotations()).find((row) => row.deletedAt === null && row.deviceCreatedAt === '2026-06-14 08:00:00')!;
    // Placement fails for every annotation below, so the others leave first; this one is the subject.
    for (const other of (await findCanonicalAnnotations()).filter((row) => row.deletedAt === null && row.id !== annotation.id)) {
      await ctx.db.update(schema.annotations).set({ deletedAt: new Date() }).where(eq(schema.annotations.id, other.id));
    }
    await ctx.db
      .update(schema.annotationPositions)
      .set({ extras: { koboLocation: KOBO_LOCATION, renditionHash: 'an-earlier-copy' } })
      .where(and(eq(schema.annotationPositions.annotationId, annotation.id), eq(schema.annotationPositions.format, 'kobo_span')));
    const placement = vi
      .spyOn(ctx.app.get(KoboSpanConverterService), 'canonicalToKoboSpan')
      .mockResolvedValue({ status: 'failed', reason: 'span_not_found', renditionHash: 'this-copy' });
    try {
      const served = (await getAnnotations()).annotations.find((row) => row.id === highlightId);

      expect(served?.location).toEqual(KOBO_LOCATION);
    } finally {
      placement.mockRestore();
    }
  });

  it('stops rebuilding a book on every check for a new annotation this copy cannot place', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color: '#FB923C', style: 'underline' },
    });
    expect(create.statusCode).toBe(201);
    const createdId = (create.json() as { id: number }).id;
    const placement = vi
      .spyOn(ctx.app.get(KoboSpanConverterService), 'canonicalToKoboSpan')
      .mockResolvedValue({ status: 'failed', reason: 'span_not_found', renditionHash: 'this-copy' });
    try {
      // The check itself rebuilds the book's response, finds nothing new it can serve and records why.
      expect(await checkForChanges()).not.toContain(contentId);
      expect((await findPositions(createdId)).get('kobo_span')).toMatchObject({ status: 'failed', pos0: null });

      // From then on the book is no longer pending, so later checks skip rebuilding it.
      const rebuilds = placement.mock.calls.length;
      expect(await checkForChanges()).not.toContain(contentId);
      expect(placement.mock.calls.length).toBe(rebuilds);
    } finally {
      placement.mockRestore();
    }
  });

  // D-12: the span a highlight made elsewhere was served is never stored, so a device re-save
  // that shortened it used to land as the new text on the old range.
  it('moves a highlight made elsewhere to the range the device re-saved it with', async () => {
    const before = new Set((await getAnnotations()).annotations.map((row) => String(row.id)));
    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color: '#38BDF8', style: 'highlight' },
    });
    expect(create.statusCode).toBe(201);
    const createdId = (create.json() as { id: number }).id;
    const served = (await getAnnotations()).annotations.find((row) => !before.has(String(row.id)))!;
    expect((served.location as typeof KOBO_LOCATION).span).toMatchObject({ startChar: 0, endChar: 7 });
    expect((await findPositions(createdId)).get('kobo_span')).toBeUndefined();

    const shortened = { span: { ...KOBO_LOCATION.span, endChar: 3 } };
    await patchAnnotations({
      updatedAnnotations: [
        {
          id: served.id,
          type: 'highlight',
          highlightColor: served.highlightColor,
          highlightedText: 'fix',
          location: shortened,
          clientLastModifiedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        },
      ],
    });

    const [row] = await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.id, createdId));
    expect(row).toMatchObject({ text: 'fix', version: 2 });
    const positions = await findPositions(createdId);
    expect(positions.get('kobo_span')).toMatchObject({ pos0: 'kobo.1.1:0', pos1: 'kobo.1.1:3', status: 'exact' });
    expect(positions.get('cfi')).toMatchObject({ pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:3)', status: 'exact' });
    expect(positions.get('xpointer')).toMatchObject({ pos0: FIXTURE_XPOINTER_0, pos1: '/body/DocFragment[1]/body/p/text().3', status: 'exact' });

    const reserved = (await getAnnotations()).annotations.find((annotation) => annotation.id === served.id)!;
    expect((reserved.location as typeof KOBO_LOCATION).span).toMatchObject({ startChar: 0, endChar: 3 });
    expect(reserved.highlightedText).toBe('fix');
  });

  it('revoking a Kobo drops its sync rows, and rows of a Kobo already gone no longer block a purge', async () => {
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kobo/devices',
      headers: authHeader(ctx.adminToken),
      payload: { name: 'E2E Kobo to revoke' },
    });
    const secondId = (second.json() as { id: number }).id;
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(ctx.adminToken),
      payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color: '#FB923C', style: 'highlight' },
    });
    const annotationId = (created.json() as { id: number }).id;
    const goneDeviceId = String(secondId + 100_000);
    await ctx.db.insert(schema.annotationSyncState).values([
      { annotationId, userId: adminUserId, source: 'kobo', deviceId: String(secondId), externalKey: randomUUID(), lastAppliedVersion: 1 },
      { annotationId, userId: adminUserId, source: 'kobo', deviceId: goneDeviceId, externalKey: randomUUID(), lastAppliedVersion: 1 },
    ]);
    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/books/${epub.bookId}/annotations/${annotationId}`, headers: authHeader(ctx.adminToken) });

    const blocked = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/annotations/${annotationId}`, headers: authHeader(ctx.adminToken) });
    expect(blocked.statusCode).toBe(409);

    const revoked = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/kobo/devices/${secondId}`, headers: authHeader(ctx.adminToken) });
    expect([200, 204]).toContain(revoked.statusCode);
    const left = await ctx.db.select().from(schema.annotationSyncState).where(eq(schema.annotationSyncState.annotationId, annotationId));
    expect(left.map((row) => row.deviceId)).toEqual([goneDeviceId]);

    const purged = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/annotations/${annotationId}`, headers: authHeader(ctx.adminToken) });
    expect(purged.statusCode).toBe(204);
  });

  it('acknowledges a response the device applied even though the book changed before it reported it', async () => {
    const createHighlight = async (color: string) => {
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${epub.bookId}/annotations`,
        headers: authHeader(ctx.adminToken),
        payload: { cfi: FIXTURE_CFI, bookFileId: epub.bookFileId, text: 'fixture', color, style: 'highlight' },
      });
      expect(created.statusCode).toBe(201);
      return (created.json() as { id: number }).id;
    };
    const koboState = async (annotationId: number) => {
      const [state] = await ctx.db
        .select()
        .from(schema.annotationSyncState)
        .where(
          and(
            eq(schema.annotationSyncState.annotationId, annotationId),
            eq(schema.annotationSyncState.source, 'kobo'),
            eq(schema.annotationSyncState.deviceId, String(deviceDbId)),
          ),
        );
      return state;
    };

    const first = await createHighlight('#4ADE80');
    expect(await checkForChanges()).toEqual([contentId]);
    const applied = await pullAnnotations(false);
    expect((await koboState(first))?.lastAppliedVersion ?? 0).toBe(0);

    const second = await createHighlight('#38BDF8');
    reportedEtags.set(contentId, applied.etag);
    expect(await checkForChanges()).toEqual([contentId]);

    const [row] = await ctx.db.select({ version: schema.annotations.version }).from(schema.annotations).where(eq(schema.annotations.id, first));
    expect((await koboState(first)).lastAppliedVersion).toBe(row.version);
    expect((await koboState(second))?.lastAppliedVersion ?? 0).toBe(0);

    await pullAnnotations();
    expect(await checkForChanges()).toEqual([]);
    expect((await koboState(second)).lastAppliedVersion).toBeGreaterThan(0);
  });

  async function annotationIdForDeviceKey(externalKey: string): Promise<number> {
    const [state] = await ctx.db
      .select({ annotationId: schema.annotationSyncState.annotationId })
      .from(schema.annotationSyncState)
      .where(and(eq(schema.annotationSyncState.source, 'kobo'), eq(schema.annotationSyncState.externalKey, externalKey)));
    return state!.annotationId;
  }

  it('serves an edit made elsewhere to a device highlight as newer than the device own edit', async () => {
    const id = randomUUID();
    const deviceEditedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    await patchAnnotations({
      updatedAnnotations: [
        {
          id,
          type: 'highlight',
          highlightColor: '#F6F3B3',
          highlightedText: 'fixture',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: deviceEditedAt,
        },
      ],
    });
    const annotationId = await annotationIdForDeviceKey(id);
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${epub.bookId}/annotations/${annotationId}`,
      headers: authHeader(ctx.adminToken),
      payload: { note: 'note added on the web' },
    });
    expect(edit.statusCode).toBe(200);

    const served = (await getAnnotations()).annotations.find((annotation) => annotation.id === id)!;
    expect(served).toMatchObject({ type: 'note', noteText: 'note added on the web' });
    expect(Date.parse(String(served.clientLastModifiedUtc))).toBeGreaterThan(Date.parse(deviceEditedAt));
  });

  it('keeps serving the book after the cached conversion the device holds is evicted and rebuilt', async () => {
    const cacheDir = join(ctx.fixture.booksPath, '.kepub-cache', String(epub.bookId));
    const before = await pullAnnotations(false);
    const cached = (await readdir(cacheDir).catch(() => [] as string[])).filter((name) => name.endsWith('.kepub.epub'));
    for (const name of cached) await rm(join(cacheDir, name), { force: true });

    const after = await pullAnnotations(false);

    const served = (pull: typeof before) =>
      pull.body.annotations
        .map((annotation) => {
          const span = (annotation.location as typeof KOBO_LOCATION).span;
          return { id: annotation.id, range: [span.chapterFilename, span.startPath, span.startChar, span.endPath, span.endChar] };
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    expect(served(after)).toEqual(served(before));
  });

  it('offers an edited highlight acked under the previous served clock to the device once more', async () => {
    const id = randomUUID();
    await patchAnnotations({
      updatedAnnotations: [
        {
          id,
          type: 'highlight',
          highlightColor: '#F6F3B3',
          highlightedText: 'fixture',
          location: KOBO_LOCATION,
          clientLastModifiedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        },
      ],
    });
    const annotationId = await annotationIdForDeviceKey(id);
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${epub.bookId}/annotations/${annotationId}`,
      headers: authHeader(ctx.adminToken),
      payload: { color: '#4ADE80' },
    });
    expect(edit.statusCode).toBe(200);
    await getAnnotations();
    expect(await checkForChanges()).toEqual([]);
    const acked = and(eq(schema.annotationSyncState.annotationId, annotationId), eq(schema.annotationSyncState.source, 'kobo'));
    const [state] = await ctx.db.select().from(schema.annotationSyncState).where(acked);
    expect(state!.servedClock).toBe(1);

    await ctx.db.update(schema.annotationSyncState).set({ servedClock: 0 }).where(acked);
    const previousTag = reportedEtags.get(contentId)!;
    reportedEtags.set(contentId, previousTag.replace(/-c\d+"$/, '"'));
    expect(await checkForChanges()).toEqual([contentId]);

    await getAnnotations();
    expect(await checkForChanges()).toEqual([]);
    const [reacked] = await ctx.db.select().from(schema.annotationSyncState).where(acked);
    expect(reacked!.servedClock).toBe(1);
  });
});
