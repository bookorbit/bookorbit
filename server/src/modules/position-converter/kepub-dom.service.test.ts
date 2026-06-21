import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipArchive } from 'archiver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KepubDomService } from './kepub-dom.service';

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:identifier id="uid">x</dc:identifier></metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;

const CH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head>
<body><div id="book-columns"><div id="book-inner"><p><span class="koboSpan" id="kobo.1.1">First chapter text.</span></p></div></div></body></html>`;

const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>2</title></head>
<body><div id="book-columns"><div id="book-inner"><p><span class="koboSpan" id="kobo.1.1">Second chapter text.</span></p></div></div></body></html>`;

async function buildKepub(path: string): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append(CONTAINER_XML, { name: 'META-INF/container.xml' });
  archive.append(CONTENT_OPF, { name: 'OEBPS/content.opf' });
  archive.append(CH1, { name: 'OEBPS/text/ch1.xhtml' });
  archive.append(CH2, { name: 'OEBPS/text/ch2.xhtml' });
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

describe('KepubDomService', () => {
  let dir: string;
  let kepubPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-kepub-'));
    kepubPath = join(dir, 'test.kepub.epub');
    await buildKepub(kepubPath);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the kepub spine by path', async () => {
    const service = new KepubDomService();
    const spine = await service.getSpine(kepubPath);
    expect(spine?.hrefs).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml']);
  });

  it('loads chapters by index and caches the parsed document', async () => {
    const service = new KepubDomService();
    const doc = await service.getChapterByIndex(kepubPath, 1);
    expect(doc?.index.collapsed).toBe('Second chapter text.');
    expect(await service.getChapterByIndex(kepubPath, 1)).toBe(doc);
    expect(await service.getChapterByIndex(kepubPath, 5)).toBeNull();
  });

  it('resolves chapter filenames through the matching ladder', async () => {
    const service = new KepubDomService();
    expect(await service.findChapterIndexByFilename(kepubPath, 'OEBPS/text/ch2.xhtml')).toBe(1);
    expect(await service.findChapterIndexByFilename(kepubPath, 'oebps/TEXT/CH2.xhtml')).toBe(1);
    expect(await service.findChapterIndexByFilename(kepubPath, 'ch2.xhtml')).toBe(1);
    expect(await service.findChapterIndexByFilename(kepubPath, 'text/ch1.xhtml#fragment')).toBe(0);
    expect(await service.findChapterIndexByFilename(kepubPath, 'missing.xhtml')).toBeNull();
  });

  it('returns null for missing files', async () => {
    const service = new KepubDomService();
    expect(await service.getSpine(join(dir, 'nope.kepub.epub'))).toBeNull();
  });
});
