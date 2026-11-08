import { mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipArchive } from 'archiver';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EpubDomService } from './epub-dom.service';
import { cfiRangeToCollapsed } from './position-converter.core';
import { TextLocatorService } from './text-locator.service';

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
    <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
</package>`;

function chapter(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
}

const CH1 = chapter(
  '<h1>Chapter One</h1><p>It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>',
);

const CH2 = chapter(
  '<h1>Chapter Two</h1>' +
    '<p>Mr. Bingley was good-looking and gentlemanlike; he had a pleasant countenance, and easy, unaffected manners.</p>' +
    '<p>His friend <em>Mr. Darcy</em> soon drew the attention of the room by his fine, tall person, handsome features, ' +
    'noble mien, and the report which was in general circula­tion within five minutes after his entrance, of his having ten thousand a year.</p>',
);

const CH3 = chapter(
  '<h1>Chapter Three</h1><p>“Within a short walk of Longbourn lived a family with whom the Bennets were particularly intimate,” said Elizabeth.</p>',
);

const PAGE_PHOTO =
  'PRIDE AND PREJUDICE\n' +
  'His friend Mr. Darcy soon drew the attention of the room by his fine, tall per-\n' +
  'son, handsome features, noble mien, and the report which was in general cir-\n' +
  'culation within five minutes after his entrance, of his having ten thousand a year.\n' +
  '14';

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
  archive.append(CH3, { name: 'OEBPS/text/ch3.xhtml' });
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

function makeDb(rows: () => Array<{ absolutePath: string; format: string }>) {
  const limit = vi.fn().mockImplementation(() => Promise.resolve(rows()));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

describe('TextLocatorService', () => {
  let dir: string;
  let epubPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-locate-'));
    epubPath = join(dir, 'book.epub');
    await buildEpub(epubPath);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeService(rows: () => Array<{ absolutePath: string; format: string }> = () => [{ absolutePath: epubPath, format: 'epub' }]) {
    const epubDom = new EpubDomService(makeDb(rows) as never);
    return { epubDom, locator: new TextLocatorService(epubDom) };
  }

  it('places a photographed page at the matching text with a CFI the reader can open', async () => {
    const { epubDom, locator } = makeService();

    const outcome = await locator.locate(1, PAGE_PHOTO);

    expect(outcome.status).toBe('matched');
    if (outcome.status !== 'matched') return;
    expect(outcome.chapterIndex).toBe(1);
    expect(outcome.cfi.startsWith('epubcfi(/6/4!')).toBe(true);
    expect(outcome.confidence).toBeGreaterThan(0.7);
    expect(outcome.excerpt.startsWith('His friend Mr. Darcy soon drew the attention')).toBe(true);

    const doc = await epubDom.getChapter(1, 1);
    const range = cfiRangeToCollapsed(doc!, outcome.cfi);
    expect(doc!.index.extractCollapsed(range!.startCp, range!.endCp)).toMatch(/^His friend Mr\. Darcy .* ten thousand a year\.$/);
  });

  it('takes in the quotation marks and punctuation around the matched words', async () => {
    const { locator } = makeService();
    const outcome = await locator.locate(
      1,
      'Within a short walk of Longbourn lived a family with whom\nthe Bennets were particularly intimate, said Elizabeth.',
    );
    expect(outcome.status).toBe('matched');
    if (outcome.status !== 'matched') return;
    expect(outcome.chapterIndex).toBe(2);
    expect(outcome.excerpt.startsWith('\u201CWithin a short walk')).toBe(true);
  });

  it('answers no match for a page from another book', async () => {
    const { locator } = makeService();
    const outcome = await locator.locate(1, 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse.');
    expect(outcome).toEqual({ status: 'no_match' });
  });

  it('answers no match without reading the book when the page has too few words', async () => {
    const { epubDom, locator } = makeService();
    const read = vi.spyOn(epubDom, 'readChapterTexts');
    expect(await locator.locate(1, 'Chapter Two')).toEqual({ status: 'no_match' });
    expect(read).not.toHaveBeenCalled();
  });

  it('reports a file that cannot be read as unavailable', async () => {
    const { locator } = makeService(() => [{ absolutePath: join(dir, 'missing.epub'), format: 'epub' }]);
    expect(await locator.locate(1, PAGE_PHOTO)).toEqual({ status: 'unavailable' });
  });

  it('reports a file that is not an EPUB as unavailable', async () => {
    const { locator } = makeService(() => [{ absolutePath: epubPath, format: 'pdf' }]);
    expect(await locator.locate(1, PAGE_PHOTO)).toEqual({ status: 'unavailable' });
  });

  it('reads the book once for repeated scans and again after the file changes', async () => {
    const { epubDom, locator } = makeService();
    const read = vi.spyOn(epubDom, 'readChapterTexts');

    await Promise.all([locator.locate(1, PAGE_PHOTO), locator.locate(1, PAGE_PHOTO)]);
    await locator.locate(1, PAGE_PHOTO);
    expect(read).toHaveBeenCalledTimes(1);

    const later = new Date(Date.now() + 60_000);
    await utimes(epubPath, later, later);
    expect((await locator.locate(1, PAGE_PHOTO)).status).toBe('matched');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
