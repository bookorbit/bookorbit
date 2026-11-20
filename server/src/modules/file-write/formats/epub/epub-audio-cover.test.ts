import { ZipArchive } from 'archiver';
import { createWriteStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import * as unzipper from 'unzipper';

import { extractEpubAudioCover, extractEpubCover } from '../../../metadata/lib/cover-epub';
import { locateAudioCover, setAudioCover } from './epub-cover-handler';
import { toEpubCoreImage } from './epub-cover-image';
import { EpubFormatWriter } from './epub-format-writer';

const jpeg = { mediaType: 'image/jpeg', extension: 'jpg' };
const png = { mediaType: 'image/png', extension: 'png' };
const objectParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });
const AUDIO_PROPERTY = 'storyteller:audio-cover-image';
const STORYTELLER_PREFIX = 'storyteller: https://storyteller-platform.gitlab.io/storyteller/docs/vocabulary';

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

function packageOf(xml: string): { prefix: string | undefined; metas: Record<string, string>[]; items: Record<string, string>[] } {
  const pkg = objectParser.parse(xml).package;
  return { prefix: pkg['@_prefix'], metas: asArray(pkg.metadata.meta), items: asArray(pkg.manifest.item) };
}

describe('locateAudioCover', () => {
  const opf = (items: string) => `
    <package version="3.0" prefix="${STORYTELLER_PREFIX}">
      <metadata />
      <manifest><item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image" />${items}</manifest>
    </package>`;

  it('finds the image that carries the property, resolved against the OPF directory', () => {
    const xml = opf(`<item id="art" href="../img/art%20one.webp" media-type="image/webp" properties="${AUDIO_PROPERTY}" />`);

    expect(locateAudioCover(xml, 'OPS/content/')).toEqual({ entryPath: 'OPS/img/art one.webp', mediaType: 'image/webp', manifestItemId: 'art' });
  });

  it('finds the property among others on the same item', () => {
    const xml = opf(`<item id="art" href="art.png" media-type="image/png" properties="${AUDIO_PROPERTY} remote-resources" />`);

    expect(locateAudioCover(xml, '')).toMatchObject({ manifestItemId: 'art' });
  });

  it('finds nothing without the property, however an image is named or shaped', () => {
    expect(locateAudioCover(opf('<item id="audio-cover-image" href="images/audio-cover.jpg" media-type="image/jpeg" />'), '')).toBeNull();
  });

  it("finds nothing when the property sits on the book's own cover, by property or by the cover meta", () => {
    expect(
      locateAudioCover(
        `<package version="3.0"><metadata />
          <manifest><item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image ${AUDIO_PROPERTY}" /></manifest></package>`,
        '',
      ),
    ).toBeNull();
    expect(
      locateAudioCover(
        `<package version="2.0"><metadata><meta name="cover" content="art" /></metadata>
          <manifest><item id="art" href="art.jpg" media-type="image/jpeg" properties="${AUDIO_PROPERTY}" /></manifest></package>`,
        '',
      ),
    ).toBeNull();
  });

  it('finds nothing when the property is on a document or an SVG', () => {
    expect(
      locateAudioCover(opf(`<item id="doc" href="a.xhtml" media-type="application/xhtml+xml" properties="${AUDIO_PROPERTY}" />`), ''),
    ).toBeNull();
    expect(locateAudioCover(opf(`<item id="vec" href="a.svg" media-type="image/svg+xml" properties="${AUDIO_PROPERTY}" />`), '')).toBeNull();
  });
});

describe('setAudioCover', () => {
  const base = `<?xml version="1.0"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><meta name="cover" content="cover" /></metadata>
      <manifest>
        <item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image" />
        <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" />
      </manifest>
      <spine><itemref idref="c1" /></spine>
    </package>`;

  it('adds an image carrying the property and declares the prefix, leaving the book cover alone', () => {
    const result = setAudioCover(base, 'OPS/', png, ['OPS/cover.jpg']);

    expect(result.newEntryPath).toBe('OPS/images/audio-cover.png');
    const { prefix, metas, items } = packageOf(result.updatedOpfXml);
    expect(prefix).toBe(STORYTELLER_PREFIX);
    expect(metas).toEqual([{ '@_name': 'cover', '@_content': 'cover' }]);
    expect(items).toContainEqual({
      '@_id': 'audio-cover-image',
      '@_href': 'images/audio-cover.png',
      '@_media-type': 'image/png',
      '@_properties': AUDIO_PROPERTY,
    });
    expect(items.filter((item) => item['@_properties']?.includes('cover-image'))).toEqual([
      expect.objectContaining({ '@_id': 'cover' }),
      expect.objectContaining({ '@_id': 'audio-cover-image' }),
    ]);
  });

  it('appends the prefix to the ones the package already declares, and never declares it twice', () => {
    const withPrefix = base.replace('<package version="3.0"', '<package version="3.0" prefix="schema: http://schema.org/"');

    const first = setAudioCover(withPrefix, '', jpeg, []);
    expect(packageOf(first.updatedOpfXml).prefix).toBe(`schema: http://schema.org/ ${STORYTELLER_PREFIX}`);

    const again = setAudioCover(first.updatedOpfXml, '', png, [first.newEntryPath]);
    expect(packageOf(again.updatedOpfXml).prefix).toBe(`schema: http://schema.org/ ${STORYTELLER_PREFIX}`);
  });

  it('never rewrites the book cover when the property sits on it, adding a separate image instead', () => {
    const named = base.replace('properties="cover-image"', `properties="cover-image ${AUDIO_PROPERTY}"`);

    const result = setAudioCover(named, '', png, ['cover.jpg']);

    expect(result.newEntryPath).toBe('images/audio-cover.png');
    const { items } = packageOf(result.updatedOpfXml);
    expect(items).toContainEqual({
      '@_id': 'audio-cover-image',
      '@_href': 'images/audio-cover.png',
      '@_media-type': 'image/png',
      '@_properties': AUDIO_PROPERTY,
    });
  });

  it('keeps the id, file and OPF when the image declared has the same type', () => {
    const first = setAudioCover(base, '', jpeg, []);
    const again = setAudioCover(first.updatedOpfXml, '', jpeg, [first.newEntryPath]);

    expect(again).toEqual({ updatedOpfXml: first.updatedOpfXml, newEntryPath: first.newEntryPath });
  });

  it('moves the declared image to a new file when its type changes, keeping the property and a single item', () => {
    const first = setAudioCover(base, '', jpeg, []);
    const next = setAudioCover(first.updatedOpfXml, '', png, [first.newEntryPath]);

    expect(next.newEntryPath).toBe('images/audio-cover.png');
    expect(next.removedEntryPath).toBe('images/audio-cover.jpg');
    const { items } = packageOf(next.updatedOpfXml);
    expect(items.filter((item) => item['@_properties']?.includes(AUDIO_PROPERTY))).toEqual([
      { '@_id': 'audio-cover-image', '@_href': 'images/audio-cover.png', '@_media-type': 'image/png', '@_properties': AUDIO_PROPERTY },
    ]);
  });

  it('drops no entry while the image keeps its path, or while another item still points at the old one', () => {
    const first = setAudioCover(base, '', jpeg, []);
    expect(setAudioCover(first.updatedOpfXml, '', jpeg, [first.newEntryPath]).removedEntryPath).toBeUndefined();

    const shared = first.updatedOpfXml.replace('</manifest>', '<item id="reuse" href="images/audio-cover.jpg" media-type="image/jpeg" /></manifest>');
    expect(setAudioCover(shared, '', png, [first.newEntryPath]).removedEntryPath).toBeUndefined();
  });

  it('picks an id and path nobody holds', () => {
    const crowded = base.replace('<item id="c1"', '<item id="audio-cover-image" href="x.png" media-type="image/png" /><item id="c1"');

    const result = setAudioCover(crowded, '', jpeg, ['images/Audio-Cover-2.jpg']);

    expect(result.newEntryPath).toBe('images/audio-cover-3.jpg');
    expect(packageOf(result.updatedOpfXml).items).toContainEqual(
      expect.objectContaining({ '@_id': 'audio-cover-image-3', '@_properties': AUDIO_PROPERTY }),
    );
  });

  it('writes under the prefix the package binds to the OPF namespace', () => {
    const prefixed = `<opf:package version="3.0" xmlns:opf="http://www.idpf.org/2007/opf">
      <opf:metadata><opf:meta name="cover" content="cover" /></opf:metadata>
      <opf:manifest><opf:item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image" /></opf:manifest>
    </opf:package>`;

    const { updatedOpfXml } = setAudioCover(prefixed, '', jpeg, []);

    expect(updatedOpfXml).toContain(
      `<opf:item id="audio-cover-image" href="images/audio-cover.jpg" media-type="image/jpeg" properties="${AUDIO_PROPERTY}">`,
    );
  });

  it('refuses a package it cannot place the declaration in', () => {
    expect(() => setAudioCover('<package version="3.0"><metadata/></package>', '', jpeg, [])).toThrow('manifest section');
    expect(() => setAudioCover('<package version="2.0"><metadata/><manifest/></package>', '', jpeg, [])).toThrow('Unsupported EPUB version');
  });
});

describe('toEpubCoreImage', () => {
  const make = (format: 'jpeg' | 'png' | 'webp' | 'tiff' | 'avif') =>
    sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 90, b: 160, alpha: 0.5 } } })
      [format]()
      .toBuffer();

  it.each(['jpeg', 'png', 'webp'] as const)('keeps %s bytes as they are', async (format) => {
    const bytes = await make(format);

    const result = await toEpubCoreImage(bytes);

    expect(result.bytes).toBe(bytes);
    expect(result.image.mediaType).toBe(`image/${format}`);
  });

  it.each(['tiff', 'avif'] as const)('re-encodes %s as JPEG, which every reader renders', async (format) => {
    const result = await toEpubCoreImage(await make(format));

    expect(result.image).toEqual({ mediaType: 'image/jpeg', extension: 'jpg' });
    expect((await sharp(result.bytes).metadata()).format).toBe('jpeg');
  });
});

describe('EpubFormatWriter.embedAudioCover', () => {
  let root: string;
  let filePath: string;
  const writer = new EpubFormatWriter();

  const opf = (withBookCover: boolean, withStorytellerCover: boolean) => `<?xml version="1.0"?>
    <package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf"${withStorytellerCover ? ` prefix="${STORYTELLER_PREFIX}"` : ''}>
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:test:audio-cover</dc:identifier><dc:title>Old</dc:title><dc:language>en</dc:language>
        <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
        ${withBookCover ? '<meta name="cover" content="cover" />' : ''}
      </metadata>
      <manifest>
        ${withBookCover ? '<item id="cover" href="cover.jpeg" media-type="image/jpeg" properties="cover-image" />' : ''}
        ${withStorytellerCover ? `<item id="audio-cover-image" href="images/audio-cover.jpg" media-type="image/jpeg" properties="${AUDIO_PROPERTY}" />` : ''}
        <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" />
      </manifest>
      <spine><itemref idref="c1" /></spine>
    </package>`;

  const image = (width: number, height: number, color: { r: number; g: number; b: number }, format: 'jpeg' | 'png' = 'jpeg') =>
    sharp({ create: { width, height, channels: 3, background: color } })
      [format]()
      .toBuffer();

  async function archive(path: string, options: { withBookCover?: boolean; storytellerCover?: Buffer } = {}): Promise<{ bookCover: Buffer }> {
    const withBookCover = options.withBookCover ?? true;
    const bookCover = await image(40, 60, { r: 200, g: 20, b: 20 });
    const output = createWriteStream(path);
    const zip = new ZipArchive({ zlib: { level: 6 } });
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      zip.on('error', reject);
      zip.pipe(output);
      zip.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
      zip.append(
        Buffer.from(
          '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        ),
        { name: 'META-INF/container.xml' },
      );
      zip.append(Buffer.from(opf(withBookCover, options.storytellerCover !== undefined)), { name: 'OPS/content.opf' });
      zip.append(Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>read along</p></body></html>'), { name: 'OPS/c1.xhtml' });
      if (withBookCover) zip.append(bookCover, { name: 'OPS/cover.jpeg' });
      if (options.storytellerCover) zip.append(options.storytellerCover, { name: 'OPS/images/audio-cover.jpg' });
      zip.append(Buffer.alloc(300_000, 7), { name: 'OPS/audio/track-1.mp4', store: true });
      void zip.finalize();
    });
    return { bookCover };
  }

  async function entry(path: string): Promise<Buffer> {
    const zip = await unzipper.Open.file(filePath);
    const found = zip.files.find((candidate) => candidate.path === path);
    if (!found) throw new Error(`Missing entry ${path}`);
    return found.buffer();
  }

  async function audioCoverItems(): Promise<Record<string, string>[]> {
    const { items } = packageOf((await entry('OPS/content.opf')).toString());
    return items.filter((item) => item['@_properties']?.includes(AUDIO_PROPERTY));
  }

  async function entryPaths(): Promise<string[]> {
    return (await unzipper.Open.file(filePath)).files.map((file) => file.path);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-audio-cover-'));
    filePath = join(root, 'book.readaloud.epub');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('adds a square cover the app reads back, without touching the book cover or the narration', async () => {
    const { bookCover } = await archive(filePath);
    const square = await image(320, 320, { r: 20, g: 160, b: 60 });

    const result = await writer.embedAudioCover(filePath, square, { dryRun: false });

    expect(result).toMatchObject({ status: 'success', fieldsWritten: ['audioCoverBytes'] });
    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(square);
    await expect(extractEpubCover(filePath)).resolves.toEqual(bookCover);
    await expect(entry('OPS/cover.jpeg')).resolves.toEqual(bookCover);
    await expect(entry('OPS/audio/track-1.mp4')).resolves.toEqual(Buffer.alloc(300_000, 7));
    await expect(entry('OPS/images/audio-cover.jpg')).resolves.toEqual(square);
    expect(packageOf((await entry('OPS/content.opf')).toString()).prefix).toBe(STORYTELLER_PREFIX);
    const zip = await unzipper.Open.file(filePath);
    expect(zip.files[0]).toMatchObject({ path: 'mimetype', compressionMethod: 0 });
  });

  it('declares an audio cover for a book that has no cover of its own, without making it the book cover', async () => {
    await archive(filePath, { withBookCover: false });
    const square = await image(300, 300, { r: 20, g: 60, b: 160 });

    await writer.embedAudioCover(filePath, square, { dryRun: false });

    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(square);
    await expect(extractEpubCover(filePath)).resolves.toBeNull();
  });

  it('reads the cover a Storyteller-built EPUB already carries, apart from the book cover', async () => {
    const stored = await image(500, 500, { r: 120, g: 40, b: 40 });
    const { bookCover } = await archive(filePath, { storytellerCover: stored });

    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(stored);
    await expect(extractEpubCover(filePath)).resolves.toEqual(bookCover);
  });

  it('replaces the cover Storyteller wrote in place, leaving one audio cover and one prefix', async () => {
    await archive(filePath, { storytellerCover: await image(500, 500, { r: 120, g: 40, b: 40 }) });
    const square = await image(522, 522, { r: 20, g: 160, b: 60 });

    const result = await writer.embedAudioCover(filePath, square, { dryRun: false });

    expect(result).toMatchObject({ status: 'success' });
    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(square);
    await expect(entry('OPS/images/audio-cover.jpg')).resolves.toEqual(square);
    expect(await audioCoverItems()).toEqual([
      { '@_id': 'audio-cover-image', '@_href': 'images/audio-cover.jpg', '@_media-type': 'image/jpeg', '@_properties': AUDIO_PROPERTY },
    ]);
    expect(packageOf((await entry('OPS/content.opf')).toString()).prefix).toBe(STORYTELLER_PREFIX);
  });

  it('writes nothing when the declared cover is already this image', async () => {
    await archive(filePath);
    const square = await image(320, 320, { r: 20, g: 160, b: 60 });
    await writer.embedAudioCover(filePath, square, { dryRun: false });
    const before = await stat(filePath);

    const result = await writer.embedAudioCover(filePath, square, { dryRun: false });

    expect(result).toMatchObject({ status: 'skipped', reason: 'audio cover unchanged', fieldsWritten: [] });
    const after = await stat(filePath);
    expect([after.mtimeMs, after.size, after.ino]).toEqual([before.mtimeMs, before.size, before.ino]);
  });

  it('replaces the declared cover in place, then moves it when its type changes without leaving the old file', async () => {
    await archive(filePath);
    await writer.embedAudioCover(filePath, await image(320, 320, { r: 20, g: 160, b: 60 }), { dryRun: false });

    const second = await image(320, 320, { r: 160, g: 60, b: 20 });
    await writer.embedAudioCover(filePath, second, { dryRun: false });
    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(second);
    await expect(entry('OPS/images/audio-cover.jpg')).resolves.toEqual(second);

    const third = await image(320, 320, { r: 60, g: 20, b: 160 }, 'png');
    await writer.embedAudioCover(filePath, third, { dryRun: false });
    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(third);
    expect(await audioCoverItems()).toHaveLength(1);
    expect(await entryPaths()).toContain('OPS/images/audio-cover.png');
    expect(await entryPaths()).not.toContain('OPS/images/audio-cover.jpg');

    const fourth = await image(320, 320, { r: 1, g: 100, b: 100 });
    await writer.embedAudioCover(filePath, fourth, { dryRun: false });
    await expect(entry('OPS/images/audio-cover.jpg')).resolves.toEqual(fourth);
    expect((await entryPaths()).filter((path) => path.includes('audio-cover'))).toEqual(['OPS/images/audio-cover.jpg']);
  });

  it('drops the cover Storyteller wrote when a new image type replaces it', async () => {
    await archive(filePath, { storytellerCover: await image(500, 500, { r: 120, g: 40, b: 40 }) });
    const square = await image(320, 320, { r: 20, g: 160, b: 60 }, 'png');

    await writer.embedAudioCover(filePath, square, { dryRun: false });

    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(square);
    expect((await entryPaths()).filter((path) => path.includes('audio-cover'))).toEqual(['OPS/images/audio-cover.png']);
    expect(await audioCoverItems()).toHaveLength(1);
  });

  it('reports what it would write on a dry run and changes nothing', async () => {
    await archive(filePath);
    const before = await stat(filePath);

    const result = await writer.embedAudioCover(filePath, await image(320, 320, { r: 1, g: 2, b: 3 }), { dryRun: true });

    expect(result).toMatchObject({ status: 'skipped', reason: 'dry-run', fieldsWritten: ['audioCoverBytes'] });
    const after = await stat(filePath);
    expect([after.mtimeMs, after.size]).toEqual([before.mtimeMs, before.size]);
    await expect(extractEpubAudioCover(filePath)).resolves.toBeNull();
  });

  it('survives a later metadata and book-cover write', async () => {
    await archive(filePath);
    const square = await image(320, 320, { r: 20, g: 160, b: 60 });
    await writer.embedAudioCover(filePath, square, { dryRun: false });
    const newBookCover = await image(50, 75, { r: 90, g: 90, b: 200 });

    await writer.write(filePath, { title: 'New title', coverBytes: newBookCover }, { fieldMask: new Set(['title', 'coverBytes']), dryRun: false });

    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(square);
    await expect(extractEpubCover(filePath)).resolves.toEqual(newBookCover);
    await expect(entry('OPS/images/audio-cover.jpg')).resolves.toEqual(square);
    expect(await audioCoverItems()).toHaveLength(1);
  });

  it('never writes a book cover over the audio cover, even when the book declares none', async () => {
    await archive(filePath, { withBookCover: false });
    const square = await image(300, 300, { r: 20, g: 60, b: 160 });
    await writer.embedAudioCover(filePath, square, { dryRun: false });
    const bookCover = await image(50, 75, { r: 90, g: 90, b: 200 });

    await writer.write(filePath, { coverBytes: bookCover }, { fieldMask: new Set(['coverBytes']), dryRun: false });

    await expect(extractEpubAudioCover(filePath)).resolves.toEqual(square);
    await expect(extractEpubCover(filePath)).resolves.toEqual(bookCover);
  });

  it('re-encodes an image a reader may not render', async () => {
    await archive(filePath);
    const tiff = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 5, g: 5, b: 5 } } })
      .tiff()
      .toBuffer();

    await writer.embedAudioCover(filePath, tiff, { dryRun: false });

    const stored = await extractEpubAudioCover(filePath);
    expect((await sharp(stored!).metadata()).format).toBe('jpeg');
  });

  it('leaves the file untouched when the image cannot be decoded', async () => {
    await archive(filePath);
    const before = await stat(filePath);

    await expect(writer.embedAudioCover(filePath, Buffer.from('not an image'), { dryRun: false })).rejects.toThrow();

    const after = await stat(filePath);
    expect([after.mtimeMs, after.size, after.ino]).toEqual([before.mtimeMs, before.size, before.ino]);
  });
});
