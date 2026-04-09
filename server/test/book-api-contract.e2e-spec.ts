import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { join } from 'path';

import * as unzipper from 'unzipper';
import { Permission } from '@projectx/types';

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

async function createBookCoverArtifacts(
  ctx: MetadataWriteE2EContext,
  bookId: number,
  options: {
    coverExtension?: 'jpg' | 'png';
    coverContent?: Buffer;
    thumbnailContent?: Buffer;
  } = {},
): Promise<void> {
  const coverExtension = options.coverExtension ?? 'jpg';
  await writeFixtureFile(
    ctx.fixture.booksPath,
    `covers/${bookId}/cover_custom.${coverExtension}`,
    options.coverContent ?? Buffer.from(`cover-${bookId}`, 'utf8'),
  );
  await writeFixtureFile(
    ctx.fixture.booksPath,
    `covers/${bookId}/thumbnail.jpg`,
    options.thumbnailContent ?? Buffer.from(`thumbnail-${bookId}`, 'utf8'),
  );
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

    await createBookCoverArtifacts(ctx, visibleEpub.bookId, {
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
        },
        {
          id: visiblePdf.bookId,
          title: 'Beta Contract PDF',
          seriesName: null,
          authors: [],
          libraryId: visibleLibrary.libraryId,
          libraryName: visibleLibraryName,
          formats: ['pdf'],
        },
        {
          id: visibleCbz.bookId,
          title: 'Gamma Contract Comic',
          seriesName: null,
          authors: ['Gamma Cartoonist'],
          libraryId: visibleLibrary.libraryId,
          libraryName: visibleLibraryName,
          formats: ['cbz'],
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

      expect(setStatus.statusCode).toBe(204);

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
        coverSource: null,
        files: [
          {
            id: visibleEpub.bookFileId,
            format: 'epub',
            role: 'primary',
            filename: 'alpha-contract.epub',
          },
        ],
        collections: [],
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

      expect(inaccessibleDetail.statusCode).toBe(403);
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
      expect(exportResponse.headers['content-disposition']).toBe('attachment; filename="books.zip"');

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
  });
});
