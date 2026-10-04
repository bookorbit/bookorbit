import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipArchive } from 'archiver';

import type { EpubBookInfo } from '@bookorbit/types';

import { inspectEpubMediaOverlayFields } from './epub-media-overlay-capability';
import { buildEpubMediaOverlayPlaylist, buildEpubMediaOverlayPlaylistFromFile, inspectEpubMediaOverlayFile } from './epub-media-overlay';

type Clip = { begin?: string; end?: string };

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/** Two chapters, each narrated from its own audio track, laid out the way Storyteller writes them. */
const MEASURABLE_CHAPTERS: [Clip[], Clip[]] = [
  [
    { begin: '0.000s', end: '3.620s' },
    { begin: '3.620s', end: '11.960s' },
  ],
  [
    { begin: '0.000s', end: '4.640s' },
    { begin: '4.640s', end: '19.150s' },
  ],
];
const MEASURABLE_TOTAL_SECONDS = 3.62 + 8.34 + 4.64 + 14.51;

/**
 * The end of the first audio track in a Storyteller 2.14.21 book from issue 1619: the last
 * sentence was placed past the track's real length, then its clip was ended at that length.
 */
const STORYTELLER_TRACK_BOUNDARY_CHAPTERS: [Clip[], Clip[]] = [
  [
    { begin: '7215.150s', end: '7223.150s' },
    { begin: '7223.150s', end: '7198.408s' },
  ],
  MEASURABLE_CHAPTERS[1],
];
const STORYTELLER_PACKAGE_DURATION = '<meta property="media:duration">05:51:43.35</meta>';
const STORYTELLER_PACKAGE_DURATION_SECONDS = 21103.35;
const STORYTELLER_OVERLAY_DURATIONS = [
  '<meta property="media:duration" refines="#chapter-1_overlay">00:00:08.00</meta>',
  '<meta property="media:duration" refines="#chapter-2_overlay">00:00:19.15</meta>',
].join('\n    ');

function audioElement(chapter: number, clip: Clip): string {
  const begin = clip.begin === undefined ? '' : ` clipBegin="${clip.begin}"`;
  const end = clip.end === undefined ? '' : ` clipEnd="${clip.end}"`;
  return `<audio src="../Audio/0000${chapter}.mp4"${begin}${end}/>`;
}

function smil(chapter: number, clips: Clip[]): string {
  const pars = clips
    .map(
      (clip, index) => `
      <par id="chapter-${chapter}-s${index}" epub:type="storyteller:matched">
        <text src="../chapter-${chapter}.xhtml#chapter-${chapter}-s${index}"/>
        ${audioElement(chapter, clip)}
      </par>`,
    )
    .join('');
  return `<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="chapter-${chapter}_overlay" epub:textref="../chapter-${chapter}.xhtml" epub:type="chapter">${pars}
    </seq>
  </body>
</smil>`;
}

function opf(durationMetas: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:issue-1619</dc:identifier>
    <dc:title>Read Along</dc:title>
    ${durationMetas}
    <meta property="media:active-class">-epub-media-overlay-active</meta>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" media-overlay="chapter-1_overlay"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml" media-overlay="chapter-2_overlay"/>
    <item id="chapter-1_overlay" href="MediaOverlays/chapter-1.smil" media-type="application/smil+xml"/>
    <item id="chapter-2_overlay" href="MediaOverlays/chapter-2.smil" media-type="application/smil+xml"/>
    <item id="audio-1" href="Audio/00001.mp4" media-type="audio/mp4"/>
    <item id="audio-2" href="Audio/00002.mp4" media-type="audio/mp4"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
  </spine>
</package>`;
}

describe('EPUB media overlay duration', () => {
  let fixtureRoot!: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'bookorbit-media-overlay-'));
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  async function writeReadAlongEpub(chapters: [Clip[], Clip[]], durationMetas: string): Promise<string> {
    const path = join(fixtureRoot, `${Math.random().toString(36).slice(2)}.epub`);
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const complete = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    archive.append('application/epub+zip', { name: 'mimetype', store: true });
    archive.append(CONTAINER_XML, { name: 'META-INF/container.xml' });
    archive.append(opf(durationMetas), { name: 'OEBPS/content.opf' });
    for (const [index, clips] of chapters.entries()) {
      const chapter = index + 1;
      archive.append(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter ${chapter}</p></body></html>`, {
        name: `OEBPS/chapter-${chapter}.xhtml`,
      });
      archive.append(smil(chapter, clips), { name: `OEBPS/MediaOverlays/chapter-${chapter}.smil` });
      archive.append(Buffer.alloc(16, chapter), { name: `OEBPS/Audio/0000${chapter}.mp4` });
    }
    await archive.finalize();
    await complete;
    await writeFile(path, Buffer.concat(chunks));
    return path;
  }

  function withLastClipOfChapterOne(clip: Clip): [Clip[], Clip[]] {
    const [first, second] = MEASURABLE_CHAPTERS;
    return [[first[0]!, clip], second];
  }

  it('sums the clips when every clip can be measured, even when the package declares another total', async () => {
    const path = await writeReadAlongEpub(MEASURABLE_CHAPTERS, '<meta property="media:duration">01:00:00.00</meta>');

    const playlist = await buildEpubMediaOverlayPlaylistFromFile(path, 1, 2);

    expect(playlist.durationSeconds).toBeCloseTo(MEASURABLE_TOTAL_SECONDS, 6);
    expect(await inspectEpubMediaOverlayFile(path)).toEqual({ available: true, durationSeconds: playlist.durationSeconds });
  });

  it('falls back to the package media:duration when a Storyteller track-boundary clip ends before it begins', async () => {
    const path = await writeReadAlongEpub(
      STORYTELLER_TRACK_BOUNDARY_CHAPTERS,
      `${STORYTELLER_OVERLAY_DURATIONS}\n    ${STORYTELLER_PACKAGE_DURATION}`,
    );

    const playlist = await buildEpubMediaOverlayPlaylistFromFile(path, 1, 2);

    expect(playlist.durationSeconds).toBeCloseTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6);
    expect(playlist.items.map((item) => item.durationSeconds)).toEqual([
      expect.closeTo(8, 6),
      null,
      expect.closeTo(4.64, 6),
      expect.closeTo(14.51, 6),
    ]);
    expect(playlist.items[1]).toEqual(expect.objectContaining({ clipBeginSeconds: 7223.15, clipEndSeconds: 7198.408 }));
    expect(playlist.sections.map((section) => section.durationSeconds)).toEqual([null, expect.closeTo(19.15, 6)]);
  });

  it('reports the declared total as the stored read-aloud capability', async () => {
    const path = await writeReadAlongEpub(STORYTELLER_TRACK_BOUNDARY_CHAPTERS, STORYTELLER_PACKAGE_DURATION);

    const capability = await inspectEpubMediaOverlayFile(path);
    const fields = await inspectEpubMediaOverlayFields(path, 'epub');

    expect(capability).toEqual({ available: true, durationSeconds: expect.closeTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6) });
    expect(fields).toEqual({
      mediaOverlayAvailable: true,
      mediaOverlayDurationSeconds: expect.closeTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6),
      mediaOverlayCheckedAt: expect.any(Date),
    });
  });

  it.each([
    ['omits clipEnd, which the spec reads as the end of the audio file', { begin: '3.620s' }],
    ['ends at a value that is not a clock value', { begin: '3.620s', end: 'NaNs' }],
    ['ends at a negative time', { begin: '3.620s', end: '-1.000s' }],
  ])('falls back to the package media:duration when a clip %s', async (_case, clip) => {
    const path = await writeReadAlongEpub(withLastClipOfChapterOne(clip), STORYTELLER_PACKAGE_DURATION);

    const playlist = await buildEpubMediaOverlayPlaylistFromFile(path, 1, 2);

    expect(playlist.items[1]?.durationSeconds).toBeNull();
    expect(playlist.durationSeconds).toBeCloseTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6);
  });

  it.each([
    ['a full clock value', '05:51:43.35'],
    ['a partial clock value', '351:43.35'],
    ['seconds', '21103.35s'],
    ['milliseconds', '21103350ms'],
    ['minutes', '351.7225min'],
    ['a bare number', '21103.35'],
    ['a clock value padded with whitespace', '\n      05:51:43.35\n    '],
  ])('reads a declared total written as %s', async (_case, value) => {
    const path = await writeReadAlongEpub(STORYTELLER_TRACK_BOUNDARY_CHAPTERS, `<meta property="media:duration">${value}</meta>`);

    const capability = await inspectEpubMediaOverlayFile(path);

    expect(capability.durationSeconds).toBeCloseTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6);
  });

  it('uses the package total even when the per-overlay durations are declared before it', async () => {
    const path = await writeReadAlongEpub(
      STORYTELLER_TRACK_BOUNDARY_CHAPTERS,
      `${STORYTELLER_OVERLAY_DURATIONS}\n    ${STORYTELLER_PACKAGE_DURATION}`,
    );

    expect((await inspectEpubMediaOverlayFile(path)).durationSeconds).toBeCloseTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6);
  });

  it('skips an unusable package total and takes the next valid one', async () => {
    const path = await writeReadAlongEpub(
      STORYTELLER_TRACK_BOUNDARY_CHAPTERS,
      `<meta property="media:duration">unknown</meta>\n    ${STORYTELLER_PACKAGE_DURATION}`,
    );

    expect((await inspectEpubMediaOverlayFile(path)).durationSeconds).toBeCloseTo(STORYTELLER_PACKAGE_DURATION_SECONDS, 6);
  });

  it('never mistakes a per-overlay duration for the package total', async () => {
    const path = await writeReadAlongEpub(STORYTELLER_TRACK_BOUNDARY_CHAPTERS, STORYTELLER_OVERLAY_DURATIONS);

    expect(await inspectEpubMediaOverlayFile(path)).toEqual({ available: true, durationSeconds: null });
  });

  it('keeps the duration unknown when the package declares no total', async () => {
    const path = await writeReadAlongEpub(STORYTELLER_TRACK_BOUNDARY_CHAPTERS, '');

    expect((await buildEpubMediaOverlayPlaylistFromFile(path, 1, 2)).durationSeconds).toBeNull();
    expect(await inspectEpubMediaOverlayFile(path)).toEqual({ available: true, durationSeconds: null });
  });

  it.each([
    ['zero', '00:00:00'],
    ['zero seconds', '0s'],
    ['negative', '-30s'],
    ['not a clock value', 'unknown'],
    ['empty', ''],
    ['infinite', 'Infinity'],
  ])('keeps the duration unknown when the declared total is %s', async (_case, value) => {
    const path = await writeReadAlongEpub(STORYTELLER_TRACK_BOUNDARY_CHAPTERS, `<meta property="media:duration">${value}</meta>`);

    expect(await inspectEpubMediaOverlayFile(path)).toEqual({ available: true, durationSeconds: null });
  });

  it('keeps the duration unknown when the package document named by the book info is missing', async () => {
    const path = await writeReadAlongEpub(STORYTELLER_TRACK_BOUNDARY_CHAPTERS, STORYTELLER_PACKAGE_DURATION);
    const manifest: EpubBookInfo['manifest'] = [
      { id: 'chapter-1', href: 'OEBPS/chapter-1.xhtml', mediaType: 'application/xhtml+xml', size: 0, mediaOverlay: 'chapter-1_overlay' },
      { id: 'chapter-1_overlay', href: 'OEBPS/MediaOverlays/chapter-1.smil', mediaType: 'application/smil+xml', size: 0 },
    ];
    const info: EpubBookInfo = {
      containerPath: 'OEBPS/missing.opf',
      rootPath: 'OEBPS/',
      spine: [{ idref: 'chapter-1', href: 'OEBPS/chapter-1.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
      manifest,
      toc: null,
      metadata: {},
      coverPath: null,
    };

    const playlist = await buildEpubMediaOverlayPlaylist(path, info, 1, 2);

    expect(playlist.items).toHaveLength(2);
    expect(playlist.durationSeconds).toBeNull();
  });
});
