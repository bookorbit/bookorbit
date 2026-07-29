import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { XMLValidator } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import sharp from 'sharp';

import { FB2_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { writeFb2Metadata } from './fb2-write-core';

const FULL_MASK = new Set<BookWritePayloadKey>(FB2_BOOK_FILE_WRITE_FIELDS);
const NBSP = ' ';

let testRoot: string;
let jpegCover: Buffer;
let pngCover: Buffer;

beforeAll(async () => {
  jpegCover = await sharp({ create: { width: 12, height: 18, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .jpeg()
    .toBuffer();
  pngCover = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
});

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-fb2-write-'));
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

type FileOptions = {
  declaration?: string;
  rootAttributes?: string;
  titleInfo?: string;
  extraDescription?: string;
  body?: string;
  binaries?: string;
  encoding?: string;
  newline?: '\n' | '\r\n';
};

const DEFAULT_TITLE_INFO = [
  '    <genre>antique</genre>',
  '    <author><first-name>Old</first-name><last-name>Author</last-name></author>',
  '    <book-title>Old Title</book-title>',
  '    <lang>en</lang>',
].join('\n');

/** Body text carrying the characters a naive XML round-trip is known to damage. */
const DEFAULT_BODY = [
  '<body>',
  '  <section>',
  `    <p>Text with${NBSP}a non-breaking space and an &amp; entity.</p>`,
  '    <empty-line/>',
  '    <p>Second   paragraph   with   runs   of   spaces.</p>',
  '  </section>',
  '</body>',
].join('\n');

function fb2Content(options: FileOptions = {}): string {
  const declaration = options.declaration ?? '<?xml version="1.0" encoding="UTF-8"?>';
  const rootAttributes = options.rootAttributes ?? 'xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"';
  const parts = [
    declaration,
    `<FictionBook ${rootAttributes}>`,
    '<description>',
    '  <title-info>',
    options.titleInfo ?? DEFAULT_TITLE_INFO,
    '  </title-info>',
    '  <document-info><id>doc-1</id><version>1.0</version></document-info>',
    options.extraDescription ?? '',
    '</description>',
    options.body ?? DEFAULT_BODY,
    options.binaries ?? '',
    '</FictionBook>',
    '',
  ].filter((part) => part !== '');
  const content = parts.join('\n');
  return options.newline === '\r\n' ? content.replace(/\n/g, '\r\n') : content;
}

async function makeFile(content: string, encoding = 'utf8'): Promise<string> {
  const path = join(testRoot, 'book.fb2');
  await writeFile(path, encoding === 'utf8' ? Buffer.from(content, 'utf8') : iconv.encode(content, encoding));
  return path;
}

async function write(path: string, payload: BookWritePayload, mask: Set<BookWritePayloadKey> = FULL_MASK, dryRun = false) {
  return writeFb2Metadata(path, payload, mask, { dryRun });
}

function bodyRegion(text: string): string {
  return text.slice(text.indexOf('<body'), text.lastIndexOf('</body>') + '</body>'.length);
}

function binaryMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of text.matchAll(/<binary\b([^>]*)>([\s\S]*?)<\/binary>/g)) {
    const id = match[1]!.match(/\bid\s*=\s*"([^"]*)"/)?.[1] ?? '(none)';
    map.set(id, match[2]!);
  }
  return map;
}

function expectWellFormed(text: string): void {
  const result = XMLValidator.validate(text, { allowBooleanAttributes: true });
  expect(result === true ? true : JSON.stringify(result)).toBe(true);
}

describe('writeFb2Metadata byte preservation', () => {
  it('leaves every byte outside the description untouched', async () => {
    const original = fb2Content();
    const path = await makeFile(original);
    const originalBytes = await readFile(path);

    const result = await write(path, { title: 'New Title', language: 'de' });
    expect(result.status).toBe('success');

    const updated = await readFile(path);
    const originalText = originalBytes.toString('utf8');
    const updatedText = updated.toString('utf8');
    const headLength = originalText.indexOf('<description>');

    expect(updated.subarray(0, headLength).equals(originalBytes.subarray(0, headLength))).toBe(true);
    const originalTail = originalBytes.subarray(originalText.indexOf('</description>') + '</description>'.length);
    const updatedTail = updated.subarray(updatedText.indexOf('</description>') + '</description>'.length);
    expect(updatedTail.equals(originalTail)).toBe(true);
  });

  it('preserves non-breaking spaces, entities and empty-line tags in the body', async () => {
    const path = await makeFile(fb2Content());
    const before = bodyRegion(await readFile(path, 'utf8'));

    await write(path, { title: 'New Title', description: 'Fresh annotation.' });

    const after = bodyRegion(await readFile(path, 'utf8'));
    expect(after).toBe(before);
    expect(after).toContain(NBSP);
    expect(after).toContain('&amp;');
    expect(after).toContain('<empty-line/>');
    expect(after).toContain('with   runs   of   spaces');
  });

  it('preserves crlf line endings in the body', async () => {
    const path = await makeFile(fb2Content({ newline: '\r\n' }));
    const before = await readFile(path, 'utf8');

    await write(path, { title: 'New Title' });

    const after = await readFile(path, 'utf8');
    expect(bodyRegion(after)).toBe(bodyRegion(before));
    expect(bodyRegion(after)).toContain('\r\n');
    const rebuiltDescription = after.slice(after.indexOf('<description>'), after.indexOf('</description>'));
    expect(rebuiltDescription).toContain('\r\n');
    expect(rebuiltDescription.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('preserves a utf-8 BOM', async () => {
    const path = join(testRoot, 'bom.fb2');
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fb2Content(), 'utf8')]));

    const result = await write(path, { title: 'New Title' });
    expect(result.status).toBe('success');

    const updated = await readFile(path);
    expect(updated.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(updated.toString('utf8')).toContain('<book-title>New Title</book-title>');
  });

  it('keeps multibyte characters intact when computing byte offsets', async () => {
    const body = `<body><section><p>Мастер и Маргарита ${'ü'.repeat(50)}</p></section></body>`;
    const path = await makeFile(fb2Content({ body }));
    const before = bodyRegion(await readFile(path, 'utf8'));

    await write(path, { title: 'Новое название' });

    const after = await readFile(path, 'utf8');
    expect(bodyRegion(after)).toBe(before);
    expect(after).toContain('<book-title>Новое название</book-title>');
    expectWellFormed(after);
  });

  it('produces a well-formed document', async () => {
    const path = await makeFile(fb2Content());
    await write(path, {
      title: 'Title & "Quotes" <Bracket>',
      authors: [{ name: 'A B', sortName: 'B, A' }],
      description: 'One.\n\nTwo.',
      genres: ['Fantasy & Epic'],
      tags: ['a', 'b'],
      seriesName: 'S & S',
      seriesIndex: 2,
      publisher: 'P & P',
      isbn13: '9780000000001',
      publishedDate: '2001-02-03',
      rating: 4,
    });
    expectWellFormed(await readFile(path, 'utf8'));
  });

  it('leaves no temporary files behind', async () => {
    const path = await makeFile(fb2Content());
    await write(path, { title: 'New Title' });
    expect(await readdir(testRoot)).toEqual(['book.fb2']);
  });
});

describe('writeFb2Metadata idempotency', () => {
  it('writing the same payload twice produces identical bytes', async () => {
    const payload: BookWritePayload = {
      title: 'Stable Title',
      authors: [{ name: 'Cat Bruno', sortName: 'Bruno, Cat' }],
      genres: ['Fantasy'],
      language: 'en',
      seriesName: 'Series',
      seriesIndex: 2,
      publishedDate: '2018-03-14',
      publisher: 'Pub',
      rating: 5,
    };
    const path = await makeFile(fb2Content());

    await write(path, payload);
    const first = await readFile(path);
    await write(path, payload);
    const second = await readFile(path);

    expect(second.equals(first)).toBe(true);
  });

  it('writing the same cover twice produces identical bytes', async () => {
    const path = await makeFile(
      fb2Content({
        titleInfo: `${DEFAULT_TITLE_INFO}\n    <coverpage><image l:href="#cover.jpg"/></coverpage>`,
        binaries: '<binary id="cover.jpg" content-type="image/jpeg">QUJD</binary>',
      }),
    );

    await write(path, { title: 'T', coverBytes: jpegCover });
    const first = await readFile(path);
    await write(path, { title: 'T', coverBytes: jpegCover });

    expect((await readFile(path)).equals(first)).toBe(true);
  });
});

describe('writeFb2Metadata cover handling', () => {
  it('replaces the referenced cover binary and leaves the others alone', async () => {
    const binaries = [
      '<binary id="img_1" content-type="image/jpeg">SU1HMQ==</binary>',
      '<binary id="cover.jpg" content-type="image/jpeg">T0xEQ09WRVI=</binary>',
      '<binary id="img_2" content-type="image/png">SU1HMg==</binary>',
    ].join('\n');
    const path = await makeFile(
      fb2Content({ titleInfo: `${DEFAULT_TITLE_INFO}\n    <coverpage><image l:href="#cover.jpg"/></coverpage>`, binaries }),
    );

    const result = await write(path, { coverBytes: jpegCover });
    expect(result.status).toBe('success');
    expect(result.fieldsWritten).toContain('coverBytes');

    const updated = await readFile(path, 'utf8');
    const map = binaryMap(updated);
    expect(map.size).toBe(3);
    expect(map.get('img_1')).toBe('SU1HMQ==');
    expect(map.get('img_2')).toBe('SU1HMg==');
    expect(Buffer.from(map.get('cover.jpg')!.replace(/\s+/g, ''), 'base64').equals(jpegCover)).toBe(true);
    expectWellFormed(updated);
  });

  it('injects a coverpage and binary when the document has neither', async () => {
    const path = await makeFile(fb2Content({ binaries: '<binary id="img_1" content-type="image/jpeg">SU1HMQ==</binary>' }));

    const result = await write(path, { coverBytes: jpegCover });
    expect(result.status).toBe('success');

    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('<coverpage><image l:href="#bookorbit-cover.jpg"/></coverpage>');
    const map = binaryMap(updated);
    expect(map.size).toBe(2);
    expect(Buffer.from(map.get('bookorbit-cover.jpg')!.replace(/\s+/g, ''), 'base64').equals(jpegCover)).toBe(true);
    expect(updated.indexOf('bookorbit-cover.jpg', updated.indexOf('</body>'))).toBeLessThan(updated.lastIndexOf('</FictionBook>'));
    expectWellFormed(updated);
  });

  it('injects the missing binary when a coverpage points at nothing', async () => {
    const path = await makeFile(fb2Content({ titleInfo: `${DEFAULT_TITLE_INFO}\n    <coverpage><image l:href="#missing.jpg"/></coverpage>` }));

    await write(path, { coverBytes: jpegCover });

    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('<coverpage><image l:href="#missing.jpg"/></coverpage>');
    expect(Buffer.from(binaryMap(updated).get('missing.jpg')!.replace(/\s+/g, ''), 'base64').equals(jpegCover)).toBe(true);
    expectWellFormed(updated);
  });

  it('uses the document xlink prefix when injecting a coverpage', async () => {
    const path = await makeFile(
      fb2Content({ rootAttributes: 'xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:xlink="http://www.w3.org/1999/xlink"' }),
    );

    await write(path, { coverBytes: jpegCover });

    expect(await readFile(path, 'utf8')).toContain('<image xlink:href="#bookorbit-cover.jpg"/>');
  });

  it('records the cover media type from the image bytes', async () => {
    const path = await makeFile(fb2Content());

    await write(path, { coverBytes: pngCover });

    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('<binary id="bookorbit-cover.png" content-type="image/png">');
  });

  it('does not touch the cover when coverBytes is masked out', async () => {
    const binaries = '<binary id="cover.jpg" content-type="image/jpeg">T0xEQ09WRVI=</binary>';
    const path = await makeFile(
      fb2Content({ titleInfo: `${DEFAULT_TITLE_INFO}\n    <coverpage><image l:href="#cover.jpg"/></coverpage>`, binaries }),
    );

    const result = await write(path, { title: 'T', coverBytes: jpegCover }, new Set<BookWritePayloadKey>(['title']));

    expect(result.fieldsWritten).toEqual(['title']);
    expect(binaryMap(await readFile(path, 'utf8')).get('cover.jpg')).toBe('T0xEQ09WRVI=');
  });

  it('replaces a cover that sits behind a large body without disturbing it', async () => {
    const body = `<body><section><p>${'filler '.repeat(60_000)}</p></section></body>`;
    const binaries = `<binary id="cover.jpg" content-type="image/jpeg">${'QUJD'.repeat(20_000)}</binary>`;
    const path = await makeFile(
      fb2Content({ body, titleInfo: `${DEFAULT_TITLE_INFO}\n    <coverpage><image l:href="#cover.jpg"/></coverpage>`, binaries }),
    );
    const before = bodyRegion(await readFile(path, 'utf8'));

    const result = await write(path, { title: 'Big Book', coverBytes: jpegCover });
    expect(result.status).toBe('success');

    const updated = await readFile(path, 'utf8');
    expect(bodyRegion(updated)).toBe(before);
    expect(Buffer.from(binaryMap(updated).get('cover.jpg')!.replace(/\s+/g, ''), 'base64').equals(jpegCover)).toBe(true);
  });
});

describe('writeFb2Metadata encodings', () => {
  it('writes a windows-1251 file without changing its encoding or body bytes', async () => {
    const content = fb2Content({
      declaration: '<?xml version="1.0" encoding="windows-1251"?>',
      titleInfo: '    <genre>prose_classic</genre>\n    <book-title>Мастер</book-title>\n    <lang>ru</lang>',
      body: '<body><section><p>В белом плаще с кровавым подбоем.</p></section></body>',
    });
    const path = await makeFile(content, 'win1251');
    const originalBytes = await readFile(path);

    const result = await write(path, { title: 'Мастер и Маргарита', seriesName: 'Русская классика', seriesIndex: 1 });
    expect(result.status).toBe('success');

    const updatedBytes = await readFile(path);
    const decoded = iconv.decode(updatedBytes, 'win1251');
    expect(decoded).toContain('encoding="windows-1251"');
    expect(decoded).toContain('<book-title>Мастер и Маргарита</book-title>');
    expect(decoded).toContain('<sequence name="Русская классика" number="1"/>');
    expect(decoded).toContain('В белом плаще с кровавым подбоем.');

    // Single-byte encoding, so a latin1 view gives byte-accurate offsets.
    const tailAfterDescription = (buffer: Buffer): Buffer =>
      buffer.subarray(buffer.toString('latin1').indexOf('</description>') + '</description>'.length);
    expect(tailAfterDescription(updatedBytes).equals(tailAfterDescription(originalBytes))).toBe(true);
    expect(iconv.encode(decoded, 'win1251').equals(updatedBytes)).toBe(true);
  });

  it('writes a koi8-r file in its declared encoding', async () => {
    const content = fb2Content({
      declaration: '<?xml version="1.0" encoding="koi8-r"?>',
      titleInfo: '    <genre>sf</genre>\n    <book-title>Старое</book-title>',
      body: '<body><section><p>Текст</p></section></body>',
    });
    const path = await makeFile(content, 'koi8-r');

    const result = await write(path, { title: 'Новое' });
    expect(result.status).toBe('success');

    const decoded = iconv.decode(await readFile(path), 'koi8-r');
    expect(decoded).toContain('<book-title>Новое</book-title>');
    expect(decoded).toContain('Текст');
  });

  it('skips utf-16 files instead of corrupting them', async () => {
    const path = join(testRoot, 'utf16.fb2');
    const content = fb2Content({ declaration: '<?xml version="1.0" encoding="utf-16"?>' });
    await writeFile(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]));
    const before = await readFile(path);

    const result = await write(path, { title: 'New Title' });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(result.status === 'skipped' && result.reason).toMatch(/unsupported encoding/);
    expect((await readFile(path)).equals(before)).toBe(true);
  });

  it('skips a file whose declared encoding is unknown', async () => {
    const path = await makeFile(fb2Content({ declaration: '<?xml version="1.0" encoding="made-up-codec-9000"?>' }));
    const before = await readFile(path);

    const result = await write(path, { title: 'New Title' });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(result.status === 'skipped' && result.reason).toContain('made-up-codec-9000');
    expect((await readFile(path)).equals(before)).toBe(true);
  });
});

describe('writeFb2Metadata refusals', () => {
  it('reports dry-run without touching the file', async () => {
    const path = await makeFile(fb2Content());
    const before = await readFile(path);

    const result = await write(path, { title: 'New Title', coverBytes: jpegCover }, FULL_MASK, true);

    expect(result).toMatchObject({ status: 'skipped', reason: 'dry-run' });
    expect(result.fieldsWritten).toEqual(expect.arrayContaining(['title', 'coverBytes']));
    expect((await readFile(path)).equals(before)).toBe(true);
  });

  it('skips when the payload has nothing FB2 can write', async () => {
    const path = await makeFile(fb2Content());
    const before = await readFile(path);

    const result = await write(path, { comicIssueNumber: '3' });

    expect(result).toMatchObject({ status: 'skipped', reason: 'no metadata to write' });
    expect((await readFile(path)).equals(before)).toBe(true);
  });

  it('skips a file with no description block', async () => {
    const path = await makeFile('<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook><body><section><p>x</p></section></body></FictionBook>');
    const before = await readFile(path);

    const result = await write(path, { title: 'New Title' });

    expect(result).toMatchObject({ status: 'skipped', reason: 'no description block found' });
    expect((await readFile(path)).equals(before)).toBe(true);
  });

  it('skips a file whose body precedes the description', async () => {
    const path = await makeFile(
      '<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook><body><section><p>x</p></section></body><description><title-info><book-title>T</book-title></title-info></description></FictionBook>',
    );
    const before = await readFile(path);

    const result = await write(path, { title: 'New Title' });

    expect(result).toMatchObject({ status: 'skipped', reason: 'body precedes description' });
    expect((await readFile(path)).equals(before)).toBe(true);
  });

  it('skips a description without title-info', async () => {
    const path = await makeFile(
      '<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook><description><document-info><id>1</id></document-info></description><body><section><p>x</p></section></body></FictionBook>',
    );

    const result = await write(path, { title: 'New Title' });

    expect(result).toMatchObject({ status: 'skipped', reason: 'description has no title-info' });
  });

  it('skips a truncated file instead of writing a broken one', async () => {
    const path = await makeFile('<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook><description><title-info><book-title>T');
    const before = await readFile(path);

    const result = await write(path, { title: 'New Title' });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(result.status === 'skipped' && result.reason).toMatch(/unclosed/);
    expect((await readFile(path)).equals(before)).toBe(true);
  });

  it('is not fooled by an escaped description tag inside the body', async () => {
    const body = '<body><section><p>The &lt;description&gt; element holds metadata.</p></section></body>';
    const path = await makeFile(fb2Content({ body }));

    const result = await write(path, { title: 'New Title' });

    expect(result.status).toBe('success');
    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('The &lt;description&gt; element holds metadata.');
    expectWellFormed(updated);
  });
});

describe('writeFb2Metadata large metadata blocks', () => {
  it('writes a description larger than the initial read window', async () => {
    const hugeAnnotation = `<annotation><p>${'x'.repeat(400 * 1024)}</p></annotation>`;
    const path = await makeFile(fb2Content({ titleInfo: `${DEFAULT_TITLE_INFO}\n    ${hugeAnnotation}` }));
    const before = bodyRegion(await readFile(path, 'utf8'));

    const result = await write(path, { title: 'New Title' });

    expect(result.status).toBe('success');
    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('<book-title>New Title</book-title>');
    expect(updated).toContain('x'.repeat(400 * 1024));
    expect(bodyRegion(updated)).toBe(before);
  });

  it('writes metadata into a multi-megabyte file without altering the body', async () => {
    const body = `<body><section>${'<p>Chapter text goes here.</p>'.repeat(120_000)}</section></body>`;
    const path = await makeFile(fb2Content({ body }));
    const before = bodyRegion(await readFile(path, 'utf8'));
    expect(Buffer.byteLength(before)).toBeGreaterThan(3 * 1024 * 1024);

    const result = await write(path, { title: 'New Title', authors: [{ name: 'A B', sortName: 'B, A' }] });

    expect(result.status).toBe('success');
    const updated = await readFile(path, 'utf8');
    expect(bodyRegion(updated)).toBe(before);
    expect(updated).toContain('<book-title>New Title</book-title>');
  });
});
