import { execFile } from 'child_process';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { djvuBundleFixture, djvuPageFixture } from './e2e/djvu-fixture';
import { randomUUID } from 'crypto';
import { waitForCondition } from './e2e/app-harness';
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

describe('DjVuLibre reader (e2e)', { timeout: 60_000 }, () => {
  let ctx: ReaderStateIsolationE2EContext;
  let book: LocatedBookFile;
  let reader: TestUserSession;
  let secondReader: TestUserSession;
  let outsider: TestUserSession;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext({ realMetadata: true, multipart: true });
    const library = await createLibraryWithFolder(ctx);
    const path = join(library.folderPath, 'scanned-book.djvu');
    await writeFile(path, djvuBundleFixture());
    await writeFile(join(library.folderPath, 'ocr.txt'), '(page 0 0 80 120 (line 0 0 80 20 (word 0 0 80 20 "Embedded sample text")))');
    await promisify(execFile)('djvused', [path, '-s', '-e', 'select 1; set-txt ocr.txt'], { cwd: library.folderPath });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    book = await locateBookByAbsolutePath(ctx, path);
    reader = await createUserAndLogin(ctx);
    secondReader = await createUserAndLogin(ctx);
    outsider = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);
    await grantLibraryAccess(ctx, secondReader.userId, library.libraryId);
  }, 120_000);
  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  function get(suffix: string, token = reader.accessToken, extraHeaders: Record<string, string> = {}) {
    return ctx.app.inject({
      method: 'GET',
      url: `/api/v1/djvu/files/${book.bookFileId}/pages${suffix}`,
      headers: { ...authHeader(token), ...extraHeaders },
    });
  }

  function upload(url: string, filename: string, bytes: Buffer, token = ctx.adminToken, extraHeaders: Record<string, string> = {}) {
    const boundary = `djvu-${randomUUID()}`;
    return ctx.app.inject({
      method: 'POST',
      url,
      headers: { ...authHeader(token), 'content-type': `multipart/form-data; boundary=${boundary}`, ...extraHeaders },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/vnd.djvu\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }

  it('extracts page count and first-page covers during scanning and exposes file metadata', async () => {
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}`, headers: authHeader(reader.accessToken) });
    expect(detail.json()).toMatchObject({ pageCount: 2, title: 'scanned-book' });
    const cover = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/cover`, headers: authHeader(reader.accessToken) });
    expect(cover.statusCode).toBe(200);
    expect((await sharp(cover.rawPayload).metadata()).width).toBeGreaterThan(0);
    const metadata = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.bookId}/metadata-from-file`,
      headers: authHeader(ctx.adminToken),
    });
    expect(metadata.json()).toMatchObject({ title: 'scanned-book', pageCount: 2 });
  });

  it('imports DjVu through library upload and keeps library format restrictions', async () => {
    const library = await createLibraryWithFolder(ctx, { allowedFormats: ['djvu'] });
    const result = await upload(`/api/v1/libraries/${library.libraryId}/upload`, 'uploaded.DJVU', djvuBundleFixture());
    expect(result.statusCode).toBe(201);
    expect(result.json()).toMatchObject({ format: 'djvu' });
    const uploadedId = result.json<{ bookId: number }>().bookId;
    await waitForCondition(
      async () => {
        const detail = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${uploadedId}`, headers: authHeader(ctx.adminToken) });
        expect(detail.json<{ pageCount: number | null }>().pageCount).toBe(2);
        const cover = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${uploadedId}/cover`, headers: authHeader(ctx.adminToken) });
        expect(cover.statusCode).toBe(200);
      },
      15_000,
      100,
    );
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${uploadedId}/cover`, headers: authHeader(ctx.adminToken) })).statusCode).toBe(
      200,
    );
    const restricted = await createLibraryWithFolder(ctx, { allowedFormats: ['epub'] });
    expect((await upload(`/api/v1/libraries/${restricted.libraryId}/upload`, 'rejected.djvu', djvuPageFixture())).statusCode).toBe(400);
    expect((await upload(`/api/v1/libraries/${library.libraryId}/upload`, 'corrupt.djvu', Buffer.from('not a DjVu document'))).statusCode).toBe(400);
  });

  it('advertises DjVu and imports a resumed upload without losing document bytes', async () => {
    const capabilities = await ctx.app.inject({ method: 'GET', url: '/api/v1/uploads/capabilities', headers: authHeader(ctx.adminToken) });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json<{ supportedFormats: string[] }>().supportedFormats).toContain('djvu');
    const library = await createLibraryWithFolder(ctx, { allowedFormats: ['djvu'] });
    const bytes = djvuBundleFixture();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/uploads',
      headers: authHeader(ctx.adminToken),
      payload: {
        filename: 'resumed.djvu',
        sizeBytes: bytes.length,
        idempotencyKey: randomUUID(),
        target: { kind: 'library', libraryId: library.libraryId },
        contentType: 'image/vnd.djvu',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;
    const split = Math.floor(bytes.length / 2);
    const first = await upload(`/api/v1/uploads/${id}/chunks`, 'chunk', bytes.subarray(0, split), ctx.adminToken, { 'upload-offset': '0' });
    expect(first.statusCode).toBe(201);
    const resumed = await ctx.app.inject({ method: 'GET', url: `/api/v1/uploads/${id}`, headers: authHeader(ctx.adminToken) });
    expect(resumed.json()).toMatchObject({ receivedBytes: split, status: 'receiving' });
    const second = await upload(`/api/v1/uploads/${id}/chunks`, 'chunk', bytes.subarray(split), ctx.adminToken, { 'upload-offset': String(split) });
    expect(second.statusCode).toBe(201);
    const completed = await ctx.app.inject({ method: 'POST', url: `/api/v1/uploads/${id}/complete`, headers: authHeader(ctx.adminToken) });
    expect(completed.statusCode).toBe(202);
    let importedId = 0;
    await waitForCondition(
      async () => {
        const status = await ctx.app.inject({ method: 'GET', url: `/api/v1/uploads/${id}`, headers: authHeader(ctx.adminToken) });
        const result = status.json<{ status: string; bookId: number }>();
        expect(result.status).toBe('completed');
        expect(result.bookId).toBeGreaterThan(0);
        importedId = result.bookId;
      },
      15_000,
      100,
    );
    const files = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${importedId}`, headers: authHeader(ctx.adminToken) });
    const fileId = files.json<{ files: { id: number }[] }>().files[0]!.id;
    const download = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/files/${fileId}/download`, headers: authHeader(ctx.adminToken) });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(bytes);
    const pages = await ctx.app.inject({ method: 'GET', url: `/api/v1/djvu/files/${fileId}/pages`, headers: authHeader(ctx.adminToken) });
    expect(pages.json()).toEqual({ pageCount: 2 });
  });

  it('accepts DjVu in the Book Dock and extracts its cover and page count', async () => {
    const result = await upload('/api/v1/book-dock/upload', 'dock.djvu', djvuPageFixture());
    expect(result.statusCode).toBe(201);
    const id = result.json<{ id: number }>().id;
    await waitForCondition(
      async () => {
        const detail = await ctx.app.inject({ method: 'GET', url: `/api/v1/book-dock/files/${id}`, headers: authHeader(ctx.adminToken) });
        const data = detail.json<{ status: string; embeddedMetadata: { pageCount?: number } }>();
        expect(data.status).toBe('ready');
        expect(data.embeddedMetadata?.pageCount).toBe(1);
        const cover = await ctx.app.inject({ method: 'GET', url: `/api/v1/book-dock/files/${id}/cover`, headers: authHeader(ctx.adminToken) });
        expect(cover.statusCode).toBe(200);
      },
      15_000,
      100,
    );
  });

  it('adds a DjVu edition to an existing folder book and delivers its original MIME type', async () => {
    const library = await createLibraryWithFolder(ctx, { mode: 'book_per_folder' });
    const first = await upload(`/api/v1/libraries/${library.libraryId}/upload`, 'base.djvu', djvuPageFixture());
    expect(first.statusCode).toBe(201);
    const bookId = first.json<{ bookId: number }>().bookId;
    const added = await upload(`/api/v1/books/${bookId}/files`, 'bundle.djvu', djvuBundleFixture());
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ format: 'djvu', role: 'content' });
    const fileId = added.json<{ id: number }>().id;
    const download = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/files/${fileId}/download`, headers: authHeader(ctx.adminToken) });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/vnd.djvu');
    expect(download.rawPayload).toEqual(djvuBundleFixture());
    const pages = await ctx.app.inject({ method: 'GET', url: `/api/v1/djvu/files/${fileId}/pages`, headers: authHeader(ctx.adminToken) });
    expect(pages.json()).toEqual({ pageCount: 2 });
  });

  it('renders real bundled pages and returns embedded OCR', async () => {
    const count = await get('');
    expect(count.statusCode).toBe(200);
    expect(count.json()).toEqual({ pageCount: 2 });
    for (const index of [0, 1]) {
      const page = await get(`/${index}?size=1280`);
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toBe('image/webp');
      expect(page.headers['cache-control']).toBe('private, no-cache');
      const metadata = await sharp(page.rawPayload).metadata();
      expect(metadata.format).toBe('webp');
      expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1280);
    }
    const text = await get('/0/text');
    expect(text.statusCode).toBe(200);
    expect(text.json()).toEqual({ text: 'Embedded sample text' });
    expect((await get('/1/text')).json()).toEqual({ text: '' });
  });

  it('enforces authentication and library access even after cache warming', async () => {
    const warm = await get('/0?size=1280');
    const etag = String(warm.headers.etag);
    expect((await get('/0?size=1280', reader.accessToken, { 'if-none-match': etag })).statusCode).toBe(304);
    for (const suffix of ['', '/0?size=1280', '/0/text']) {
      expect((await get(suffix, outsider.accessToken, { 'if-none-match': etag })).statusCode).toBe(403);
    }
    const noAuth = await ctx.app.inject({ method: 'GET', url: `/api/v1/djvu/files/${book.bookFileId}/pages/0` });
    expect(noAuth.statusCode).toBe(401);
  });

  it('validates pages and render sizes at the HTTP boundary', async () => {
    expect((await get('/2')).statusCode).toBe(404);
    expect((await get('/-1')).statusCode).toBe(404);
    expect((await get('/0?size=99999')).statusCode).toBe(400);
    expect((await get('/0?size=not-a-number')).statusCode).toBe(400);
    expect((await get('/0?unknown=1')).statusCode).toBe(400);
  });

  it('saves paged progress and image-reader preferences separately for each account', async () => {
    const saved = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${book.bookFileId}/progress`,
      headers: authHeader(reader.accessToken),
      payload: { pageNumber: 2, percentage: 60 },
    });
    expect(saved.statusCode).toBe(201);
    const progress = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/files/${book.bookFileId}/progress`,
      headers: authHeader(reader.accessToken),
    });
    expect(progress.json()).toMatchObject({ pageNumber: 2, percentage: 60 });
    const second = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/files/${book.bookFileId}/progress`,
      headers: authHeader(secondReader.accessToken),
    });
    expect(second.json()?.pageNumber ?? null).toBeNull();
    const settings = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/reader/preferences/${book.bookFileId}`,
      headers: authHeader(reader.accessToken),
      payload: { set: { fitMode: 'fit-width' } },
    });
    expect(settings.statusCode).toBe(204);
    const preference = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/reader/preferences/${book.bookFileId}`,
      headers: authHeader(reader.accessToken),
    });
    expect(preference.json()).toMatchObject({ settings: { fitMode: 'fit-width' }, isCustomized: true });
    const other = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/reader/preferences/${book.bookFileId}`,
      headers: authHeader(secondReader.accessToken),
    });
    expect(other.json()).toEqual({ settings: null, isCustomized: false });
  });
});
