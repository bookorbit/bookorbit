import { randomBytes } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipArchive } from 'archiver';
import * as unzipper from 'unzipper';

import { openEpubZipEntryRange } from './epub-zip-entry-stream';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('openEpubZipEntryRange', () => {
  let root!: string;
  let archivePath!: string;
  let files!: unzipper.File[];
  // Large enough to inflate in many chunks, and compressible so the deflated entry is really deflated.
  const audio = Buffer.concat(Array.from({ length: 64 }, (_, index) => Buffer.concat([randomBytes(512), Buffer.alloc(4096, index)])));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-zip-range-'));
    archivePath = join(root, 'book.epub');
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const complete = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    archive.append('application/epub+zip', { name: 'mimetype', store: true });
    archive.append(audio, { name: 'OEBPS/Audio/stored.mp3', store: true });
    archive.append(audio, { name: 'OEBPS/Audio/deflated.mp3' });
    await archive.finalize();
    await complete;
    await writeFile(archivePath, Buffer.concat(chunks));
    files = (await unzipper.Open.file(archivePath)).files;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const entry = (name: string) => files.find((file) => file.path === `OEBPS/Audio/${name}`)!;

  it('lays out the fixture as one stored and one deflated entry', () => {
    expect(entry('stored.mp3').compressionMethod).toBe(0);
    expect(entry('deflated.mp3').compressionMethod).toBe(8);
    expect(entry('deflated.mp3').compressedSize).toBeLessThan(audio.length);
  });

  it.each(['stored.mp3', 'deflated.mp3'])('reads the whole of %s', async (name) => {
    const body = await readAll(await openEpubZipEntryRange(archivePath, entry(name), 0, audio.length - 1));

    expect(body.equals(audio)).toBe(true);
  });

  it.each([
    ['the first bytes', 0, 99],
    ['a span inside one chunk', 70_000, 70_010],
    ['a span across many chunks', 1_000, 200_000],
    ['the last byte', audio.length - 1, audio.length - 1],
    ['the tail', audio.length - 5_000, audio.length - 1],
  ])('reads %s of a stored and a deflated entry alike', async (_case, start, end) => {
    const stored = await readAll(await openEpubZipEntryRange(archivePath, entry('stored.mp3'), start, end));
    const deflated = await readAll(await openEpubZipEntryRange(archivePath, entry('deflated.mp3'), start, end));

    const expected = audio.subarray(start, end + 1);
    expect(stored.equals(expected)).toBe(true);
    expect(deflated.equals(expected)).toBe(true);
  });

  it('rejects a range outside the entry', async () => {
    await expect(openEpubZipEntryRange(archivePath, entry('stored.mp3'), 0, audio.length)).rejects.toThrow(RangeError);
    await expect(openEpubZipEntryRange(archivePath, entry('stored.mp3'), 10, 9)).rejects.toThrow(RangeError);
  });

  it('refuses an encrypted entry instead of serving its ciphertext', async () => {
    const encrypted = { ...entry('stored.mp3'), flags: entry('stored.mp3').flags | 0x01 } as unzipper.File;

    await expect(openEpubZipEntryRange(archivePath, encrypted, 0, 9)).rejects.toThrow('Encrypted zip entry');
  });

  it('stops inflating once a stream is destroyed', async () => {
    const stream = await openEpubZipEntryRange(archivePath, entry('deflated.mp3'), 0, audio.length - 1);
    const closed = new Promise<void>((resolve) => stream.once('close', () => resolve()));

    for await (const chunk of stream) {
      expect((chunk as Buffer).length).toBeGreaterThan(0);
      break;
    }

    await closed;
    expect(stream.destroyed).toBe(true);
  });
});
