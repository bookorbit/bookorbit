import { randomUUID } from 'crypto';

import { and, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
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
import { createEpubFixture, createZipArchiveFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';

type InjectResponse = Awaited<ReturnType<ReaderStateIsolationE2EContext['app']['inject']>>;

const SCENARIO_TIMEOUT_MS = 120_000;
const EPUB_STYLESHEET = 'body { background: #f5f1e8; color: #1f2937; }\nimg { max-width: 100%; }';
const EPUB_BOOKMARKS = 'last-read=OPS/chapter.xhtml#intro';
const PAGE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cQpUAAAAASUVORK5CYII=', 'base64');
const PAGE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8QEA8QDw8QEA8PDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGy0lICUtLS8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBEQACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAABAgME/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6A//xAAYEAEAAwEAAAAAAAAAAAAAAAABABEhMf/aAAgBAQABBQJXJZ//xAAVEQEBAAAAAAAAAAAAAAAAAAABAP/aAAgBAwEBPwGn/8QAFREBAQAAAAAAAAAAAAAAAAAAARD/2gAIAQIBAT8Bp//EABgQAQADAQAAAAAAAAAAAAAAAAEAESEx/9oACAEBAAY/AhGQx//EABsQAQABBQEAAAAAAAAAAAAAAAERACExQVFh/9oACAEBAAE/IV2K4zGq4Jm1q//aAAwDAQACAAMAAAAQ8//EABcRAQEBAQAAAAAAAAAAAAAAAAEREDH/2gAIAQMBAT8Qw0f/xAAWEQEBAQAAAAAAAAAAAAAAAAABEBH/2gAIAQIBAT8QkL//xAAbEAEBAQADAQEAAAAAAAAAAAABEQAhMUFhcf/aAAgBAQABPxC4oLQ1M8JrIoYNewc19hXtOD87mpy4V/mQJu1WDVYj1WFJsbgx5caX//Z',
  'base64',
);

function responseMessage(response: { message?: string | string[] }): string {
  if (Array.isArray(response.message)) return response.message.join(' ');
  return String(response.message ?? '');
}

function expectError(response: InjectResponse, status: number, messageFragment?: string): void {
  expect(response.statusCode).toBe(status);
  if (!messageFragment) return;
  expect(responseMessage(response.json() as { message?: string | string[] })).toContain(messageFragment);
}

function responseBuffer(response: InjectResponse): Buffer {
  const rawPayload = (response as unknown as { rawPayload?: unknown }).rawPayload;
  if (Buffer.isBuffer(rawPayload)) return rawPayload;
  return Buffer.from(response.body, 'binary');
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

async function createReaderDeliveryEpub(rootPath: string, relativePath: string, title: string): Promise<string> {
  const identifier = `urn:uuid:${randomUUID()}`;
  const author = 'Reader Fixture Author';
  const publisher = 'Reader Fixture Publisher';
  const description = 'Reader delivery fixture description';
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;
  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>${escapeXml(publisher)}</dc:publisher>
    <dc:description>${escapeXml(description)}</dc:description>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="styles/reader style.css" media-type="text/css" />
    <item id="cover" href="images/cover image.png" media-type="image/png" properties="cover-image" />
  </manifest>
  <spine>
    <itemref idref="chapter" />
  </spine>
</package>`;
  const chapterXml = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles/reader style.css" /></head><body><h1 id="intro">${escapeXml(title)}</h1><p>fixture chapter</p><img src="images/cover image.png" alt="cover" /></body></html>`;
  const navXml = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${escapeXml(
    title,
  )}</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#intro">Start Reading</a></li></ol></nav></body></html>`;

  return createZipArchiveFixture(rootPath, relativePath, [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: containerXml },
    { path: 'META-INF/calibre_bookmarks.txt', content: EPUB_BOOKMARKS },
    { path: 'OPS/content.opf', content: opfXml },
    { path: 'OPS/chapter.xhtml', content: chapterXml },
    { path: 'OPS/nav.xhtml', content: navXml },
    { path: 'OPS/styles/reader style.css', content: EPUB_STYLESHEET },
    { path: 'OPS/images/cover image.png', content: PAGE_PNG },
    { path: 'OPS/private.txt', content: 'hidden-unmanifested-entry' },
  ]);
}

async function createReaderDeliveryCbz(rootPath: string, relativePath: string, title: string): Promise<string> {
  const comicInfoXml = `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${escapeXml(title)}</Title>
  <Writer>Reader Fixture Cartoonist</Writer>
  <Publisher>Reader Fixture Press</Publisher>
  <Year>2026</Year>
</ComicInfo>`;

  return createZipArchiveFixture(rootPath, relativePath, [
    { path: 'ComicInfo.xml', content: comicInfoXml },
    { path: 'pages/001-cover.png', content: PAGE_PNG },
    { path: 'pages/002-spread.jpg', content: PAGE_JPEG },
    { path: '.hidden/003-secret.png', content: PAGE_PNG },
    { path: 'notes/readme.txt', content: 'not a page' },
  ]);
}

describe('Reader format delivery (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: ReaderStateIsolationE2EContext;

  let sharedLibrary!: Awaited<ReturnType<typeof createLibraryWithFolder>>;
  let hiddenLibrary!: Awaited<ReturnType<typeof createLibraryWithFolder>>;

  let sharedEpub!: LocatedBookFile;
  let sharedCbz!: LocatedBookFile;
  let hiddenEpub!: LocatedBookFile;

  let viewer!: TestUserSession;
  let crossLibraryUser!: TestUserSession;
  let outsider!: TestUserSession;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();

    sharedLibrary = await createLibraryWithFolder(ctx, { name: `reader-delivery-shared-${randomUUID()}` });
    hiddenLibrary = await createLibraryWithFolder(ctx, { name: `reader-delivery-hidden-${randomUUID()}` });

    const sharedEpubPath = await createReaderDeliveryEpub(sharedLibrary.folderPath, 'delivery/reader-delivery.epub', 'Reader Delivery EPUB');
    const sharedCbzPath = await createReaderDeliveryCbz(sharedLibrary.folderPath, 'delivery/reader-delivery.cbz', 'Reader Delivery Comic');
    const hiddenEpubPath = await createEpubFixture(hiddenLibrary.folderPath, 'restricted/hidden-reader.epub', {
      title: 'Hidden Reader EPUB',
    });

    await triggerAndWaitForLibraryScan(ctx, sharedLibrary.libraryId);
    await triggerAndWaitForLibraryScan(ctx, hiddenLibrary.libraryId);

    sharedEpub = await locateBookByAbsolutePath(ctx, sharedEpubPath);
    sharedCbz = await locateBookByAbsolutePath(ctx, sharedCbzPath);
    hiddenEpub = await locateBookByAbsolutePath(ctx, hiddenEpubPath);

    viewer = await createUserAndLogin(ctx);
    crossLibraryUser = await createUserAndLogin(ctx);
    outsider = await createUserAndLogin(ctx);

    await grantLibraryAccess(ctx, viewer.userId, sharedLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, crossLibraryUser.userId, sharedLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, crossLibraryUser.userId, hiddenLibrary.libraryId, 'viewer');
  }, 60_000);

  afterAll(async () => {
    if (ctx) {
      await closeReaderStateIsolationE2EContext(ctx);
    }
  });

  describe('EPUB info and asset delivery', () => {
    it('returns the EPUB info shape the reader expects and serves manifest and optional files', async () => {
      const infoResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/info?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expect(infoResponse.statusCode).toBe(200);

      const info = infoResponse.json() as {
        containerPath: string;
        rootPath: string;
        coverPath: string | null;
        optionalFiles?: string[];
        metadata: Record<string, unknown>;
        spine: Array<{ idref: string; href: string; mediaType: string; linear: boolean }>;
        manifest: Array<{ id: string; href: string; mediaType: string; size: number; properties?: string[] }>;
        toc: { label: string; children?: Array<{ label: string; href?: string }> } | null;
      };
      expect(info).toMatchObject({
        containerPath: 'OPS/content.opf',
        rootPath: 'OPS/',
        coverPath: 'OPS/images/cover image.png',
        optionalFiles: ['META-INF/calibre_bookmarks.txt'],
        metadata: {
          title: 'Reader Delivery EPUB',
          creator: 'Reader Fixture Author',
          language: 'en',
          publisher: 'Reader Fixture Publisher',
          description: 'Reader delivery fixture description',
          identifier: expect.stringContaining('urn:uuid:'),
        },
        spine: [
          {
            idref: 'chapter',
            href: 'OPS/chapter.xhtml',
            mediaType: 'application/xhtml+xml',
            linear: true,
          },
        ],
        toc: {
          label: 'Table of Contents',
          children: [{ label: 'Start Reading', href: 'OPS/chapter.xhtml#intro' }],
        },
      });
      expect(info.manifest).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'chapter', href: 'OPS/chapter.xhtml', mediaType: 'application/xhtml+xml', size: expect.any(Number) }),
          expect.objectContaining({
            id: 'nav',
            href: 'OPS/nav.xhtml',
            mediaType: 'application/xhtml+xml',
            size: expect.any(Number),
            properties: ['nav'],
          }),
          expect.objectContaining({ id: 'style', href: 'OPS/styles/reader style.css', mediaType: 'text/css', size: expect.any(Number) }),
          expect.objectContaining({
            id: 'cover',
            href: 'OPS/images/cover image.png',
            mediaType: 'image/png',
            size: expect.any(Number),
            properties: ['cover-image'],
          }),
        ]),
      );

      const defaultFileInfoResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/info`,
        headers: authHeader(viewer.accessToken),
      });
      expect(defaultFileInfoResponse.statusCode).toBe(200);
      const defaultInfo = defaultFileInfoResponse.json() as { containerPath: string; coverPath: string | null };
      expect(defaultInfo.containerPath).toBe('OPS/content.opf');
      expect(defaultInfo.coverPath).toBe('OPS/images/cover image.png');

      const chapterResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/file/OPS/chapter.xhtml`,
        headers: authHeader(viewer.accessToken),
      });
      expect(chapterResponse.statusCode).toBe(200);
      expect(chapterResponse.headers['content-type']).toContain('application/xhtml+xml');
      expect(chapterResponse.headers['cache-control']).toBe('public, max-age=3600');
      expect(chapterResponse.body).toContain('id="intro"');

      const stylesheetResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/file/OPS/styles/reader%20style.css?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expect(stylesheetResponse.statusCode).toBe(200);
      expect(stylesheetResponse.headers['content-type']).toContain('text/css');
      expect(stylesheetResponse.headers['content-length']).toBe(String(Buffer.byteLength(EPUB_STYLESHEET)));
      expect(stylesheetResponse.headers['cache-control']).toBe('public, max-age=3600');
      expect(stylesheetResponse.body).toBe(EPUB_STYLESHEET);

      const optionalFileResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/file/META-INF/calibre_bookmarks.txt?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expect(optionalFileResponse.statusCode).toBe(200);
      expect(optionalFileResponse.headers['content-type']).toContain('application/octet-stream');
      expect(optionalFileResponse.body).toBe(EPUB_BOOKMARKS);
    });
  });

  describe('EPUB path guards and user scoping', () => {
    it('blocks traversal and unmanifested assets while enforcing library access boundaries', async () => {
      const hiddenInfoForbidden = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${hiddenEpub.bookId}/info?fileId=${hiddenEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(hiddenInfoForbidden, 403, 'No access to this library');

      const hiddenInfoAllowed = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${hiddenEpub.bookId}/info?fileId=${hiddenEpub.bookFileId}`,
        headers: authHeader(crossLibraryUser.accessToken),
      });
      expect(hiddenInfoAllowed.statusCode).toBe(200);
      expect((hiddenInfoAllowed.json() as { metadata: { title?: string } }).metadata.title).toBe('Hidden Reader EPUB');

      const unmanifestedAssetResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/file/OPS/private.txt?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(unmanifestedAssetResponse, 404, 'Entry not in archive: OPS/private.txt');

      const traversalResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/file/%252E%252E/OPS/chapter.xhtml?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(traversalResponse, 403, 'Invalid path');

      const mismatchedFileResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/info?fileId=${hiddenEpub.bookFileId}`,
        headers: authHeader(crossLibraryUser.accessToken),
      });
      expectError(mismatchedFileResponse, 404, `File ${hiddenEpub.bookFileId} not found for book ${sharedEpub.bookId}`);

      const outsiderResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/info?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(outsider.accessToken),
      });
      expectError(outsiderResponse, 403, 'No access to this library');
    });
  });

  describe('CBZ page delivery contract', () => {
    it('returns page counts, streams ordered pages, and rejects invalid page requests and unsupported formats', async () => {
      const pagesResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages`,
        headers: authHeader(viewer.accessToken),
      });
      expect(pagesResponse.statusCode).toBe(200);
      expect(pagesResponse.json()).toEqual({ pageCount: 2 });

      const firstPageResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages/0`,
        headers: authHeader(viewer.accessToken),
      });
      expect(firstPageResponse.statusCode).toBe(200);
      expect(firstPageResponse.headers['content-type']).toContain('image/png');
      expect(firstPageResponse.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(responseBuffer(firstPageResponse)).toEqual(PAGE_PNG);

      const secondPageResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages/1`,
        headers: authHeader(viewer.accessToken),
      });
      expect(secondPageResponse.statusCode).toBe(200);
      expect(secondPageResponse.headers['content-type']).toContain('image/jpeg');
      expect(responseBuffer(secondPageResponse)).toEqual(PAGE_JPEG);

      const negativePageResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages/-1`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(negativePageResponse, 404, 'Page -1 out of range');

      const overflowPageResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages/2`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(overflowPageResponse, 404, 'Page 2 out of range');

      const unsupportedFormatResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedEpub.bookFileId}/pages`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(unsupportedFormatResponse, 404, 'Unsupported comic format: epub');
    });
  });

  describe('reader access revocation', () => {
    it('applies library access changes immediately while leaving other users isolated', async () => {
      await ctx.db
        .delete(schema.userLibraryAccess)
        .where(and(eq(schema.userLibraryAccess.userId, viewer.userId), eq(schema.userLibraryAccess.libraryId, sharedLibrary.libraryId)));

      const revokedEpubInfo = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/info?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(revokedEpubInfo, 403, 'No access to this library');

      const revokedCbzPages = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages`,
        headers: authHeader(viewer.accessToken),
      });
      expectError(revokedCbzPages, 403, 'No access to this library');

      const unaffectedUserEpubInfo = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/epub/${sharedEpub.bookId}/info?fileId=${sharedEpub.bookFileId}`,
        headers: authHeader(crossLibraryUser.accessToken),
      });
      expect(unaffectedUserEpubInfo.statusCode).toBe(200);

      const unaffectedUserCbzPages = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/cbz/files/${sharedCbz.bookFileId}/pages`,
        headers: authHeader(crossLibraryUser.accessToken),
      });
      expect(unaffectedUserCbzPages.statusCode).toBe(200);
      expect(unaffectedUserCbzPages.json()).toEqual({ pageCount: 2 });
    });
  });
});
