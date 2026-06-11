import { randomUUID } from 'crypto';

import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
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
  let owner!: TestUserSession;
  let outsider!: TestUserSession;
  const createdIds: number[] = [];

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: `annotations-hub-${randomUUID()}` });
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
