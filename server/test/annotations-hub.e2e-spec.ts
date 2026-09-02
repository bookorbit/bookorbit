import { randomUUID } from 'crypto';

import { createEpubFixture, createPdfFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

const FIXTURE_CFI = 'epubcfi(/6/2!/4/2,/1:0,/1:7)';

describe('Annotations hub (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let epub!: LocatedBookFile;
  let library!: Awaited<ReturnType<typeof createLibraryWithFolder>>;
  let owner!: TestUserSession;
  let outsider!: TestUserSession;
  const createdIds: number[] = [];

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `annotations-hub-${randomUUID()}` });
    const epubPath = await createEpubFixture(library.folderPath, 'hub-book.epub', {
      title: `Hub Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    epub = await locateBookByAbsolutePath(ctx, epubPath);

    owner = await createUserAndLogin(ctx);
    outsider = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, owner.userId, library.libraryId, 'viewer');

    for (const note of ['first', 'second', 'third']) {
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${epub.bookId}/annotations`,
        headers: authHeader(owner.accessToken),
        payload: { cfi: FIXTURE_CFI, text: 'fixture', color: '#FACC15', style: 'highlight', note },
      });
      expect(created.statusCode).toBe(201);
      createdIds.push((created.json() as { id: number }).id);
    }
  }, 120_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('lists annotations across books with book titles and filters', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/annotations?status=active&search=second',
      headers: authHeader(owner.accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { note: string | null; bookTitle: string | null; jumpFileId: number | null }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].note).toBe('second');
    // The e2e harness mocks metadata extraction, so the title may be null here.
    expect(body.items[0]).toHaveProperty('bookTitle');
    expect(body.items[0].jumpFileId).toBe(epub.bookFileId);
  });

  it('surfaces a PDF highlight in the hub with the fields a page deep link needs', async () => {
    const marker = `pdfmarker-${randomUUID()}`;
    const pdfPath = await createPdfFixture(library.folderPath, `hub-pdf-${randomUUID()}.pdf`, `Hub PDF ${randomUUID()}`);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const pdf = await locateBookByAbsolutePath(ctx, pdfPath);

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${pdf.bookId}/annotations`,
      headers: authHeader(owner.accessToken),
      payload: {
        pdf: { page: 3, rect: { x: 10, y: 20, width: 100, height: 12 }, rects: [{ x: 10, y: 20, width: 100, height: 12 }] },
        bookFileId: pdf.bookFileId,
        text: marker,
        color: '#FACC15',
        style: 'highlight',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { cfi: string | null; pageno: number | null; pdf: { page: number } | null };
    expect(createdBody.cfi).toBeNull();
    expect(createdBody.pageno).toBe(4);
    expect(createdBody.pdf).toMatchObject({ page: 3 });

    const filePage = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${pdf.bookId}/annotations?page=1&pageSize=100&bookFileId=${pdf.bookFileId}&sortBy=position&sortDir=asc`,
      headers: authHeader(owner.accessToken),
    });
    expect(filePage.statusCode).toBe(200);
    const filePageBody = filePage.json() as { items: { jumpFileId: number | null; pdf: { page: number } | null }[]; total: number };
    expect(filePageBody.total).toBe(1);
    expect(filePageBody.items[0]).toMatchObject({ jumpFileId: pdf.bookFileId, pdf: { page: 3 } });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/annotations?status=active&search=${marker}`,
      headers: authHeader(owner.accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: { cfi: string | null; jumpFileId: number | null; jumpFileFormat: string | null; pageno: number | null }[];
      total: number;
    };
    expect(body.total).toBe(1);
    // These are exactly the fields annotationReaderRoute() uses to build ?format=pdf&page=4.
    expect(body.items[0]).toMatchObject({ jumpFileId: pdf.bookFileId, jumpFileFormat: 'pdf', cfi: null, pageno: 4 });

    const geometry = { page: 0, rect: { x: 1, y: 2, width: 3, height: 4 }, rects: [{ x: 1, y: 2, width: 3, height: 4 }] };
    const missingFile = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${pdf.bookId}/annotations`,
      headers: authHeader(owner.accessToken),
      payload: { pdf: geometry, text: 'missing file id' },
    });
    expect(missingFile.statusCode).toBe(400);

    const wrongBook = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${pdf.bookId}/annotations`,
      headers: authHeader(owner.accessToken),
      payload: { pdf: geometry, bookFileId: epub.bookFileId, text: 'wrong book' },
    });
    expect(wrongBook.statusCode).toBe(400);

    const wrongFormat = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/annotations`,
      headers: authHeader(owner.accessToken),
      payload: { pdf: geometry, bookFileId: epub.bookFileId, text: 'wrong format' },
    });
    expect(wrongFormat.statusCode).toBe(400);
  });

  it('is isolated per user', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/annotations',
      headers: authHeader(outsider.accessToken),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { total: number }).total).toBe(0);

    const bulk = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/annotations/bulk',
      headers: authHeader(outsider.accessToken),
      payload: { ids: createdIds, action: 'trash' },
    });
    expect(bulk.statusCode).toBe(200);
    expect((bulk.json() as { affected: number }).affected).toBe(0);
  });

  it('bulk trashes, lists in trash, restores and purges', async () => {
    const bulk = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/annotations/bulk',
      headers: authHeader(owner.accessToken),
      payload: { ids: [createdIds[0], createdIds[1]], action: 'trash' },
    });
    expect(bulk.statusCode).toBe(200);
    expect((bulk.json() as { affected: number }).affected).toBe(2);

    const trash = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/annotations?status=trashed',
      headers: authHeader(owner.accessToken),
    });
    expect((trash.json() as { total: number }).total).toBe(2);

    const restore = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/annotations/${createdIds[0]}/restore`,
      headers: authHeader(owner.accessToken),
    });
    expect(restore.statusCode).toBe(200);
    expect((restore.json() as { deletedAt: string | null }).deletedAt).toBeNull();

    // No device ever synced these, so the purge is not blocked.
    const purge = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/annotations/${createdIds[1]}`,
      headers: authHeader(owner.accessToken),
    });
    expect(purge.statusCode).toBe(204);

    const trashAfter = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/annotations?status=trashed',
      headers: authHeader(owner.accessToken),
    });
    expect((trashAfter.json() as { total: number }).total).toBe(0);
  });

  it('bulk recolors active annotations', async () => {
    const bulk = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/annotations/bulk',
      headers: authHeader(owner.accessToken),
      payload: { ids: createdIds, action: 'restyle', color: '#4ADE80' },
    });
    expect(bulk.statusCode).toBe(200);
    expect((bulk.json() as { affected: number }).affected).toBeGreaterThan(0);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/annotations?colors=%234ADE80',
      headers: authHeader(owner.accessToken),
    });
    expect((list.json() as { total: number }).total).toBeGreaterThan(0);
  });

  it('exports markdown with attachment headers', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/annotations/export?format=md',
      headers: authHeader(owner.accessToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('markdown');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.body).toContain('# Annotations');
    expect(response.body).toContain('> fixture');
  });

  it('rejects unauthenticated access', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/annotations' });
    expect(response.statusCode).toBe(401);
  });
});
