import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as unzipper from 'unzipper';
import { ZipArchive } from 'archiver';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EpubDomService, loadChapterFromZip, readEpubSpine } from './epub-dom.service';

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
<body><p>First chapter text.</p></body></html>`;

const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>2</title></head>
<body><p>Second chapter text.</p></body></html>`;

async function buildEpub(path: string): Promise<void> {
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

describe('EpubDomService', () => {
  let dir: string;
  let epubPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-epub-'));
    epubPath = join(dir, 'test.epub');
    await buildEpub(epubPath);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeDb(absolutePath: string, format = 'epub') {
    const limit = vi.fn().mockResolvedValue([{ absolutePath, format }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    return { select };
  }

  it('reads the spine in order from a real zip', async () => {
    const zip = await unzipper.Open.file(epubPath);
    const spine = await readEpubSpine(zip);
    expect(spine.hrefs).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml']);
  });

  it('loads chapter documents with a usable text index', async () => {
    const zip = await unzipper.Open.file(epubPath);
    const doc = await loadChapterFromZip(zip, 'OEBPS/text/ch2.xhtml');
    expect(doc).not.toBeNull();
    expect(doc!.index.collapsed).toBe('Second chapter text.');
  });

  it('resolves chapters by spine index through the service and caches them', async () => {
    const db = makeDb(epubPath);
    const service = new EpubDomService(db as never);

    expect(await service.getChapterCount(1)).toBe(2);
    const first = await service.getChapter(1, 0);
    expect(first!.index.collapsed).toBe('First chapter text.');
    const again = await service.getChapter(1, 0);
    expect(again).toBe(first);
    expect(await service.getChapter(1, 9)).toBeNull();
  });

  it('returns null for non-epub files', async () => {
    const db = makeDb(epubPath, 'pdf');
    const service = new EpubDomService(db as never);
    expect(await service.getChapter(1, 0)).toBeNull();
  });
});
