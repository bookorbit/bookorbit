import { mkdtemp, mkdir, readdir, rename, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import { ZipArchive } from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveBookFileTargets } from '../../modules/file-write/book-file-targets';
import { inspectEpubMediaOverlayFields } from '../../modules/reader/epub/epub-media-overlay-capability';

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const CHAPTER_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="line">Dune</p></body></html>`;

const PLAIN_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;

const READALOUD_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/>
    <item id="overlay" href="chapter.smil" media-type="application/smil+xml"/>
    <item id="audio" href="audio.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;

const CHAPTER_SMIL = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body><seq><par><text src="chapter.xhtml#line"/><audio src="audio.mp3" clipBegin="0s" clipEnd="3s"/></par></seq></body>
</smil>`;

type ZipEntry = { name: string; content: string | Buffer; store?: boolean };

async function writeEpub(path: string, entries: ZipEntry[]): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append(CONTAINER_XML, { name: 'META-INF/container.xml' });
  for (const entry of entries) archive.append(entry.content, { name: entry.name, store: entry.store });
  await archive.finalize();
  await complete;
  await writeFile(path, Buffer.concat(chunks));
}

describe('readaloud naming integration', () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = null;
  });

  it('detects real EPUB media overlays and moves mixed formats to distinct resolved names', async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'bookorbit-readaloud-pattern-'));
    const incoming = join(fixtureRoot, 'incoming');
    const library = join(fixtureRoot, 'library');
    await Promise.all([mkdir(incoming), mkdir(library)]);

    const plainPath = join(incoming, 'plain.epub');
    const readaloudPath = join(incoming, 'combined.epub');
    const audiobookPath = join(incoming, 'audio.m4b');
    await Promise.all([
      writeEpub(plainPath, [
        { name: 'EPUB/content.opf', content: PLAIN_OPF },
        { name: 'EPUB/chapter.xhtml', content: CHAPTER_XHTML },
      ]),
      writeEpub(readaloudPath, [
        { name: 'EPUB/content.opf', content: READALOUD_OPF },
        { name: 'EPUB/chapter.xhtml', content: CHAPTER_XHTML },
        { name: 'EPUB/chapter.smil', content: CHAPTER_SMIL },
        { name: 'EPUB/audio.mp3', content: Buffer.alloc(32, 1) },
      ]),
      writeFile(audiobookPath, Buffer.from('m4b fixture')),
    ]);

    const [plainCapability, readaloudCapability, audiobookCapability] = await Promise.all([
      inspectEpubMediaOverlayFields(plainPath, 'epub'),
      inspectEpubMediaOverlayFields(readaloudPath, 'EPUB'),
      inspectEpubMediaOverlayFields(audiobookPath, 'm4b'),
    ]);

    expect(plainCapability.mediaOverlayAvailable).toBe(false);
    expect(plainCapability.mediaOverlayCheckedAt).toBeInstanceOf(Date);
    expect(readaloudCapability.mediaOverlayAvailable).toBe(true);
    expect(readaloudCapability.mediaOverlayDurationSeconds).toBe(3);
    expect(audiobookCapability.mediaOverlayAvailable).toBe(false);
    expect(audiobookCapability.mediaOverlayCheckedAt).toBeNull();

    const files = [
      {
        id: 1,
        absolutePath: plainPath,
        format: 'epub',
        role: 'content',
        sortOrder: null,
        mediaOverlayAvailable: plainCapability.mediaOverlayAvailable,
      },
      {
        id: 2,
        absolutePath: readaloudPath,
        format: 'EPUB',
        role: 'content',
        sortOrder: null,
        mediaOverlayAvailable: readaloudCapability.mediaOverlayAvailable,
      },
      {
        id: 3,
        absolutePath: audiobookPath,
        format: 'm4b',
        role: 'content',
        sortOrder: null,
        mediaOverlayAvailable: true,
      },
    ];
    const targets = resolveBookFileTargets({
      primaryFileId: 1,
      files,
      metadata: {
        title: 'Dune',
        subtitle: null,
        publisher: null,
        language: null,
        isbn13: null,
        publishedYear: null,
        seriesName: null,
        seriesIndex: null,
      },
      authors: ['Frank Herbert'],
      narrators: [],
      libraryName: 'Books',
      libraryFolderPath: library,
      bookFolderPath: incoming,
      organizationMode: 'book_per_folder',
      pattern: '{title}/{title}< ({readaloud})>',
      sanitizeForCrossPlatform: false,
    });

    for (const file of files) {
      const target = targets.get(file.id);
      expect(target).toBeDefined();
      await mkdir(dirname(target!), { recursive: true });
      await rename(file.absolutePath, target!);
    }

    const filenames = (await readdir(join(library, 'Dune'))).sort();
    expect(filenames).toEqual(['Dune (readaloud).epub', 'Dune.epub', 'Dune.m4b']);
    expect([...targets.values()].map((target) => basename(target)).sort()).toEqual(filenames);
  });
});
