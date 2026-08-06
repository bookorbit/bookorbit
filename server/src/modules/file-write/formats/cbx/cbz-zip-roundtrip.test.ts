import { ZipArchive } from 'archiver';
import { createWriteStream } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as unzipper from 'unzipper';

import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-cbz-roundtrip-'));
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

function pageBytes(index: number): Buffer {
  const bytes = Buffer.allocUnsafe(512);
  for (let offset = 0; offset < bytes.length; offset++) bytes[offset] = (index * 31 + offset) % 256;
  return bytes;
}

async function writeArchive(filePath: string, entries: Array<{ path: string; content: Buffer }>): Promise<void> {
  const output = createWriteStream(filePath);
  const archive = new ZipArchive({ zlib: { level: 6 } });

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.content, { name: entry.path });
    void archive.finalize();
  });
}

async function readArchive(filePath: string): Promise<Array<{ path: string; content: Buffer }>> {
  const zip = await unzipper.Open.file(filePath);
  return Promise.all(zip.files.map(async (entry) => ({ path: entry.path, content: await entry.buffer() })));
}

function comicPages(count: number): Array<{ path: string; content: Buffer }> {
  return Array.from({ length: count }, (_unused, index) => ({
    path: `pages/${String(index + 1).padStart(3, '0')}.jpg`,
    content: pageBytes(index),
  }));
}

describe('cbz zip round trip', () => {
  it('preserves every page byte-for-byte and appends comic info when absent', async () => {
    const target = join(testRoot, 'volume.cbz');
    const pages = comicPages(120);
    await writeArchive(target, pages);

    await writeComicInfoToZip(target, '<ComicInfo><Title>Saga</Title></ComicInfo>');

    const written = await readArchive(target);
    expect(written.map((entry) => entry.path)).toEqual([...pages.map((page) => page.path), 'ComicInfo.xml']);
    for (const [index, page] of pages.entries()) {
      expect(written[index]!.content.equals(page.content)).toBe(true);
    }
    await expect(readComicInfoFromZip(target)).resolves.toBe('<ComicInfo><Title>Saga</Title></ComicInfo>');
  });

  it('replaces existing comic info in place without duplicating it', async () => {
    const target = join(testRoot, 'volume.cbz');
    const pages = comicPages(5);
    await writeArchive(target, [{ path: 'metadata/ComicInfo.XML', content: Buffer.from('<ComicInfo><Title>Old</Title></ComicInfo>') }, ...pages]);

    await writeComicInfoToZip(target, '<ComicInfo><Title>New</Title></ComicInfo>');

    const written = await readArchive(target);
    expect(written.map((entry) => entry.path)).toEqual([...pages.map((page) => page.path), 'metadata/ComicInfo.XML']);
    await expect(readComicInfoFromZip(target)).resolves.toBe('<ComicInfo><Title>New</Title></ComicInfo>');
  });

  it('leaves no temporary archive behind', async () => {
    const target = join(testRoot, 'volume.cbz');
    await writeArchive(target, comicPages(3));

    await writeComicInfoToZip(target, '<ComicInfo/>');

    await expect(readdir(testRoot)).resolves.toEqual(['volume.cbz']);
  });
});
