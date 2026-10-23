import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipArchive } from 'archiver';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { kepubContentDigest } from './kepub-content-digest';

async function writeZip(path: string, entries: [string, string][]): Promise<string> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const [name, body] of entries) archive.append(body, { name, store: name === 'mimetype' });
  await archive.finalize();
  await complete;
  await writeFile(path, Buffer.concat(chunks));
  return path;
}

const ENTRIES: [string, string][] = [
  ['mimetype', 'application/epub+zip'],
  ['META-INF/container.xml', '<container/>'],
  ['OEBPS/content.opf', '<package/>'],
  ['OEBPS/chapter-1.xhtml', '<p><span class="koboSpan" id="kobo.1.1">One.</span></p>'],
  ['OEBPS/chapter-2.xhtml', '<p><span class="koboSpan" id="kobo.1.1">Two.</span></p>'],
];

describe('kepubContentDigest', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-kepub-digest-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is the same for one conversion written with its entries in another order', async () => {
    const first = await writeZip(join(root, 'a.kepub.epub'), ENTRIES);
    const reordered = await writeZip(join(root, 'b.kepub.epub'), [ENTRIES[0], ENTRIES[4], ENTRIES[2], ENTRIES[1], ENTRIES[3]]);

    expect(await kepubContentDigest(reordered)).toBe(await kepubContentDigest(first));
  });

  it('differs when an entry holds different text', async () => {
    const first = await writeZip(join(root, 'a.kepub.epub'), ENTRIES);
    const changed = await writeZip(join(root, 'c.kepub.epub'), [
      ...ENTRIES.slice(0, 4),
      ['OEBPS/chapter-2.xhtml', '<p><span class="koboSpan" id="kobo.1.1">Two!</span></p>'],
    ]);

    expect(await kepubContentDigest(changed)).not.toBe(await kepubContentDigest(first));
  });
});
