import { randomUUID } from 'crypto';

import { and, eq } from 'drizzle-orm';
import { readdir, rm, stat } from 'fs/promises';
import { join } from 'path';

import * as unzipper from 'unzipper';
import { Permission } from '@bookorbit/types';

import { appSettings } from '../src/db/schema/auth';
import { bookCovers } from '../src/db/schema/book-covers';
import { bookFiles, books } from '../src/db/schema/books';
import { bookMetadata } from '../src/db/schema/metadata';
import { CoverSlotBackfillService } from '../src/modules/cover/cover-slot-backfill.service';

import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookFileByRelPath,
  triggerAndWaitForLibraryScan,
  type LocatedBookFile,
  type MetadataWriteE2EContext,
  type TestUserSession,
} from './e2e/metadata-write/metadata-write-harness';
import { createCbzFixture, createEpubFixture, createPdfFixture, writeFixtureFile } from './e2e/metadata-write/metadata-write-fixture-builder';
import { createSlotCoverArtifacts } from './e2e/slot-cover-artifacts';

type InjectResponse = Awaited<ReturnType<MetadataWriteE2EContext['app']['inject']>>;

const SCENARIO_TIMEOUT_MS = 120_000;

function responseMessage(response: { message?: string | string[] }): string {
  if (Array.isArray(response.message)) return response.message.join(' ');
  return String(response.message ?? '');
}

function expectError(response: InjectResponse, status: number, messageFragment?: string): void {
  expect(response.statusCode).toBe(status);
  if (!messageFragment) return;
  expect(responseMessage(response.json() as { message?: string | string[] })).toContain(messageFragment);
}

function zipBuffer(response: InjectResponse): Buffer {
  const rawPayload = (response as unknown as { rawPayload?: unknown }).rawPayload;
  if (Buffer.isBuffer(rawPayload)) return rawPayload;
  return Buffer.from(response.body, 'binary');
}

async function listZipEntries(response: InjectResponse): Promise<string[]> {
  const zip = await unzipper.Open.buffer(zipBuffer(response));
  return zip.files.map((file) => file.path).sort();
}

describe('Book API contract (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: MetadataWriteE2EContext;

  let visibleLibrary!: Awaited<ReturnType<typeof createLibraryWithFolder>>;
  let hiddenLibrary!: Awaited<ReturnType<typeof createLibraryWithFolder>>;
  let visibleLibraryName!: string;
  let hiddenLibraryName!: string;

  let limitedUser!: TestUserSession;
  let crossLibraryUser!: TestUserSession;
  let downloadUser!: TestUserSession;

  let visibleEpub!: LocatedBookFile;
  let visiblePdf!: LocatedBookFile;
  let visibleCbz!: LocatedBookFile;
  let hiddenEpub!: LocatedBookFile;

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();

    visibleLibraryName = `book-api-visible-${randomUUID()}`;
    hiddenLibraryName = `book-api-hidden-${randomUUID()}`;

    visibleLibrary = await createLibraryWithFolder(ctx, {
      name: visibleLibraryName,
    });
    hiddenLibrary = await createLibraryWithFolder(ctx, {
      name: hiddenLibraryName,
    });

    await createEpubFixture(visibleLibrary.folderPath, 'contracts/alpha-contract.epub', {
      title: 'Alpha Contract EPUB',
    });
    await createPdfFixture(visibleLibrary.folderPath, 'contracts/beta-contract.pdf', 'Beta Contract PDF');
    await createCbzFixture(visibleLibrary.folderPath, 'contracts/gamma-contract.cbz', {
      title: 'Gamma Contract Comic',
      author: 'Gamma Cartoonist',
    });
    await createEpubFixture(hiddenLibrary.folderPath, 'restricted/omega-hidden.epub', {
      title: 'Omega Hidden EPUB',
    });

    await triggerAndWaitForLibraryScan(ctx, visibleLibrary.libraryId);
    await triggerAndWaitForLibraryScan(ctx, hiddenLibrary.libraryId);

    visibleEpub = await locateBookFileByRelPath(ctx, visibleLibrary.libraryId, 'contracts/alpha-contract.epub');
    visiblePdf = await locateBookFileByRelPath(ctx, visibleLibrary.libraryId, 'contracts/beta-contract.pdf');
    visibleCbz = await locateBookFileByRelPath(ctx, visibleLibrary.libraryId, 'contracts/gamma-contract.cbz');
    hiddenEpub = await locateBookFileByRelPath(ctx, hiddenLibrary.libraryId, 'restricted/omega-hidden.epub');

    limitedUser = await createUserAndLogin(ctx);
    crossLibraryUser = await createUserAndLogin(ctx);
    downloadUser = await createUserAndLogin(ctx, {
      permissions: [Permission.LibraryDownload],
    });

    await grantLibraryAccess(ctx, limitedUser.userId, visibleLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, crossLibraryUser.userId, visibleLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, crossLibraryUser.userId, hiddenLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, downloadUser.userId, visibleLibrary.libraryId, 'viewer');

    await createSlotCoverArtifacts(ctx, visibleEpub.bookId, {
      coverExtension: 'png',
      coverContent: Buffer.from('cover-png', 'utf8'),
      thumbnailContent: Buffer.from('thumbnail-jpg', 'utf8'),
    });
  }, 60_000);

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  describe('query and search', () => {
    it('returns scoped global and library query results with filters, sorting, and pagination', async () => {
      const filteredQuery = {
        filter: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Contract' }],
        },
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 2 },
      };

      const limitedGlobalQuery = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/books/query',
        headers: authHeader(limitedUser.accessToken),
        payload: filteredQuery,
      });

      expect(limitedGlobalQuery.statusCode).toBe(201);
      expect(limitedGlobalQuery.json()).toMatchObject({
        total: 3,
        page: 0,
        size: 2,
        items: [
          {
            id: visibleEpub.bookId,
            title: 'Alpha Contract EPUB',
            files: [{ id: visibleEpub.bookFileId, format: 'epub', role: 'primary' }],
          },
          {
            id: visiblePdf.bookId,
            title: 'Beta Contract PDF',
            files: [{ id: visiblePdf.bookFileId, format: 'pdf', role: 'primary' }],
          },
        ],
      });

      const libraryQuery = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${visibleLibrary.libraryId}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload: {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['cbz'] }],
          },
          sort: [{ field: 'title', dir: 'asc' }],
          pagination: { page: 0, size: 10 },
        },
      });

      expect(libraryQuery.statusCode).toBe(201);
      expect(libraryQuery.json()).toMatchObject({
        total: 1,
        items: [{ id: visibleCbz.bookId, title: 'Gamma Contract Comic' }],
      });

      const inaccessibleLibraryQuery = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${hiddenLibrary.libraryId}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload: filteredQuery,
      });

      expect(inaccessibleLibraryQuery.statusCode).toBe(403);

      const crossLibraryQuery = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/books/query',
        headers: authHeader(crossLibraryUser.accessToken),
        payload: {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'EPUB' }],
          },
          sort: [{ field: 'title', dir: 'asc' }],
          pagination: { page: 0, size: 10 },
        },
      });

      expect(crossLibraryQuery.statusCode).toBe(201);
      expect(crossLibraryQuery.json()).toMatchObject({
        total: 2,
        items: [
          { id: visibleEpub.bookId, title: 'Alpha Contract EPUB' },
          { id: hiddenEpub.bookId, title: 'Omega Hidden EPUB' },
        ],
      });
    });

    it('returns scoped search results and validates search params', async () => {
      const limitedSearch = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/books/search?q=Contract&limit=20',
        headers: authHeader(limitedUser.accessToken),
      });

      expect(limitedSearch.statusCode).toBe(200);
      expect(limitedSearch.json()).toEqual([
        {
          id: visibleEpub.bookId,
          title: 'Alpha Contract EPUB',
          seriesName: null,
          authors: [],
          libraryId: visibleLibrary.libraryId,
          libraryName: visibleLibraryName,
          formats: ['epub'],
          updatedAt: expect.any(String),
        },
        {
          id: visiblePdf.bookId,
          title: 'Beta Contract PDF',
          seriesName: null,
          authors: [],
          libraryId: visibleLibrary.libraryId,
          libraryName: visibleLibraryName,
          formats: ['pdf'],
          updatedAt: expect.any(String),
        },
        {
          id: visibleCbz.bookId,
          title: 'Gamma Contract Comic',
          seriesName: null,
          authors: ['Gamma Cartoonist'],
          libraryId: visibleLibrary.libraryId,
          libraryName: visibleLibraryName,
          formats: ['cbz'],
          updatedAt: expect.any(String),
        },
      ]);

      const authorSearch = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/books/search?q=Cartoonist&limit=20',
        headers: authHeader(limitedUser.accessToken),
      });

      expect(authorSearch.statusCode).toBe(200);
      expect(authorSearch.json()).toEqual([
        expect.objectContaining({
          id: visibleCbz.bookId,
          title: 'Gamma Contract Comic',
          authors: ['Gamma Cartoonist'],
        }),
      ]);

      const crossLibrarySearch = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/books/search?q=Omega&limit=20',
        headers: authHeader(crossLibraryUser.accessToken),
      });

      expect(crossLibrarySearch.statusCode).toBe(200);
      expect(crossLibrarySearch.json()).toEqual([
        expect.objectContaining({
          id: hiddenEpub.bookId,
          title: 'Omega Hidden EPUB',
          libraryId: hiddenLibrary.libraryId,
          libraryName: hiddenLibraryName,
        }),
      ]);

      const invalidLimit = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/books/search?q=Contract&limit=25',
        headers: authHeader(limitedUser.accessToken),
      });

      expectError(invalidLimit, 400, 'limit must not be greater than 20');
    });

    it('finds subtitle-only matches without exposing books in inaccessible libraries', async () => {
      const [visibleMetadata] = await ctx.db
        .select({ subtitle: bookMetadata.subtitle })
        .from(bookMetadata)
        .where(eq(bookMetadata.bookId, visibleEpub.bookId));
      const [hiddenMetadata] = await ctx.db
        .select({ subtitle: bookMetadata.subtitle })
        .from(bookMetadata)
        .where(eq(bookMetadata.bookId, hiddenEpub.bookId));
      await ctx.db.update(bookMetadata).set({ subtitle: 'The Singapôre Story' }).where(eq(bookMetadata.bookId, visibleEpub.bookId));
      await ctx.db.update(bookMetadata).set({ subtitle: 'A Singapôre Chronicle' }).where(eq(bookMetadata.bookId, hiddenEpub.bookId));

      try {
        const query = await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/books/query',
          headers: authHeader(limitedUser.accessToken),
          payload: { q: 'Singapore', pagination: { page: 0, size: 10 } },
        });
        expect(query.statusCode).toBe(201);
        expect(query.json()).toMatchObject({ total: 1, items: [{ id: visibleEpub.bookId }] });

        const libraryQuery = await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/libraries/${visibleLibrary.libraryId}/books`,
          headers: authHeader(crossLibraryUser.accessToken),
          payload: { q: 'Singapore', pagination: { page: 0, size: 10 } },
        });
        expect(libraryQuery.statusCode).toBe(201);
        expect(libraryQuery.json()).toMatchObject({ total: 1, items: [{ id: visibleEpub.bookId }] });

        const search = await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/books/search?q=Singapore&limit=10',
          headers: authHeader(limitedUser.accessToken),
        });
        expect(search.statusCode).toBe(200);
        expect(search.json()).toEqual([expect.objectContaining({ id: visibleEpub.bookId })]);
      } finally {
        await ctx.db.update(bookMetadata).set({ subtitle: visibleMetadata!.subtitle }).where(eq(bookMetadata.bookId, visibleEpub.bookId));
        await ctx.db.update(bookMetadata).set({ subtitle: hiddenMetadata!.subtitle }).where(eq(bookMetadata.bookId, hiddenEpub.bookId));
      }
    });

    it('filters books by the selected primary file size', async () => {
      const primaryFileSize = (await stat(visibleEpub.absolutePath)).size;
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/books/query',
        headers: authHeader(limitedUser.accessToken),
        payload: {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [
              { type: 'rule', field: 'title', operator: 'eq', value: 'Alpha Contract EPUB' },
              { type: 'rule', field: 'fileSize', operator: 'eq', value: primaryFileSize },
            ],
          },
          sort: [{ field: 'title', dir: 'asc' }],
          pagination: { page: 0, size: 10 },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        total: 1,
        items: [{ id: visibleEpub.bookId, files: [{ id: visibleEpub.bookFileId, role: 'primary', sizeBytes: primaryFileSize }] }],
      });
    });

    it('filters books with audiobook media by whether their audio cover slot is filled', async () => {
      const [pdfFile] = await ctx.db
        .select({ libraryFolderId: bookFiles.libraryFolderId })
        .from(bookFiles)
        .where(eq(bookFiles.id, visiblePdf.bookFileId));
      const [audioFile] = await ctx.db
        .insert(bookFiles)
        .values({
          bookId: visiblePdf.bookId,
          libraryFolderId: pdfFile!.libraryFolderId,
          absolutePath: join(visibleLibrary.folderPath, 'contracts/beta-contract.m4b'),
          relPath: 'contracts/beta-contract.m4b',
          ino: 987_654_321n,
          format: 'm4b',
          role: 'content',
        })
        .returning({ id: bookFiles.id });

      const audioCoverBookIds = async (operator: 'isMissing' | 'isPresent') => {
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/books/query',
          headers: authHeader(limitedUser.accessToken),
          payload: {
            filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'audioCover', operator }] },
            sort: [{ field: 'title', dir: 'asc' }],
            pagination: { page: 0, size: 20 },
          },
        });
        expect(response.statusCode).toBe(201);
        return (response.json() as { items: { id: number }[] }).items.map((item) => item.id);
      };

      try {
        expect(await audioCoverBookIds('isMissing')).toEqual([visiblePdf.bookId]);
        expect(await audioCoverBookIds('isPresent')).toEqual([]);

        await ctx.db.insert(bookCovers).values({ bookId: visiblePdf.bookId, medium: 'audio', source: 'custom', origin: 'upload' });
        expect(await audioCoverBookIds('isMissing')).toEqual([]);
        expect(await audioCoverBookIds('isPresent')).toEqual([visiblePdf.bookId]);

        await ctx.db
          .update(bookCovers)
          .set({ dormantSince: new Date() })
          .where(and(eq(bookCovers.bookId, visiblePdf.bookId), eq(bookCovers.medium, 'audio')));
        expect(await audioCoverBookIds('isMissing')).toEqual([visiblePdf.bookId]);
        expect(await audioCoverBookIds('isPresent')).toEqual([]);
      } finally {
        await ctx.db.delete(bookCovers).where(and(eq(bookCovers.bookId, visiblePdf.bookId), eq(bookCovers.medium, 'audio')));
        await ctx.db.delete(bookFiles).where(eq(bookFiles.id, audioFile!.id));
      }
    });
  });

  describe('bulk query selections', () => {
    it('resolves metadata filters and search without regressing subquery or explicit selections', async () => {
      const metadataCollectionResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/collections',
        headers: authHeader(limitedUser.accessToken),
        payload: { name: `Metadata selection ${randomUUID()}`, icon: 'FolderOpen' },
      });
      expect(metadataCollectionResponse.statusCode).toBe(201);
      const metadataCollection = metadataCollectionResponse.json() as { id: number };

      const metadataAdd = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/collections/${metadataCollection.id}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload: {
          query: {
            libraryId: visibleLibrary.libraryId,
            filter: {
              type: 'group',
              join: 'AND',
              rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Contract' }],
            },
          },
        },
      });
      expect(metadataAdd.statusCode).toBe(201);
      expect(metadataAdd.json()).toMatchObject({ id: metadataCollection.id, bookCount: 3 });

      const subqueryRemove = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/collections/${metadataCollection.id}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload: {
          query: {
            libraryId: visibleLibrary.libraryId,
            filter: {
              type: 'group',
              join: 'AND',
              rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['pdf'] }],
            },
          },
        },
      });
      expect(subqueryRemove.statusCode).toBe(200);
      expect(subqueryRemove.json()).toMatchObject({ id: metadataCollection.id, bookCount: 2 });

      const explicitAdd = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/collections/${metadataCollection.id}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload: { bookIds: [visiblePdf.bookId] },
      });
      expect(explicitAdd.statusCode).toBe(201);
      expect(explicitAdd.json()).toMatchObject({ id: metadataCollection.id, bookCount: 3 });

      const searchCollectionResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/collections',
        headers: authHeader(limitedUser.accessToken),
        payload: { name: `Search selection ${randomUUID()}`, icon: 'FolderSearch' },
      });
      expect(searchCollectionResponse.statusCode).toBe(201);
      const searchCollection = searchCollectionResponse.json() as { id: number };

      const scopedSearchAdd = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/collections/${searchCollection.id}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload: { query: { q: 'EPUB' } },
      });
      expect(scopedSearchAdd.statusCode).toBe(201);
      expect(scopedSearchAdd.json()).toMatchObject({ id: searchCollection.id, bookCount: 1 });
    });
  });

  describe('detail and reader state', () => {
    it('returns detail payload fields and keeps progress and status isolated per user', async () => {
      const saveProgress = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${visibleEpub.bookFileId}/progress`,
        headers: authHeader(limitedUser.accessToken),
        payload: {
          cfi: 'epubcfi(/6/2!/4/1:0)',
          percentage: 42.5,
          positionSeconds: 90,
        },
      });

      expect(saveProgress.statusCode).toBe(201);

      const setStatus = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${visibleEpub.bookId}/status`,
        headers: authHeader(limitedUser.accessToken),
        payload: { status: 'reading' },
      });

      expect(setStatus.statusCode).toBe(200);
      expect(setStatus.json()).toMatchObject({
        status: 'reading',
        source: 'manual',
        startedAt: expect.any(String),
        finishedAt: null,
        updatedAt: expect.any(String),
      });

      const getFileProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visibleEpub.bookFileId}/progress`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(getFileProgress.statusCode).toBe(200);
      expect(getFileProgress.json()).toMatchObject({
        cfi: 'epubcfi(/6/2!/4/1:0)',
        pageNumber: null,
        percentage: 42.5,
      });

      const otherUserFileProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visibleEpub.bookFileId}/progress`,
        headers: authHeader(crossLibraryUser.accessToken),
      });

      expect(otherUserFileProgress.statusCode).toBe(200);
      expect(otherUserFileProgress.json()).toEqual({
        cfi: null,
        pageNumber: null,
        percentage: 0,
        koboLocationSource: null,
        koboLocationType: null,
        koboLocationValue: null,
        koboContentSourceProgressPercent: null,
        koreaderProgress: null,
        positionSeconds: null,
        textUpdatedAt: null,
        narrationPercentage: null,
        narrationUpdatedAt: null,
        mediaOverlaySectionIndex: null,
        mediaOverlayFragment: null,
      });

      const limitedBookProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/progress`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(limitedBookProgress.statusCode).toBe(200);
      expect(limitedBookProgress.json()).toEqual([
        expect.objectContaining({
          fileId: visibleEpub.bookFileId,
          cfi: 'epubcfi(/6/2!/4/1:0)',
          pageNumber: null,
          percentage: 42.5,
        }),
      ]);

      const otherUserBookProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/progress`,
        headers: authHeader(crossLibraryUser.accessToken),
      });

      expect(otherUserBookProgress.statusCode).toBe(200);
      expect(otherUserBookProgress.json()).toEqual([
        {
          fileId: visibleEpub.bookFileId,
          cfi: null,
          pageNumber: null,
          percentage: 0,
          koboLocationSource: null,
          koboLocationType: null,
          koboLocationValue: null,
          koboContentSourceProgressPercent: null,
          koreaderProgress: null,
          positionSeconds: null,
          mediaOverlaySectionIndex: null,
          mediaOverlayFragment: null,
          updatedAt: null,
        },
      ]);

      const limitedDetail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(limitedDetail.statusCode).toBe(200);
      expect(limitedDetail.json()).toMatchObject({
        id: visibleEpub.bookId,
        libraryId: visibleLibrary.libraryId,
        libraryName: visibleLibraryName,
        title: 'Alpha Contract EPUB',
        coverSource: 'custom',
        coverMedia: ['ebook'],
        covers: { ebook: { source: 'custom', updatedAt: expect.any(String), width: null, height: null }, audio: null },
        coverVersion: expect.stringMatching(/^ebook:/),
        files: [
          {
            id: visibleEpub.bookFileId,
            format: 'epub',
            role: 'primary',
            filename: 'alpha-contract.epub',
          },
        ],
        collections: expect.any(Array),
        readStatus: {
          status: 'reading',
          source: 'manual',
        },
      });

      const crossLibraryDetail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}`,
        headers: authHeader(crossLibraryUser.accessToken),
      });

      expect(crossLibraryDetail.statusCode).toBe(200);
      expect(crossLibraryDetail.json()).toMatchObject({
        id: visibleEpub.bookId,
        title: 'Alpha Contract EPUB',
        readStatus: null,
      });

      const inaccessibleDetail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${hiddenEpub.bookId}`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(inaccessibleDetail.statusCode).toBe(404);
    });
  });

  describe('file delivery and export', () => {
    it('serves files inline and as downloads, enforces range semantics, and rejects inaccessible files', async () => {
      const inlinePdf = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visiblePdf.bookFileId}/serve`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(inlinePdf.statusCode).toBe(200);
      expect(inlinePdf.headers['content-type']).toContain('application/pdf');
      expect(inlinePdf.headers['accept-ranges']).toBe('bytes');
      expect(Number(inlinePdf.headers['content-length'])).toBeGreaterThan(0);
      expect(String(inlinePdf.headers['content-disposition'])).toContain('inline;');

      const rangedPdf = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visiblePdf.bookFileId}/serve`,
        headers: {
          ...authHeader(limitedUser.accessToken),
          range: 'bytes=0-9',
        },
      });

      expect(rangedPdf.statusCode).toBe(206);
      expect(rangedPdf.headers['content-range']).toBe(`bytes 0-9/${inlinePdf.headers['content-length']}`);
      expect(rangedPdf.headers['content-length']).toBe('10');

      const invalidRange = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visiblePdf.bookFileId}/serve`,
        headers: {
          ...authHeader(limitedUser.accessToken),
          range: `bytes=${Number(inlinePdf.headers['content-length']) + 10}-${Number(inlinePdf.headers['content-length']) + 20}`,
        },
      });

      expect(invalidRange.statusCode).toBe(416);
      expect(invalidRange.headers['content-range']).toBe(`bytes */${inlinePdf.headers['content-length']}`);

      const forbiddenDownloadEpub = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visibleEpub.bookFileId}/download`,
        headers: authHeader(limitedUser.accessToken),
      });
      expect(forbiddenDownloadEpub.statusCode).toBe(403);

      const downloadEpub = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${visibleEpub.bookFileId}/download`,
        headers: authHeader(downloadUser.accessToken),
      });

      expect(downloadEpub.statusCode).toBe(200);
      expect(downloadEpub.headers['content-type']).toContain('application/epub+zip');
      expect(String(downloadEpub.headers['content-disposition'])).toContain('attachment;');
      expect(String(downloadEpub.headers['content-disposition'])).toContain('alpha-contract.epub');

      const inaccessibleServe = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${hiddenEpub.bookFileId}/serve`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(inaccessibleServe.statusCode).toBe(403);
    });

    it('exports selected books as a zip and rejects unauthorized selections', async () => {
      const exportResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/books/export',
        headers: authHeader(downloadUser.accessToken),
        payload: {
          bookIds: [visibleEpub.bookId, visiblePdf.bookId],
          allFormats: false,
        },
      });

      expect(exportResponse.statusCode).toBe(201);
      expect(exportResponse.headers['content-type']).toContain('application/zip');
      expect(exportResponse.headers['content-disposition']).toBe('attachment; filename="books.zip"; filename*=UTF-8\'\'books.zip');

      const zipEntries = await listZipEntries(exportResponse);
      expect(zipEntries).toEqual(['alpha-contract.epub', 'beta-contract.pdf']);

      const unauthorizedExport = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/books/export',
        headers: authHeader(downloadUser.accessToken),
        payload: {
          bookIds: [visibleEpub.bookId, hiddenEpub.bookId],
          allFormats: false,
        },
      });

      expect(unauthorizedExport.statusCode).toBe(403);
    });
  });

  describe('cover and thumbnail caching', () => {
    it('serves cover and thumbnail with ETags and returns 404 when artifacts are missing', async () => {
      const cover = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/cover`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(cover.statusCode).toBe(200);
      expect(cover.headers['content-type']).toContain('image/png');
      expect(cover.headers.etag).toBeTruthy();
      expect(cover.headers['cache-control']).toBe('private, max-age=86400');

      const invalidMedium = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/cover?medium=print`,
        headers: authHeader(limitedUser.accessToken),
      });
      expectError(invalidMedium, 400);

      const invalidStrict = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/cover?strict=yes`,
        headers: authHeader(limitedUser.accessToken),
      });
      expectError(invalidStrict, 400);

      const cachedCover = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/cover`,
        headers: {
          ...authHeader(limitedUser.accessToken),
          'if-none-match': String(cover.headers.etag),
        },
      });

      expect(cachedCover.statusCode).toBe(304);
      expect(cachedCover.headers.etag).toBe(cover.headers.etag);

      const thumbnail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/thumbnail`,
        headers: authHeader(limitedUser.accessToken),
      });

      expect(thumbnail.statusCode).toBe(200);
      expect(thumbnail.headers['content-type']).toContain('image/jpeg');
      expect(thumbnail.headers.etag).toBeTruthy();
      expect(thumbnail.headers['cache-control']).toBe('private, max-age=86400');

      const cachedThumbnail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/thumbnail`,
        headers: {
          ...authHeader(limitedUser.accessToken),
          'if-none-match': String(thumbnail.headers.etag),
        },
      });

      expect(cachedThumbnail.statusCode).toBe(304);
      expect(cachedThumbnail.headers.etag).toBe(thumbnail.headers.etag);

      await rm(join(ctx.fixture.booksPath, 'covers', String(visibleEpub.bookId)), {
        recursive: true,
        force: true,
      });

      const missingCover = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/cover`,
        headers: authHeader(limitedUser.accessToken),
      });

      expectError(missingCover, 404, `No cover for book ${visibleEpub.bookId}`);

      const missingThumbnail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${visibleEpub.bookId}/thumbnail`,
        headers: authHeader(limitedUser.accessToken),
      });

      expectError(missingThumbnail, 404, `No thumbnail for book ${visibleEpub.bookId}`);
    });

    it('restores a cover summary that disagrees with the slots when the upgrade runs, without moving updated_at', async () => {
      await ctx.db.insert(bookCovers).values({ bookId: visibleCbz.bookId, medium: 'ebook', source: 'custom', origin: 'upload' });
      await ctx.db.update(bookMetadata).set({ coverSource: null }).where(eq(bookMetadata.bookId, visibleCbz.bookId));
      const [before] = await ctx.db
        .select({ updatedAt: bookMetadata.updatedAt })
        .from(bookMetadata)
        .where(eq(bookMetadata.bookId, visibleCbz.bookId));
      const marker = JSON.stringify({ version: 3, stage: 'c', lastBookId: 0 });
      await ctx.db
        .insert(appSettings)
        .values({ key: 'cover_slots_backfill', value: marker })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: marker } });
      try {
        const result = await ctx.app.get(CoverSlotBackfillService).run();

        expect(result.repaired).toBeGreaterThanOrEqual(1);
        const [after] = await ctx.db
          .select({ coverSource: bookMetadata.coverSource, updatedAt: bookMetadata.updatedAt })
          .from(bookMetadata)
          .where(eq(bookMetadata.bookId, visibleCbz.bookId));
        expect(after).toEqual({ coverSource: 'custom', updatedAt: before!.updatedAt });
        await expect(ctx.app.get(CoverSlotBackfillService).run()).resolves.toMatchObject({ repaired: 0 });
      } finally {
        await ctx.db.delete(bookCovers).where(eq(bookCovers.bookId, visibleCbz.bookId));
        await ctx.db.update(bookMetadata).set({ coverSource: null }).where(eq(bookMetadata.bookId, visibleCbz.bookId));
      }
    });

    it('moves a cover left in the old root layout into its slot on first read, with no coverSource needed', async () => {
      const coverDir = join(ctx.fixture.booksPath, 'covers', String(visibleCbz.bookId));
      await writeFixtureFile(ctx.fixture.booksPath, `covers/${visibleCbz.bookId}/cover_custom.jpg`, Buffer.from('legacy-cover', 'utf8'));
      await writeFixtureFile(ctx.fixture.booksPath, `covers/${visibleCbz.bookId}/thumbnail.jpg`, Buffer.from('legacy-thumbnail', 'utf8'));
      try {
        const thumbnail = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/books/${visibleCbz.bookId}/thumbnail`,
          headers: authHeader(limitedUser.accessToken),
        });
        expect(thumbnail.statusCode).toBe(200);
        expect(thumbnail.body).toBe('legacy-thumbnail');

        const slots = await ctx.db.select().from(bookCovers).where(eq(bookCovers.bookId, visibleCbz.bookId));
        expect(slots).toEqual([expect.objectContaining({ medium: 'ebook', source: 'custom', origin: 'legacy', dormantSince: null })]);
        expect(await readdir(coverDir)).toEqual(['ebook']);
        expect((await readdir(join(coverDir, 'ebook'))).sort()).toEqual(['cover_custom.jpg', 'thumbnail.jpg']);

        const cover = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/books/${visibleCbz.bookId}/cover`,
          headers: authHeader(limitedUser.accessToken),
        });
        expect(cover.statusCode).toBe(200);
        expect(cover.body).toBe('legacy-cover');
      } finally {
        await ctx.db.delete(bookCovers).where(eq(bookCovers.bookId, visibleCbz.bookId));
        await ctx.db.update(bookMetadata).set({ coverSource: null }).where(eq(bookMetadata.bookId, visibleCbz.bookId));
        await rm(coverDir, { recursive: true, force: true });
      }
    });
  });

  describe('user-supplied added dates', () => {
    // Issue #1143: an added date the user typed, such as year 0025, came back from Postgres
    // as an Invalid Date, so serializing the card threw and every listing holding the book
    // answered 500. These are the year bands the driver's own decoder gets wrong.
    it.each(['0025-08-25', '0013-01-01', '0031-12-31', '0050-06-15', '0001-01-01'])(
      'round-trips an added date of %s through storage and back into a listing',
      async (addedAt) => {
        const bookId = hiddenEpub.bookId;
        const [original] = await ctx.db.select({ addedAt: books.addedAt }).from(books).where(eq(books.id, bookId));
        const expected = `${addedAt}T00:00:00.000Z`;

        try {
          const update = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/v1/books/${bookId}/added-at`,
            headers: authHeader(ctx.adminToken),
            payload: { addedAt },
          });

          expect(update.statusCode).toBe(200);
          expect((update.json() as { addedAt: string | null }).addedAt).toBe(expected);

          const listing = await ctx.app.inject({
            method: 'POST',
            url: '/api/v1/books/query',
            headers: authHeader(ctx.adminToken),
            payload: { pagination: { page: 0, size: 200 } },
          });

          expect(listing.statusCode).toBe(201);
          const items = (listing.json() as { items: { id: number; addedAt: string }[] }).items;
          expect(items.find((item) => item.id === bookId)?.addedAt).toBe(expected);
        } finally {
          await ctx.db.update(books).set({ addedAt: original!.addedAt }).where(eq(books.id, bookId));
        }
      },
    );
  });
});
