import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { ZipArchive } from 'archiver';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { KepubifyBinaryService } from '../kobo/services/kepubify-binary.service';
import { EpubDomService } from './epub-dom.service';
import { KepubDomService } from './kepub-dom.service';
import { KepubContext, KoboSpanConverterService, parseKoboSpanPos, serializeKoboSpanPos } from './kobo-span-converter.service';
import { buildKoboSpanIndex, spanSelectorFromId } from './kobo-span.core';

const execFileAsync = promisify(execFile);

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Spans</dc:title><dc:identifier id="uid">spike</dc:identifier><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="pic" href="img/pic.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;

// Exercises the structures kepubify treats specially: nested inline formatting that
// crosses sentence boundaries, lists, blockquotes, images, entities, curly quotes,
// non-breaking spaces and astral characters.
const CH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>One</title></head>
<body>
  <h1>The First Chapter</h1>
  <p>It was a bright cold day in April. The clocks were striking thirteen!</p>
  <p>Winston Smith, his chin nuzzled into his breast, slipped <em>quickly through. The glass</em> doors of Victory Mansions.</p>
  <p>He said “stay awhile” and then left&#160;again. Asked: why?</p>
  <blockquote><p>Quoted wisdom lives here. It spans two sentences.</p></blockquote>
  <ul><li>First item sentence.</li><li>Second item with <strong>bold capture</strong> inside.</li></ul>
</body>
</html>`;

const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Two</title></head>
<body>
  <p>Emoji ahead \u{1F600} and after. Trailing sentence to anchor!</p>
  <img src="../img/pic.png" alt="pic"/>
  <p>Past the image now. Another line of text follows here.</p>
</body>
</html>`;

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
  archive.append(PNG_1X1, { name: 'OEBPS/img/pic.png' });
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

function makeDb(absolutePath: string) {
  const limit = vi.fn().mockResolvedValue([{ absolutePath, format: 'epub' }]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

// Runs the actual bundled kepubify binary: this is the gate for the codec's core
// assumption that kepub chapter text is collapse-identical to the epub chapter's.
describe('KoboSpanConverterService (real kepubify output)', () => {
  let dir: string;
  let epubPath: string;
  let kepubPath: string;
  let epubDom: EpubDomService;
  let kepubDom: KepubDomService;
  let service: KoboSpanConverterService;
  let ctx: KepubContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-kobo-span-'));
    epubPath = join(dir, 'fixture.epub');
    kepubPath = join(dir, 'fixture.kepub.epub');
    await buildEpub(epubPath);

    const binary = new KepubifyBinaryService();
    await execFileAsync(await binary.getBinaryPath(), ['--output', kepubPath, epubPath], { timeout: 60_000 });

    epubDom = new EpubDomService(makeDb(epubPath) as never);
    kepubDom = new KepubDomService();
    service = new KoboSpanConverterService(epubDom, kepubDom);
    ctx = { kepubPath, fileHash: 'testhash', hyphenate: false, kepubifyVersion: await binary.getVersion() };
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('produces collapse-identical chapter text for every chapter (R1 gate)', async () => {
    for (let chapterIndex = 0; chapterIndex < 2; chapterIndex += 1) {
      const epubDoc = await epubDom.getChapter(1, chapterIndex);
      const kepubDoc = await kepubDom.getChapterByIndex(kepubPath, chapterIndex);
      expect(epubDoc).not.toBeNull();
      expect(kepubDoc).not.toBeNull();
      expect(kepubDoc!.index.collapsed).toBe(epubDoc!.index.collapsed);
    }
  });

  it('keeps spine hrefs unchanged', async () => {
    const spine = await kepubDom.getSpine(kepubPath);
    expect(spine?.hrefs).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml']);
  });

  it('converts a device-style span location to exact canonical positions', async () => {
    const kepubDoc = (await kepubDom.getChapterByIndex(kepubPath, 0))!;
    const spanIndex = buildKoboSpanIndex(kepubDoc);
    expect(spanIndex.ordered.length).toBeGreaterThan(5);

    // Pick the real span holding the second sentence of paragraph one.
    const target = spanIndex.ordered.find((span) => kepubDoc.index.extractCollapsed(span.collapsedStart, span.collapsedEnd).includes('clocks'));
    expect(target).toBeDefined();
    const text = 'The clocks were striking thirteen!';
    const spanText = kepubDoc.index.extractCollapsed(target!.collapsedStart, target!.collapsedEnd);
    const startChar = spanText.indexOf('The clocks');

    const result = await service.koboSpanToCanonical({
      bookFileId: 1,
      ctx,
      location: {
        span: {
          startPath: spanSelectorFromId(target!.id),
          startChar,
          endPath: spanSelectorFromId(target!.id),
          endChar: startChar + text.length,
          chapterFilename: 'OEBPS/text/ch1.xhtml',
          chapterProgress: 0,
        },
      },
      text,
    });

    expect(result.status).toBe('exact');
    expect(result.chapterIndex).toBe(0);
    expect(result.cfi).toContain('epubcfi(/6/2!');
    expect(result.xpointerPos0).toContain('/body/DocFragment[1]/');
    expect(result.renditionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips a canonical cfi to a device location and back', async () => {
    const text = 'quickly through. The glass';
    const kepubDoc = (await kepubDom.getChapterByIndex(kepubPath, 0))!;
    const spanIndex = buildKoboSpanIndex(kepubDoc);
    const emTarget = spanIndex.ordered.find((span) => kepubDoc.index.extractCollapsed(span.collapsedStart, span.collapsedEnd).includes('quickly'));
    expect(emTarget).toBeDefined();

    const forward = await service.koboSpanToCanonical({
      bookFileId: 1,
      ctx,
      location: {
        span: {
          startPath: spanSelectorFromId(emTarget!.id),
          startChar: 0,
          endPath: spanSelectorFromId(spanIndex.ordered[spanIndex.ordered.indexOf(emTarget!) + 1].id),
          endChar: spanIndex.ordered[spanIndex.ordered.indexOf(emTarget!) + 1].utf16Length,
          chapterFilename: 'text/ch1.xhtml',
          chapterProgress: 0,
        },
      },
      text: null,
    });
    expect(forward.status).not.toBe('failed');

    const back = await service.canonicalToKoboSpan({ bookFileId: 1, ctx, cfi: forward.cfi!, text, chapterTitle: 'One' });
    expect(back.status).not.toBe('failed');
    expect(back.location?.span.chapterFilename).toBe('OEBPS/text/ch1.xhtml');
    expect(back.location?.span.startPath).toBe(spanSelectorFromId(emTarget!.id));
    expect(back.pos0).toBe(serializeKoboSpanPos(emTarget!.id, 0));

    const again = await service.koboSpanToCanonical({ bookFileId: 1, ctx, location: back.location, text });
    expect(again.status).toBe('exact');
    expect(again.cfi).toBe(forward.cfi);
  });

  it('handles astral characters in device offsets (UTF-16 units)', async () => {
    const kepubDoc = (await kepubDom.getChapterByIndex(kepubPath, 1))!;
    const spanIndex = buildKoboSpanIndex(kepubDoc);
    const emojiSpan = spanIndex.ordered.find((span) => kepubDoc.index.extractCollapsed(span.collapsedStart, span.collapsedEnd).includes('\u{1F600}'));
    expect(emojiSpan).toBeDefined();

    const raw = emojiSpan!.textNodes.map((n) => n.data ?? '').join('');
    const needle = 'and after.';
    const startCharUtf16 = raw.indexOf(needle);
    expect(startCharUtf16).toBeGreaterThan(0);

    const result = await service.koboSpanToCanonical({
      bookFileId: 1,
      ctx,
      location: {
        span: {
          startPath: spanSelectorFromId(emojiSpan!.id),
          startChar: startCharUtf16,
          endPath: spanSelectorFromId(emojiSpan!.id),
          endChar: startCharUtf16 + needle.length,
          chapterFilename: 'OEBPS/text/ch2.xhtml',
          chapterProgress: 0.5,
        },
      },
      text: needle,
    });
    expect(result.status).toBe('exact');
    expect(result.chapterIndex).toBe(1);
  });

  it('round-trips reading-position bookmarks through span ids', async () => {
    const kepubDoc = (await kepubDom.getChapterByIndex(kepubPath, 1))!;
    const spanIndex = buildKoboSpanIndex(kepubDoc);
    const target = spanIndex.ordered.find((span) =>
      kepubDoc.index.extractCollapsed(span.collapsedStart, span.collapsedEnd).includes('Past the image'),
    );
    expect(target).toBeDefined();

    const positions = await service.koboBookmarkToPositions({ bookFileId: 1, ctx, chapterFilename: 'text/ch2.xhtml', spanId: target!.id });
    expect(positions.status).toBe('exact');
    expect(positions.cfi).toContain('epubcfi(/6/4!');
    expect(positions.xpointer).toContain('/body/DocFragment[2]/');

    const bookmark = await service.cfiPointToKoboBookmark({ bookFileId: 1, ctx, cfi: positions.cfi! });
    expect(bookmark.status).toBe('exact');
    expect(bookmark.spanId).toBe(target!.id);
    expect(bookmark.chapterFilename).toBe('OEBPS/text/ch2.xhtml');
    expect(bookmark.contentSourceProgressPercent).toBeGreaterThan(0);
  });

  it('computes a stable rendition hash and reacts to version changes', async () => {
    const first = await service.computeRenditionHash(ctx);
    const second = await service.computeRenditionHash(ctx);
    expect(first).toBe(second);
    const bumped = await service.computeRenditionHash({ ...ctx, kepubifyVersion: 'other' });
    expect(bumped).not.toBe(first);
    expect(await service.computeRenditionHash({ ...ctx, kepubPath: join(dir, 'missing.kepub.epub') })).toBeNull();
  });

  it('parses serialized kobo_span pos values', () => {
    expect(parseKoboSpanPos('kobo.3.2:15')).toEqual({ spanId: 'kobo.3.2', char: 15 });
    expect(parseKoboSpanPos('kobo.3.2')).toBeNull();
    expect(parseKoboSpanPos('weird:5')).toBeNull();
  });
});
