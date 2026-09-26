import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32 } from 'zlib';
import { ZipArchive } from 'archiver';
import { BadRequestException } from '@nestjs/common';
import * as unzipper from 'unzipper';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeFileHash } from '../scanner/lib/hash';
import { buildEpubMediaOverlayPlaylistFromFile } from '../reader/epub/epub-media-overlay';
import { AudiolessEpubService } from './audioless-epub.service';

vi.mock('../reader/epub/epub-media-overlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reader/epub/epub-media-overlay')>();
  return { ...actual, buildEpubMediaOverlayPlaylistFromFile: vi.fn(actual.buildEpubMediaOverlayPlaylistFromFile) };
});

const mockBuildPlaylist = vi.mocked(buildEpubMediaOverlayPlaylistFromFile);

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const READALOUD_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:media="http://www.idpf.org/epub/vocab/overlays/#" version="3.0" unique-identifier="uid" prefix="media: http://www.idpf.org/epub/vocab/overlays/# storyteller: https://storyteller.ink/vocab#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Dune</dc:title>
    <dc:identifier id="uid">urn:uuid:1</dc:identifier>
    <meta property="media:duration" refines="#smil1">0:03:12.000</meta>
    <meta property="media:duration">0:03:12.000</meta>
    <meta property="media:active-class">-epub-media-overlay-active</meta>
    <meta property="storyteller:version">2.1</meta>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml" media-overlay="smil1"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml" media-overlay="smil2"/>
    <item id="css" href="styles/storyteller-readaloud.css" media-type="text/css"/>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="smil1" href="smil/ch1.smil" media-type="application/smil+xml"/>
    <item id="smil2" href="smil/ch2.smil" media-type="application/smil+xml"/>
    <item id="audio1" href="audio/ch1.mp3" media-type="audio/mpeg"/>
    <item id="audio2" href="audio/ch2.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;

function smilFor(index: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq${index}" epub:textref="../text/ch${index}.xhtml">
      <par id="par${index}-1">
        <text src="../text/ch${index}.xhtml#text-1-s1"/>
        <audio src="../audio/ch${index}.mp3" clipBegin="0s" clipEnd="4.5s"/>
      </par>
    </seq>
  </body>
</smil>`;
}

function chapterFor(index: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${index}</title></head>
<body><p><span id="text-${index}-s1">Sentence ${index}.</span></p></body></html>`;
}

const READALOUD_CSS = `.storyteller-readaloud span { color: inherit; }`;

type Entry = { name: string; content: string | Buffer; store?: boolean };

async function buildZip(path: string, entries: Entry[]): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const entry of entries) {
    archive.append(entry.content, { name: entry.name, store: entry.store });
  }
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

const DOS_EPOCH_DATE = 33;

/**
 * archiver sanitizes entry names as it writes, so a hostile archive has to be assembled by hand.
 * Stored entries only, which keeps the writer to plain local headers plus a central directory.
 */
async function buildRawZip(path: string, entries: Entry[], dosDate: number = DOS_EPOCH_DATE): Promise<void> {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8');
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf-8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  await writeFile(path, Buffer.concat([...locals, directory, end]));
}

function readaloudEntries(overrides: { opf?: string; audioNames?: [string, string] } = {}): Entry[] {
  const [audio1, audio2] = overrides.audioNames ?? ['OEBPS/audio/ch1.mp3', 'OEBPS/audio/ch2.mp3'];
  return [
    { name: 'mimetype', content: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', content: CONTAINER_XML },
    { name: 'OEBPS/content.opf', content: overrides.opf ?? READALOUD_OPF },
    { name: 'OEBPS/text/ch1.xhtml', content: chapterFor(1) },
    { name: 'OEBPS/text/ch2.xhtml', content: chapterFor(2) },
    { name: 'OEBPS/styles/storyteller-readaloud.css', content: READALOUD_CSS },
    { name: 'OEBPS/images/cover.jpg', content: Buffer.from('jpegbytes') },
    { name: 'OEBPS/smil/ch1.smil', content: smilFor(1) },
    { name: 'OEBPS/smil/ch2.smil', content: smilFor(2) },
    { name: audio1, content: Buffer.alloc(2048, 1) },
    { name: audio2, content: Buffer.alloc(2048, 2) },
  ];
}

const DEFAULT_LIMITS = {
  maxConcurrentBuilds: 2,
  maxSourceEntries: 50_000,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024 * 1024,
};

function makeService(limits: Partial<typeof DEFAULT_LIMITS> = {}): AudiolessEpubService {
  return new AudiolessEpubService({ ...DEFAULT_LIMITS, ...limits });
}

async function collectArchive(archive: ZipArchive): Promise<Buffer> {
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

type StrippedEpub = {
  bytes: Buffer;
  names: string[];
  removedEntries: number;
  sanitizedEntries: number;
  read: (name: string) => Promise<string>;
};

async function strip(service: AudiolessEpubService, epubPath: string): Promise<StrippedEpub> {
  const result = await service.createArchive(epubPath);
  const bytes = await collectArchive(result.archive);
  const zip = await unzipper.Open.buffer(bytes);
  return {
    bytes,
    names: zip.files.map((file) => file.path),
    removedEntries: result.removedEntries,
    sanitizedEntries: result.sanitizedEntries,
    read: async (name: string) => {
      const entry = zip.files.find((file) => file.path === name);
      if (!entry) throw new Error(`missing entry ${name}`);
      return (await entry.buffer()).toString('utf-8');
    },
  };
}

describe('AudiolessEpubService', () => {
  let dir: string;
  let service: AudiolessEpubService;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-audioless-test-'));
    service = makeService();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fixture(name: string, entries: Entry[]): Promise<string> {
    const path = join(dir, `${name}.epub`);
    await buildZip(path, entries);
    return path;
  }

  describe('read-along EPUB', () => {
    let stripped: StrippedEpub;

    beforeAll(async () => {
      stripped = await strip(service, await fixture('readaloud', readaloudEntries()));
    });

    it('removes every audio and SMIL entry', () => {
      expect(stripped.names).not.toContain('OEBPS/audio/ch1.mp3');
      expect(stripped.names).not.toContain('OEBPS/audio/ch2.mp3');
      expect(stripped.names).not.toContain('OEBPS/smil/ch1.smil');
      expect(stripped.names).not.toContain('OEBPS/smil/ch2.smil');
      expect(stripped.removedEntries).toBe(4);
    });

    it('keeps text, styles and images', () => {
      expect(stripped.names).toEqual(
        expect.arrayContaining([
          'mimetype',
          'META-INF/container.xml',
          'OEBPS/content.opf',
          'OEBPS/text/ch1.xhtml',
          'OEBPS/text/ch2.xhtml',
          'OEBPS/styles/storyteller-readaloud.css',
          'OEBPS/images/cover.jpg',
        ]),
      );
    });

    it('preserves the sentence anchors KOReader syncs against', async () => {
      await expect(stripped.read('OEBPS/text/ch1.xhtml')).resolves.toContain('id="text-1-s1"');
      await expect(stripped.read('OEBPS/text/ch2.xhtml')).resolves.toContain('id="text-2-s1"');
    });

    it('keeps mimetype first and stored so the archive stays a valid EPUB', () => {
      expect(stripped.names[0]).toBe('mimetype');
      expect(stripped.bytes.subarray(30, 38).toString('utf-8')).toBe('mimetype');
      expect(stripped.bytes.subarray(38, 58).toString('utf-8')).toBe('application/epub+zip');
    });

    it('drops audio and SMIL manifest items but keeps the rest', async () => {
      const opf = await stripped.read('OEBPS/content.opf');
      expect(opf).not.toContain('audio/ch1.mp3');
      expect(opf).not.toContain('smil/ch1.smil');
      expect(opf).not.toContain('application/smil+xml');
      expect(opf).toContain('text/ch1.xhtml');
      expect(opf).toContain('images/cover.jpg');
      expect(opf).toContain('storyteller-readaloud.css');
    });

    it('strips media-overlay attributes and overlay metadata from the OPF', async () => {
      const opf = await stripped.read('OEBPS/content.opf');
      expect(opf).not.toContain('media-overlay=');
      expect(opf).not.toContain('media:duration');
      expect(opf).not.toContain('media:active-class');
      expect(opf).not.toContain('storyteller:version');
      expect(opf).not.toContain('xmlns:media');
      expect(opf).not.toContain('prefix=');
    });

    it('leaves unrelated metadata and the spine untouched', async () => {
      const opf = await stripped.read('OEBPS/content.opf');
      expect(opf).toContain('<dc:title>Dune</dc:title>');
      expect(opf).toContain('dcterms:modified');
      expect(opf).toContain('cover-image');
      expect(opf).toContain('<itemref idref="ch1"');
      expect(opf).toContain('<itemref idref="ch2"');
    });

    it('neutralizes the Storyteller sentence-span styling exactly once', async () => {
      const css = await stripped.read('OEBPS/styles/storyteller-readaloud.css');
      expect(css).toContain('.storyteller-readaloud span');
      expect(css.match(/font-size: inherit/g)).toHaveLength(1);
    });
  });

  describe('determinism', () => {
    // Zip stores timestamps at 2-second resolution, so back-to-back rebuilds would match by
    // accident. Moving the clock between runs is what makes these assertions meaningful.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('produces byte-identical output across runs a day apart', async () => {
      const path = await fixture('deterministic', readaloudEntries());

      const first = await strip(service, path);
      vi.setSystemTime(new Date('2026-03-02T18:30:00Z'));
      const second = await strip(service, path);

      expect(first.bytes.equals(second.bytes)).toBe(true);
    });

    it('keeps the KOReader hash stable when only the source timestamps change', async () => {
      const original = join(dir, 'timestamps-original.epub');
      const realigned = join(dir, 'timestamps-realigned.epub');
      await buildRawZip(original, readaloudEntries(), DOS_EPOCH_DATE);
      await buildRawZip(realigned, readaloudEntries(), 22735);

      const outputs = [join(dir, 'hash-original.epub'), join(dir, 'hash-realigned.epub')];
      await writeFile(outputs[0], (await strip(service, original)).bytes);
      vi.setSystemTime(new Date('2026-03-02T18:30:00Z'));
      await writeFile(outputs[1], (await strip(service, realigned)).bytes);

      const [originalHash, realignedHash] = await Promise.all(outputs.map(computeFileHash));
      expect(originalHash).toBe(realignedHash);
    });
  });

  it('removes audio whose zip entry case differs from the declared href', async () => {
    // The OPF and SMIL both say `audio/ch1.mp3` while the archive stores `Audio/CH1.MP3`.
    // Matching those literally would drop the manifest item but ship the audio bytes anyway.
    const path = await fixture('case-mismatch', readaloudEntries({ audioNames: ['OEBPS/Audio/CH1.MP3', 'OEBPS/audio/ch2.mp3'] }));

    const stripped = await strip(service, path);

    expect(stripped.names.some((name) => name.toLowerCase().endsWith('.mp3'))).toBe(false);
    expect(stripped.removedEntries).toBe(4);
  });

  it('rewrites entry names that escape the archive root', async () => {
    const path = join(dir, 'unsafe-paths.epub');
    await buildRawZip(path, [
      ...readaloudEntries(),
      { name: '../../evil.txt', content: 'nope' },
      { name: '/absolute.txt', content: 'nope' },
      { name: 'OEBPS/../../escape.xhtml', content: 'nope' },
    ]);
    const source = await unzipper.Open.file(path);
    expect(source.files.map((file) => file.path)).toEqual(expect.arrayContaining(['../../evil.txt', '/absolute.txt']));

    const stripped = await strip(service, path);

    expect(stripped.names.some((name) => name.startsWith('/') || name.includes('..'))).toBe(false);
    expect(stripped.names).toEqual(expect.arrayContaining(['evil.txt', 'absolute.txt', 'escape.xhtml']));
    expect(stripped.sanitizedEntries).toBe(3);
  });

  it('passes through an EPUB that has no media overlay', async () => {
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plain</dc:title><dc:identifier id="uid">x</dc:identifier></metadata>
  <manifest><item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;
    const path = await fixture('plain', [
      { name: 'mimetype', content: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', content: CONTAINER_XML },
      { name: 'OEBPS/content.opf', content: opf },
      { name: 'OEBPS/text/ch1.xhtml', content: chapterFor(1) },
    ]);

    const stripped = await strip(service, path);

    expect(stripped.removedEntries).toBe(0);
    expect(stripped.sanitizedEntries).toBe(0);
    expect(stripped.names).toEqual(['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/text/ch1.xhtml']);
    await expect(stripped.read('OEBPS/content.opf')).resolves.toContain('<dc:title>Plain</dc:title>');
  });

  it('rejects an EPUB without container.xml', async () => {
    const path = await fixture('no-container', [{ name: 'mimetype', content: 'application/epub+zip', store: true }]);

    await expect(service.createArchive(path)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a container.xml that declares no rootfile', async () => {
    const path = await fixture('no-rootfile', [
      { name: 'mimetype', content: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', content: '<?xml version="1.0"?><container version="1.0"><rootfiles/></container>' },
    ]);

    await expect(service.createArchive(path)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an EPUB whose OPF is missing from the archive', async () => {
    const path = await fixture('no-opf', [
      { name: 'mimetype', content: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', content: CONTAINER_XML },
    ]);

    await expect(service.createArchive(path)).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('resource bounds', () => {
    it('rejects an archive with more entries than the limit allows', async () => {
      const path = await fixture('too-many-entries', readaloudEntries());

      await expect(makeService({ maxSourceEntries: 5 }).createArchive(path)).rejects.toThrow(/over the 5 limit/);
    });

    it('rejects a package document larger than the metadata limit', async () => {
      const padded = READALOUD_OPF.replace('</metadata>', `<meta property="pad">${'x'.repeat(4096)}</meta></metadata>`);
      const path = await fixture('huge-opf', readaloudEntries({ opf: padded }));

      await expect(makeService({ maxMetadataBytes: 1024 }).createArchive(path)).rejects.toThrow(/OPF is \d+ bytes/);
    });

    it('rejects a container.xml larger than the metadata limit', async () => {
      const padded = CONTAINER_XML.replace('</container>', `<!--${'x'.repeat(4096)}--></container>`);
      const entries = readaloudEntries().map((entry) => (entry.name === 'META-INF/container.xml' ? { ...entry, content: padded } : entry));
      const path = await fixture('huge-container', entries);

      await expect(makeService({ maxMetadataBytes: 1024 }).createArchive(path)).rejects.toThrow(/container\.xml is \d+ bytes/);
    });

    it('rejects when the retained text would exceed the output limit', async () => {
      const path = await fixture('huge-output', readaloudEntries());

      await expect(makeService({ maxOutputBytes: 512 }).createArchive(path)).rejects.toThrow(/rebuild limit/);
    });

    it('measures the output limit against retained entries only, ignoring stripped audio', async () => {
      const path = await fixture('audio-heavy', readaloudEntries());

      // The two 2 KB audio entries alone would blow this budget if they were counted.
      const stripped = await strip(makeService({ maxOutputBytes: 3072 }), path);

      expect(stripped.removedEntries).toBe(4);
    });
  });

  describe('build concurrency', () => {
    it('runs no more rebuilds at once than the configured limit', async () => {
      const path = await fixture('concurrency', readaloudEntries());
      const limited = makeService({ maxConcurrentBuilds: 2 });
      let active = 0;
      let peak = 0;
      const original = limited.createArchive.bind(limited);
      vi.spyOn(limited, 'createArchive').mockImplementation(async (source: string) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        try {
          return await original(source);
        } finally {
          active -= 1;
        }
      });

      await Promise.all(Array.from({ length: 6 }, (_, index) => limited.writeArchive(path, join(dir, `concurrent-${index}.epub`))));

      expect(peak).toBe(2);
    });

    it('holds the limit when builds arrive after others are already queued', async () => {
      const path = await fixture('concurrency-staggered', readaloudEntries());
      const limited = makeService({ maxConcurrentBuilds: 2 });
      let active = 0;
      let peak = 0;
      const original = limited.createArchive.bind(limited);
      vi.spyOn(limited, 'createArchive').mockImplementation(async (source: string) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        try {
          return await original(source);
        } finally {
          active -= 1;
        }
      });

      const running = Array.from({ length: 4 }, (_, index) => limited.writeArchive(path, join(dir, `staggered-a${index}.epub`)));
      await new Promise((resolve) => setTimeout(resolve, 18));
      running.push(...Array.from({ length: 3 }, (_, index) => limited.writeArchive(path, join(dir, `staggered-b${index}.epub`))));
      await Promise.all(running);

      expect(peak).toBe(2);
    });

    it('releases its build slot when a rebuild fails', async () => {
      const broken = await fixture('slot-release-broken', [{ name: 'mimetype', content: 'application/epub+zip', store: true }]);
      const valid = await fixture('slot-release-valid', readaloudEntries());
      const limited = makeService({ maxConcurrentBuilds: 1 });

      await expect(limited.writeArchive(broken, join(dir, 'slot-release-fail.epub'))).rejects.toBeInstanceOf(BadRequestException);

      await expect(limited.writeArchive(valid, join(dir, 'slot-release-ok.epub'))).resolves.toEqual({ removedEntries: 4, sanitizedEntries: 0 });
    });

    it('surfaces a write failure', async () => {
      const path = await fixture('write-failure', readaloudEntries());

      await expect(service.writeArchive(path, join(dir, 'missing-directory', 'out.epub'))).rejects.toThrow(/ENOENT/);
    });

    it('settles the build when finalize rejects without emitting an error event', async () => {
      const failing = makeService();
      const archive = { on: vi.fn(), pipe: vi.fn(), finalize: vi.fn().mockRejectedValue(new Error('deflate exploded')) };
      vi.spyOn(failing, 'createArchive').mockResolvedValue({
        archive: archive as unknown as ZipArchive,
        removedEntries: 0,
        sanitizedEntries: 0,
      });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        await expect(failing.writeArchive('/ignored.epub', join(dir, 'finalize-failure.epub'))).rejects.toThrow('deflate exploded');
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }

      expect(unhandled).toEqual([]);
    });
  });

  describe('media overlay discovery', () => {
    beforeEach(() => {
      mockBuildPlaylist.mockClear();
    });

    // These two assert opposite halves of the same branch, so neither can pass because the module
    // mock silently failed to apply.
    it('falls back to the SMIL playlist when the manifest declares no audio', async () => {
      const opf = READALOUD_OPF.replace(/<item id="audio1"[^>]*\/>/, '').replace(/<item id="audio2"[^>]*\/>/, '');
      const path = await fixture('undeclared-audio', readaloudEntries({ opf }));

      const stripped = await strip(service, path);

      expect(mockBuildPlaylist).toHaveBeenCalledTimes(1);
      expect(stripped.names.some((name) => name.toLowerCase().endsWith('.mp3'))).toBe(false);
      expect(stripped.removedEntries).toBe(4);
    });

    it('skips the SMIL parse when the manifest already declares the audio', async () => {
      const path = await fixture('declared-audio', readaloudEntries());

      const stripped = await strip(service, path);

      expect(mockBuildPlaylist).not.toHaveBeenCalled();
      expect(stripped.removedEntries).toBe(4);
    });
  });
});
