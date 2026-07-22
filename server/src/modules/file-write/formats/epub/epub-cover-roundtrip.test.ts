import { ZipArchive } from 'archiver';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import * as unzipper from 'unzipper';

import { EpubFormatWriter } from './epub-format-writer';

const objectParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });
const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`;

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-epub-cover-'));
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function writeArchive(filePath: string, opfXml: string, entries: Array<{ path: string; content: string | Buffer }>): Promise<void> {
  const output = createWriteStream(filePath);
  const archive = new ZipArchive({ zlib: { level: 6 } });

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
    archive.append(Buffer.from(containerXml), { name: 'META-INF/container.xml' });
    archive.append(Buffer.from(opfXml), { name: 'OPS/content.opf' });
    for (const entry of entries) archive.append(entry.content, { name: entry.path });
    void archive.finalize();
  });
}

async function readArchiveEntry(filePath: string, entryPath: string): Promise<Buffer> {
  const zip = await unzipper.Open.file(filePath);
  const entry = zip.files.find((candidate) => candidate.path === entryPath);
  if (!entry) throw new Error(`Missing test EPUB entry: ${entryPath}`);
  return entry.buffer();
}

async function makeCover(format: 'jpeg' | 'png' | 'webp', color: { r: number; g: number; b: number }): Promise<Buffer> {
  const image = sharp({ create: { width: 10, height: 14, channels: 3, background: color } });
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'png') return image.png().toBuffer();
  return image.webp().toBuffer();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

describe('EPUB cover write round trip', () => {
  it('preserves WebP bytes and updates an existing JPEG manifest entry', async () => {
    const filePath = join(testRoot, 'existing-jpeg.epub');
    const opf = `
      <package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="uid">urn:test:jpeg</dc:identifier>
          <dc:title>Old title</dc:title>
          <dc:language>en</dc:language>
          <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
        </metadata>
        <manifest>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image" />
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
        </manifest>
        <spine><itemref idref="chapter" /></spine>
      </package>`;
    const oldCover = await makeCover('jpeg', { r: 200, g: 20, b: 20 });
    const newCover = await makeCover('webp', { r: 20, g: 40, b: 200 });
    await writeArchive(filePath, opf, [
      { path: 'OPS/images/cover.jpg', content: oldCover },
      { path: 'OPS/chapter.xhtml', content: '<html><body>chapter remains</body></html>' },
    ]);

    const result = await new EpubFormatWriter().write(
      filePath,
      { title: 'New title', coverBytes: newCover },
      { fieldMask: new Set(['title', 'coverBytes']), dryRun: false },
    );

    expect(result).toMatchObject({ status: 'success', fieldsWritten: expect.arrayContaining(['title', 'coverBytes']) });
    await expect(readArchiveEntry(filePath, 'OPS/images/cover.webp')).resolves.toEqual(newCover);
    await expect(readArchiveEntry(filePath, 'OPS/chapter.xhtml')).resolves.toEqual(Buffer.from('<html><body>chapter remains</body></html>'));
    const pkg = objectParser.parse((await readArchiveEntry(filePath, 'OPS/content.opf')).toString()).package;
    const coverItems = asArray<Record<string, string>>(pkg.manifest.item).filter((item) => item['@_properties']?.includes('cover-image'));
    expect(coverItems).toEqual([
      expect.objectContaining({
        '@_id': 'cover',
        '@_href': 'images/cover.webp',
        '@_media-type': 'image/webp',
      }),
    ]);
  });

  it('updates the image behind an EPUB2 XHTML cover page without disturbing its references', async () => {
    const filePath = join(testRoot, 'epub2-cover-page.epub');
    const opf = `
      <package version="2.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="uid">urn:test:xhtml</dc:identifier>
          <dc:title>Old title</dc:title>
          <dc:language>en</dc:language>
          <meta name="cover" content="cover-page" />
        </metadata>
        <manifest>
          <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml" />
          <item id="cover-art" href="images/art.png" media-type="image/png" />
          <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml" />
        </manifest>
        <spine><itemref idref="cover-page" /><itemref idref="chapter" /></spine>
        <guide><reference type="cover" href="text/cover.xhtml" /></guide>
      </package>`;
    const coverPage = '<html><body><img src="../images/art.png" alt="" /></body></html>';
    await writeArchive(filePath, opf, [
      { path: 'OPS/text/cover.xhtml', content: coverPage },
      { path: 'OPS/images/art.png', content: await makeCover('png', { r: 200, g: 20, b: 20 }) },
      { path: 'OPS/text/chapter.xhtml', content: '<html><body>chapter</body></html>' },
    ]);

    const newCover = await makeCover('jpeg', { r: 20, g: 200, b: 40 });
    await new EpubFormatWriter().write(
      filePath,
      { title: 'New title', coverBytes: newCover },
      { fieldMask: new Set(['title', 'coverBytes']), dryRun: false },
    );

    await expect(readArchiveEntry(filePath, 'OPS/images/art.jpg')).resolves.toEqual(newCover);
    await expect(readArchiveEntry(filePath, 'OPS/text/cover.xhtml')).resolves.toEqual(
      Buffer.from('<html><body><img src="../images/art.jpg" alt="" /></body></html>'),
    );
    const pkg = objectParser.parse((await readArchiveEntry(filePath, 'OPS/content.opf')).toString()).package;
    expect(asArray<Record<string, string>>(pkg.manifest.item).find((item) => item['@_id'] === 'cover-art')).toMatchObject({
      '@_href': 'images/art.jpg',
      '@_media-type': 'image/jpeg',
    });
    expect(asArray<Record<string, string>>(pkg.metadata.meta).filter((meta) => meta['@_name'] === 'cover')).toEqual([
      expect.objectContaining({ '@_content': 'cover-page' }),
    ]);
    expect(asArray<Record<string, string>>(pkg.guide.reference)).toEqual([
      expect.objectContaining({ '@_type': 'cover', '@_href': 'text/cover.xhtml' }),
    ]);
  });

  it('injects a WebP declaration and preserves its bytes in a coverless EPUB2 package', async () => {
    const filePath = join(testRoot, 'epub2-coverless.epub');
    const opf = `
      <package version="2.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="uid">urn:test:injected</dc:identifier>
          <dc:title>Old title</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest>
        <spine><itemref idref="chapter" /></spine>
      </package>`;
    await writeArchive(filePath, opf, [{ path: 'OPS/chapter.xhtml', content: '<html><body>chapter</body></html>' }]);

    const newCover = await makeCover('webp', { r: 90, g: 40, b: 180 });
    await new EpubFormatWriter().write(
      filePath,
      { title: 'New title', coverBytes: newCover },
      { fieldMask: new Set(['title', 'coverBytes']), dryRun: false },
    );

    const opfAfter = (await readArchiveEntry(filePath, 'OPS/content.opf')).toString();
    const pkg = objectParser.parse(opfAfter).package;
    const items = asArray<Record<string, string>>(pkg.manifest.item);
    const coverItem = items.find((item) => item['@_id'] === 'bookorbit-cover-image');
    expect(coverItem).toMatchObject({
      '@_href': 'images/bookorbit-cover.webp',
      '@_media-type': 'image/webp',
    });
    expect(coverItem).not.toHaveProperty('@_properties');
    expect(asArray<Record<string, string>>(pkg.metadata.meta).filter((meta) => meta['@_name'] === 'cover')).toEqual([
      expect.objectContaining({ '@_content': 'bookorbit-cover-image' }),
    ]);
    await expect(readArchiveEntry(filePath, 'OPS/images/bookorbit-cover.webp')).resolves.toEqual(newCover);
  });

  it('preserves selected bytes for a same-format cover replacement', async () => {
    const filePath = join(testRoot, 'same-format.epub');
    const opf = `
      <package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="uid">urn:test:same-format</dc:identifier>
          <dc:title>Old title</dc:title>
          <dc:language>en</dc:language>
          <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
        </metadata>
        <manifest>
          <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" />
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
        </manifest>
        <spine><itemref idref="chapter" /></spine>
      </package>`;
    const newCover = await makeCover('png', { r: 11, g: 71, b: 131 });
    await writeArchive(filePath, opf, [
      { path: 'OPS/images/cover.png', content: await makeCover('png', { r: 190, g: 10, b: 10 }) },
      { path: 'OPS/chapter.xhtml', content: '<html><body>chapter</body></html>' },
    ]);

    await new EpubFormatWriter().write(filePath, { coverBytes: newCover }, { fieldMask: new Set(['coverBytes']), dryRun: false });

    await expect(readArchiveEntry(filePath, 'OPS/images/cover.png')).resolves.toEqual(newCover);
    const pkg = objectParser.parse((await readArchiveEntry(filePath, 'OPS/content.opf')).toString()).package;
    expect(asArray<Record<string, string>>(pkg.manifest.item).find((item) => item['@_id'] === 'cover')).toMatchObject({
      '@_href': 'images/cover.png',
      '@_media-type': 'image/png',
    });
  });
});
