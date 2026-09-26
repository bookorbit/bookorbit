import { and, eq, inArray } from 'drizzle-orm';
import { rm } from 'fs/promises';
import { join } from 'path';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  locateBookFileByRelPath,
  triggerAndWaitForLibraryScan,
  type MetadataWriteE2EContext,
} from './e2e/metadata-write/metadata-write-harness';
import { createEpubFixture, createPdfFixture, writeFixtureFile } from './e2e/metadata-write/metadata-write-fixture-builder';

const SCENARIO_TIMEOUT_MS = 120_000;

type Sweep = {
  status: 'running' | 'completed' | 'failed';
  brokenCovers: number;
  orphanedCoverDirs: number;
};

async function waitForSweep(ctx: MetadataWriteE2EContext): Promise<Sweep> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/missing-resources/sweep',
      headers: authHeader(ctx.adminToken),
    });
    expect(response.statusCode).toBe(200);
    const sweep = response.json() as Sweep | null;
    if (sweep?.status === 'completed') return sweep;
    if (sweep?.status === 'failed') throw new Error('Missing Resources sweep failed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Missing Resources sweep did not complete');
}

describe('Missing Resources slot covers (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: MetadataWriteE2EContext;

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();
  }, 60_000);

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  it('finds, measures, and cleans slot-aware cover resources', async () => {
    const library = await createLibraryWithFolder(ctx, { name: 'Missing Resources slots' });
    await createEpubFixture(library.folderPath, 'covers/valid.epub', { title: 'Valid slot cover' });
    await createPdfFixture(library.folderPath, 'covers/broken.pdf', 'Broken slot cover');
    await createEpubFixture(library.folderPath, 'covers/half.epub', { title: 'Half broken slot covers' });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    const valid = await locateBookFileByRelPath(ctx, library.libraryId, 'covers/valid.epub');
    const broken = await locateBookFileByRelPath(ctx, library.libraryId, 'covers/broken.pdf');
    const half = await locateBookFileByRelPath(ctx, library.libraryId, 'covers/half.epub');
    const now = new Date();
    await ctx.db.delete(schema.bookCovers).where(inArray(schema.bookCovers.bookId, [valid.bookId, broken.bookId, half.bookId]));
    await ctx.db.insert(schema.bookCovers).values([
      {
        bookId: valid.bookId,
        medium: 'ebook',
        source: 'extracted',
        origin: 'embedded',
        updatedAt: now,
      },
      {
        bookId: broken.bookId,
        medium: 'ebook',
        source: 'extracted',
        origin: 'embedded',
        updatedAt: now,
      },
      { bookId: half.bookId, medium: 'ebook', source: 'extracted', origin: 'embedded', updatedAt: now },
      { bookId: half.bookId, medium: 'audio', source: 'custom', origin: 'upload', updatedAt: now },
    ]);
    await ctx.db
      .update(schema.bookMetadata)
      .set({ coverSource: 'extracted', coverUpdatedAt: now, updatedAt: now })
      .where(eq(schema.bookMetadata.bookId, valid.bookId));
    await ctx.db
      .update(schema.bookMetadata)
      .set({ coverSource: 'extracted', coverUpdatedAt: now, updatedAt: now })
      .where(eq(schema.bookMetadata.bookId, broken.bookId));
    await ctx.db
      .update(schema.bookMetadata)
      .set({ coverSource: 'custom', coverUpdatedAt: now, updatedAt: now })
      .where(eq(schema.bookMetadata.bookId, half.bookId));

    await writeFixtureFile(ctx.fixture.booksPath, `covers/${valid.bookId}/ebook/cover_extracted.jpg`, Buffer.from('valid-cover'));
    await rm(join(ctx.fixture.booksPath, 'covers', String(broken.bookId)), { recursive: true, force: true });
    await rm(join(ctx.fixture.booksPath, 'covers', String(half.bookId)), { recursive: true, force: true });
    await writeFixtureFile(ctx.fixture.booksPath, `covers/${half.bookId}/ebook/cover_extracted.jpg`, Buffer.from('half-cover'));
    const orphanBookId = 2_000_000_000;
    const orphanCover = Buffer.from('orphan-cover');
    const orphanThumbnail = Buffer.from('orphan-thumbnail');
    await writeFixtureFile(ctx.fixture.booksPath, `covers/${orphanBookId}/audio/cover_custom.jpg`, orphanCover);
    await writeFixtureFile(ctx.fixture.booksPath, `covers/${orphanBookId}/audio/thumbnail.jpg`, orphanThumbnail);

    const detailResponse = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${valid.bookId}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      coverMedia: ['ebook'],
      covers: {
        ebook: { source: 'extracted', updatedAt: now.toISOString(), width: null, height: null },
        audio: null,
      },
      coverVersion: `ebook:${now.toISOString()}:-`,
    });

    const cardsResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/books/query',
      headers: authHeader(ctx.adminToken),
      payload: { pagination: { page: 0, size: 50 } },
    });
    expect(cardsResponse.statusCode).toBe(201);
    const cards = (cardsResponse.json() as { items: Array<{ id: number; coverVersion: string }> }).items;
    expect(cards.find((card) => card.id === valid.bookId)?.coverVersion).toBe(`ebook:${now.toISOString()}:-`);

    const start = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/maintenance/missing-resources/sweep',
      headers: authHeader(ctx.adminToken),
    });
    expect(start.statusCode).toBe(201);
    const sweep = await waitForSweep(ctx);
    expect(sweep).toMatchObject({ brokenCovers: 2, orphanedCoverDirs: 1 });

    const brokenResponse = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/missing-resources/broken-covers',
      headers: authHeader(ctx.adminToken),
    });
    expect(brokenResponse.statusCode).toBe(200);
    const brokenPage = brokenResponse.json() as { total: number; items: Array<{ id: number }> };
    expect(brokenPage.total).toBe(2);
    expect(brokenPage.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: broken.bookId, coverSource: 'extracted', slots: [{ medium: 'ebook', source: 'extracted' }] }),
        expect.objectContaining({ id: half.bookId, coverSource: 'custom', slots: [{ medium: 'audio', source: 'custom' }] }),
      ]),
    );

    const orphanResponse = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/missing-resources/orphaned-covers',
      headers: authHeader(ctx.adminToken),
    });
    expect(orphanResponse.statusCode).toBe(200);
    expect(orphanResponse.json()).toMatchObject({
      total: 1,
      items: [
        {
          bookId: orphanBookId,
          fileCount: 2,
          sizeBytes: orphanCover.length + orphanThumbnail.length,
          media: ['audio'],
        },
      ],
    });

    const cleanup = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/maintenance/missing-resources/broken-covers/clean',
      headers: authHeader(ctx.adminToken),
      payload: { bookIds: [broken.bookId, half.bookId] },
    });
    expect(cleanup.statusCode).toBe(201);
    expect(cleanup.json()).toMatchObject({ category: 'broken_covers', requested: 2, cleaned: 2, skipped: 0, remaining: 0 });

    const [removedSlot] = await ctx.db
      .select()
      .from(schema.bookCovers)
      .where(and(eq(schema.bookCovers.bookId, broken.bookId), eq(schema.bookCovers.medium, 'ebook')));
    const [brokenMetadata] = await ctx.db
      .select({ coverSource: schema.bookMetadata.coverSource, coverUpdatedAt: schema.bookMetadata.coverUpdatedAt })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, broken.bookId));
    const [validSlot] = await ctx.db.select().from(schema.bookCovers).where(eq(schema.bookCovers.bookId, valid.bookId));
    expect(removedSlot).toBeUndefined();
    expect(brokenMetadata).toMatchObject({ coverSource: null, coverUpdatedAt: expect.any(Date) });
    expect(validSlot).toBeDefined();

    const halfSlots = await ctx.db
      .select({ medium: schema.bookCovers.medium })
      .from(schema.bookCovers)
      .where(eq(schema.bookCovers.bookId, half.bookId));
    const [halfMetadata] = await ctx.db
      .select({ coverSource: schema.bookMetadata.coverSource })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, half.bookId));
    expect(halfSlots).toEqual([{ medium: 'ebook' }]);
    expect(halfMetadata).toEqual({ coverSource: 'extracted' });
  });
});
