import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { createZipArchiveFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
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

const KOREADER_USERNAME = `readaloud-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'ReadaloudProgressPass123';
const DEVICE_ID = 'readaloud-kindle';
const CHAPTER_COUNT = 10;
/** Chapter 7 of the original, where the device reports it has read to. */
const KOREADER_XPOINTER = '/body/DocFragment[7]/body/p[1]/text().0';
const ORIGINAL_CHAPTER_7_CFI = 'epubcfi(/6/14!/4/2/1:0)';
/** Chapter 7 of the read-along copy, inside the sentence span Storyteller wraps the text in. */
const READ_ALONG_CHAPTER_7_CFI = 'epubcfi(/6/14!/4/2/2/1:0)';
const READ_ALONG_CHAPTER_7_SENTENCE = 'OPS/chapter-7.xhtml#c7-s1';

type FileProgress = { percentage: number; cfi: string | null; koreaderProgress: string | null; mediaOverlayFragment: string | null };

/**
 * Issue 1508: a Storyteller read-along EPUB beside the original, with no audiobook imported.
 * KOReader holds the original, the web reader opens the read-along copy because it becomes the
 * primary file, and progress is stored per file, so each side has to reach the other's copy.
 */
describe('KOReader progress with a Storyteller read-along sibling (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  function epubEntries(title: string, uid: string, readAlong: boolean) {
    const chapterIds = Array.from({ length: CHAPTER_COUNT }, (_, index) => index + 1);
    const manifest = chapterIds
      .map((n) => {
        const chapter = `    <item id="chapter-${n}" href="chapter-${n}.xhtml" media-type="application/xhtml+xml"${readAlong ? ` media-overlay="smil-${n}"` : ''} />`;
        if (!readAlong) return chapter;
        return [
          chapter,
          `    <item id="smil-${n}" href="chapter-${n}.smil" media-type="application/smil+xml" />`,
          `    <item id="audio-${n}" href="audio/chapter-${n}.mp3" media-type="audio/mpeg" />`,
        ].join('\n');
      })
      .join('\n');
    const spine = chapterIds.map((n) => `    <itemref idref="chapter-${n}" />`).join('\n');

    const entries: Array<{ path: string; content: string | Buffer; store?: boolean }> = [
      { path: 'mimetype', content: 'application/epub+zip', store: true },
      {
        path: 'META-INF/container.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`,
      },
      {
        path: 'OPS/content.opf',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`,
      },
    ];
    for (const n of chapterIds) {
      const sentence = `Chapter ${n} of ${title} has one sentence of prose in it.`;
      const body = readAlong ? `<p><span id="c${n}-s1">${sentence}</span></p>` : `<p>${sentence}</p>`;
      entries.push({
        path: `OPS/chapter-${n}.xhtml`,
        content: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head><body>${body}</body></html>`,
      });
      if (!readAlong) continue;
      entries.push({
        path: `OPS/chapter-${n}.smil`,
        content: `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body><seq id="seq-${n}" epub:textref="chapter-${n}.xhtml">
    <par id="par-${n}"><text src="chapter-${n}.xhtml#c${n}-s1" /><audio src="audio/chapter-${n}.mp3" clipBegin="0s" clipEnd="60s" /></par>
  </seq></body>
</smil>`,
      });
      entries.push({ path: `OPS/audio/chapter-${n}.mp3`, content: Buffer.alloc(2048, n) });
    }
    return entries;
  }

  /** Lays out Author/Series/Title/Title.epub, and the Storyteller copy beside it when asked. */
  async function writeBook(folder: string, options: { readAlong: boolean }) {
    const title = `Read Along ${randomUUID().slice(0, 8)}`;
    const uid = `urn:uuid:${randomUUID()}`;
    const originalPath = await createZipArchiveFixture(library.folderPath, `${folder}/Title.epub`, epubEntries(title, uid, false));
    const readAlongPath = options.readAlong
      ? await createZipArchiveFixture(library.folderPath, `${folder}/Title (readaloud).epub`, epubEntries(title, uid, true))
      : null;
    return { title, uid, originalPath, readAlongPath };
  }

  /** Scans a book whose original and read-along copy share a folder, and checks they became one book. */
  async function scanReadAlongBook(folder: string) {
    const { originalPath, readAlongPath } = await writeBook(folder, { readAlong: true });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const original = await locateBookByAbsolutePath(ctx, originalPath);
    const readAlong = await locateBookByAbsolutePath(ctx, readAlongPath!);
    expect(readAlong.bookId).toBe(original.bookId);
    expect(await webReaderFileId(original.bookId)).toBe(readAlong.bookFileId);
    return { original, readAlong, readAlongPath: readAlongPath!, originalHash: await fileHashFor(original.bookFileId) };
  }

  async function fileHashFor(bookFileId: number): Promise<string> {
    const [row] = await ctx.db.select({ fileHash: schema.bookFiles.fileHash }).from(schema.bookFiles).where(eq(schema.bookFiles.id, bookFileId));
    expect(row?.fileHash).toBeTruthy();
    return row!.fileHash!;
  }

  /** The file the web client opens: `role === 'primary'`, as the library card and detail page pick it. */
  async function webReaderFileId(bookId: number): Promise<number> {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}`, headers: authHeader(ctx.adminToken) });
    expect(response.statusCode).toBe(200);
    const detail = response.json() as { files: Array<{ id: number; role: string; format: string | null }> };
    const readable = detail.files.filter((file) => file.format === 'epub');
    return (readable.find((file) => file.role === 'primary') ?? readable[0]!).id;
  }

  async function saveFromWebReader(bookFileId: number, percentage: number, cfi: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
      payload: { percentage, cfi, source: 'text' },
    });
    expect([200, 201, 204]).toContain(response.statusCode);
  }

  /** What the web reader loads when it opens this file. */
  async function fileProgress(bookFileId: number): Promise<FileProgress> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/files/${bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as FileProgress;
  }

  /** What the book page's KOReader panel shows. */
  async function bookPanel(bookId: number) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/books/${bookId}/progress`, headers: authHeader(ctx.adminToken) });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      bookFileId: number;
      canonicalPercentage: number;
      devices: Array<{ deviceId: string; percentage: number }>;
      heldByReset: Array<{ deviceId: string; percentage: number }>;
    };
  }

  async function resetFileProgress(bookFileId: number) {
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/files/${bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
    });
    expect([200, 204]).toContain(response.statusCode);
  }

  async function pushFromKoreader(hash: string, percentage: number) {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: deviceHeaders(),
      payload: { document: hash, percentage, progress: KOREADER_XPOINTER, device: 'Kindle', device_id: DEVICE_ID },
    });
    expect(response.statusCode).toBe(200);
  }

  async function pullFromKoreader(hash: string): Promise<{ percentage?: number; progress?: string; device?: string }> {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${hash}`, headers: deviceHeaders() });
    expect(response.statusCode).toBe(200);
    return response.json() as { percentage?: number; progress?: string; device?: string };
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { mode: 'book_per_folder', name: `koreader-read-along-${randomUUID()}` });
    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(ctx.adminToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('control: without a read-along copy the web reader resumes from the KOReader push', async () => {
    const { originalPath } = await writeBook('Author A/Series A/Control', { readAlong: false });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const original = await locateBookByAbsolutePath(ctx, originalPath);

    const opened = await webReaderFileId(original.bookId);
    expect(opened).toBe(original.bookFileId);

    await saveFromWebReader(opened, 67, ORIGINAL_CHAPTER_7_CFI);
    await pushFromKoreader(await fileHashFor(original.bookFileId), 0.69);

    expect((await fileProgress(opened)).percentage).toBeCloseTo(69, 1);
  });

  it('KOReader -> web: the web reader resumes from a push on the original once a read-along copy is added', async () => {
    const folder = 'Author B/Series B/Added Later';
    const { title, uid, originalPath } = await writeBook(folder, { readAlong: false });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const original = await locateBookByAbsolutePath(ctx, originalPath);
    const originalHash = await fileHashFor(original.bookFileId);
    expect(await webReaderFileId(original.bookId)).toBe(original.bookFileId);

    // Storyteller finishes and drops "Title (readaloud).epub" beside the original.
    const readAlongPath = await createZipArchiveFixture(library.folderPath, `${folder}/Title (readaloud).epub`, epubEntries(title, uid, true));
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const readAlong = await locateBookByAbsolutePath(ctx, readAlongPath);
    expect(readAlong.bookId).toBe(original.bookId);
    const opened = await webReaderFileId(original.bookId);
    expect(opened).toBe(readAlong.bookFileId);

    await saveFromWebReader(opened, 67, READ_ALONG_CHAPTER_7_CFI);
    await pushFromKoreader(originalHash, 0.69);

    const resumed = await fileProgress(opened);
    expect(resumed.percentage).toBeCloseTo(69, 1);
    expect(resumed.cfi).toMatch(/^epubcfi\(\/6\/14!/);
    // The web reader opens a read-along file at its narration marker when one is stored, so the
    // marker has to have moved with the text or the reader would land on a stale sentence.
    expect(resumed.mediaOverlayFragment).toBe(READ_ALONG_CHAPTER_7_SENTENCE);
  });

  it('web -> KOReader: a device holding the original is served the position read on the read-along copy', async () => {
    const { original, readAlong, originalHash } = await scanReadAlongBook('Author C/Series C/Reverse');

    await saveFromWebReader(readAlong.bookFileId, 67, READ_ALONG_CHAPTER_7_CFI);

    const pulled = await pullFromKoreader(originalHash);
    expect(pulled.percentage).toBeCloseTo(0.67, 3);
    expect(pulled.progress).toMatch(/^\/body\/DocFragment\[7\]\//);

    // The original has no narration of its own, so it must not carry the read-along copy's
    // sentence id, which the web reader would otherwise try to open it at.
    expect((await fileProgress(original.bookFileId)).mediaOverlayFragment).toBeNull();
  });

  it('round trip: the web reader re-saving the synced position does not drag the device backwards', async () => {
    const { readAlong, originalHash } = await scanReadAlongBook('Author D/Series D/Round Trip');

    await pushFromKoreader(originalHash, 0.69);
    const synced = await fileProgress(readAlong.bookFileId);
    expect(synced.percentage).toBeCloseTo(69, 1);

    // Opening the book saves the position it opened at.
    await saveFromWebReader(readAlong.bookFileId, 69.2, synced.cfi!);

    const pulled = await pullFromKoreader(originalHash);
    expect(pulled.percentage).toBeGreaterThanOrEqual(0.69);
    expect(pulled.progress).toMatch(/^\/body\/DocFragment\[7\]\//);
  });

  it('the book page reports the device that syncs the original, not the read-along primary', async () => {
    const { original, originalHash } = await scanReadAlongBook('Author G/Series G/Panel');

    await pushFromKoreader(originalHash, 0.69);

    const panel = await bookPanel(original.bookId);
    expect(panel.bookFileId).toBe(original.bookFileId);
    expect(panel.canonicalPercentage).toBeCloseTo(69, 1);
    expect(panel.devices).toEqual([expect.objectContaining({ deviceId: DEVICE_ID, percentage: 69 })]);
  });

  it('a device on the original held behind a reset is shown and can be released from the book page', async () => {
    const { original, originalHash } = await scanReadAlongBook('Author H/Series H/Release');

    await pushFromKoreader(originalHash, 0.42);
    await resetFileProgress(original.bookFileId);
    // The device never saw the reset and replays its old position.
    await pushFromKoreader(originalHash, 0.42);

    expect((await bookPanel(original.bookId)).heldByReset).toEqual([expect.objectContaining({ deviceId: DEVICE_ID, percentage: 42 })]);

    const released = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/koreader/books/${original.bookId}/reset-hold/release`,
      headers: authHeader(ctx.adminToken),
      payload: { deviceId: DEVICE_ID },
    });
    expect([200, 201]).toContain(released.statusCode);

    expect((await bookPanel(original.bookId)).heldByReset).toEqual([]);
    expect((await pullFromKoreader(originalHash)).percentage).toBeCloseTo(0.42, 3);
  });

  it('keeps each copy on its own position when read-aloud sync is disabled', async () => {
    const { original, readAlong, originalHash } = await scanReadAlongBook('Author E/Series E/Disabled');
    const disabled = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${original.bookId}/read-aloud-sync`,
      headers: authHeader(ctx.adminToken),
      payload: { mode: 'disabled' },
    });
    expect(disabled.statusCode).toBe(200);

    await saveFromWebReader(readAlong.bookFileId, 67, READ_ALONG_CHAPTER_7_CFI);
    await pushFromKoreader(originalHash, 0.69);

    expect((await fileProgress(readAlong.bookFileId)).percentage).toBeCloseTo(67, 1);
    expect((await fileProgress(original.bookFileId)).percentage).toBeCloseTo(69, 1);
  });

  it('workaround from the report: deleting the read-along copy resumes from the original', async () => {
    const { original, readAlongPath, originalHash } = await scanReadAlongBook('Author F/Series F/Workaround');

    await saveFromWebReader(await webReaderFileId(original.bookId), 67, READ_ALONG_CHAPTER_7_CFI);
    await pushFromKoreader(originalHash, 0.69);

    await rm(readAlongPath);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    const opened = await webReaderFileId(original.bookId);
    expect(opened).toBe(original.bookFileId);
    expect((await fileProgress(opened)).percentage).toBeCloseTo(69, 1);
  });
});
