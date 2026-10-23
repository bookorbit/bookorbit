import { randomUUID } from 'crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';

import { bookFiles, books } from '../src/db/schema';
import { MetadataService } from '../src/modules/metadata/metadata.service';
import { ScannerRepository } from '../src/modules/scanner/scanner.repository';
import { ScannerService } from '../src/modules/scanner/scanner.service';
import { closeE2EContext, createE2EContext, seedLibrary, triggerAndWaitForLibraryScan, type E2EContext } from './e2e/app-harness';

const TEST_TIMEOUT_MS = 60_000;

const trackName = (number: string) => `Project Hail Mary (${number}).mp3`;

/** Distinct bytes per file, so the scanner never mistakes one track for a moved copy of another. */
const trackBytes = (number: string) => Buffer.from(`ID3 track ${number} ${randomUUID()}`);

/** Older than the scanner's stability window, so no scan stops to wait for these files to settle. */
async function writeSettledFile(path: string, content: Buffer): Promise<void> {
  await writeFile(path, content);
  const settled = new Date(Date.now() - 5 * 60_000);
  await utimes(path, settled, settled);
}

function multipart(fileName: string, content: Buffer): { body: Buffer; boundary: string } {
  const boundary = `----bookorbit-track-order-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/mpeg\r\n\r\n`,
    'utf8',
  );
  return { boundary, body: Buffer.concat([preamble, content, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]) };
}

describe('Audiobook track order (e2e)', () => {
  let ctx: E2EContext;
  const roots: string[] = [];

  beforeAll(async () => {
    ctx = await createE2EContext({ isolateAppData: true, multipart: true });
    // The shared no-op metadata stub predates these audio steps, which a scan and an added track run.
    Object.assign(ctx.app.get(MetadataService), {
      extractAndAggregateAudioDuration: vi.fn().mockResolvedValue(undefined),
      extractMergedAudioChapters: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterAll(async () => {
    await closeE2EContext(ctx);
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createBookFolder(): Promise<{ root: string; folder: string }> {
    const root = await mkdtemp(join(tmpdir(), 'bookorbit-track-order-'));
    roots.push(root);
    const folder = join(root, 'Andy Weir', 'Project Hail Mary (2021)');
    await mkdir(folder, { recursive: true });
    return { root, folder };
  }

  async function bookIdFor(folder: string): Promise<number> {
    const [book] = await ctx.db.select({ id: books.id }).from(books).where(eq(books.folderPath, folder));
    if (!book) throw new Error(`No book for ${folder}`);
    return book.id;
  }

  async function fileNames(bookId: number): Promise<Map<number, string>> {
    const rows = await ctx.db.select({ id: bookFiles.id, absolutePath: bookFiles.absolutePath }).from(bookFiles).where(eq(bookFiles.bookId, bookId));
    return new Map(rows.map((row) => [row.id, row.absolutePath.split('/').pop()!]));
  }

  /** The order the web and iOS players queue the tracks in. */
  async function playbackOrder(bookId: number): Promise<string[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/audiobooks/${bookId}/manifest`,
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const names = await fileNames(bookId);
    return (response.json() as { assets: Array<{ fileId: number }> }).assets.map((asset) => names.get(asset.fileId)!);
  }

  /** The order the book's Files tab lists the tracks in. */
  async function filesTabOrder(bookId: number): Promise<string[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${bookId}`,
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { files: Array<{ format: string | null; absolutePath: string }> }).files
      .filter((file) => file.format === 'mp3')
      .map((file) => file.absolutePath.split('/').pop()!);
  }

  it(
    'plays tracks in name order when a folder scan that listed the folder early finishes after a newer one',
    async () => {
      const { root, folder } = await createBookFolder();
      for (const number of ['03', '04', '05']) await writeSettledFile(join(folder, trackName(number)), trackBytes(number));
      const { libraryId } = await seedLibrary(ctx.db, { rootPath: root, mode: 'book_per_folder' });

      const scanner = ctx.app.get(ScannerService);
      const repo = ctx.app.get(ScannerRepository);
      const createBookFile = repo.createBookFile.bind(repo);
      let staleScanPaused!: () => void;
      const staleScanReachedItsFirstWrite = new Promise<void>((resolve) => (staleScanPaused = resolve));
      let resumeStaleScan!: () => void;
      const staleScanMayContinue = new Promise<void>((resolve) => (resumeStaleScan = resolve));
      const spy = vi.spyOn(repo, 'createBookFile').mockImplementationOnce(async (data) => {
        staleScanPaused();
        await staleScanMayContinue;
        return createBookFile(data);
      });

      try {
        // The watcher's scan for track 03 lists the folder while only tracks 03 to 05 are there.
        const staleScan = (scanner as unknown as { scanBookFolder(path: string, libraryId: number): Promise<void> }).scanBookFolder(
          join(folder, trackName('03')),
          libraryId,
        );
        await staleScanReachedItsFirstWrite;

        // The rest of the book arrives, and the scan for track 01 numbers the whole folder first.
        await writeSettledFile(join(folder, 'cover.jpg'), Buffer.from(`cover ${randomUUID()}`));
        for (const number of ['01', '02']) await writeSettledFile(join(folder, trackName(number)), trackBytes(number));
        await (scanner as unknown as { scanBookFolder(path: string, libraryId: number): Promise<void> }).scanBookFolder(
          join(folder, trackName('01')),
          libraryId,
        );

        resumeStaleScan();
        await staleScan;
      } finally {
        resumeStaleScan();
        spy.mockRestore();
      }

      const bookId = await bookIdFor(folder);
      const inNameOrder = ['01', '02', '03', '04', '05'].map(trackName);
      expect(await filesTabOrder(bookId)).toEqual(inNameOrder);
      expect(await playbackOrder(bookId)).toEqual(inNameOrder);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'plays a track added from the Files tab where its name puts it, not after every other track',
    async () => {
      const { root, folder } = await createBookFolder();
      for (const number of ['01', '02', '04']) await writeSettledFile(join(folder, trackName(number)), trackBytes(number));
      const { libraryId } = await seedLibrary(ctx.db, { rootPath: root, mode: 'book_per_folder' });
      await triggerAndWaitForLibraryScan(ctx, libraryId);
      const bookId = await bookIdFor(folder);

      const { body, boundary } = multipart(trackName('03'), trackBytes('03'));
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${bookId}/files`,
        headers: {
          authorization: `Bearer ${ctx.adminToken}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(body.length),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(201);

      const inNameOrder = ['01', '02', '03', '04'].map(trackName);
      expect(await filesTabOrder(bookId)).toEqual(inNameOrder);
      expect(await playbackOrder(bookId)).toEqual(inNameOrder);
    },
    TEST_TIMEOUT_MS,
  );
});
