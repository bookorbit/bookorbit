import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import iconv from 'iconv-lite';
import sharp from 'sharp';

import { FB2_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import { Fb2FormatExtractor } from '../../../metadata/extractors/fb2-format.extractor';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { Fb2FormatWriter } from './fb2-format-writer';

const FULL_MASK = new Set<BookWritePayloadKey>(FB2_BOOK_FILE_WRITE_FIELDS);

const SOURCE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">',
  '<description>',
  '  <title-info>',
  '    <genre>antique</genre>',
  '    <author><first-name>Old</first-name><last-name>Author</last-name></author>',
  '    <book-title>Old Title</book-title>',
  '    <lang>en</lang>',
  '  </title-info>',
  '  <document-info><id>doc-1</id></document-info>',
  '  <publish-info><year>1901</year></publish-info>',
  '</description>',
  '<body><section><p>Chapter one.</p></section></body>',
  '</FictionBook>',
  '',
].join('\n');

let testRoot: string;
let writer: Fb2FormatWriter;
let extractor: Fb2FormatExtractor;
let cover: Buffer;

beforeAll(async () => {
  cover = await sharp({ create: { width: 10, height: 15, channels: 3, background: { r: 5, g: 100, b: 200 } } })
    .jpeg()
    .toBuffer();
});

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-fb2-roundtrip-'));
  writer = new Fb2FormatWriter();
  extractor = new Fb2FormatExtractor();
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function writeAndRead(payload: BookWritePayload, content = SOURCE, encoding?: string) {
  const path = join(testRoot, 'book.fb2');
  await writeFile(path, encoding ? iconv.encode(content, encoding) : Buffer.from(content, 'utf8'));

  const result = await writer.write(path, payload, { fieldMask: FULL_MASK, dryRun: false });
  expect(result.status).toBe('success');

  const parsed = await extractor.extract(path);
  if (!parsed) throw new Error('extractor returned null for a file it just wrote');
  return { parsed, result, path };
}

describe('FB2 write then extract round-trip', () => {
  it('round-trips every field FB2 advertises as writable', async () => {
    const payload: BookWritePayload = {
      title: 'Nemesis & the "Sword" <Special Edition>',
      subtitle: 'A Tale of Ünïcode',
      description: 'First paragraph.\n\nSecond paragraph.',
      publisher: 'Painted Quill Press & Sons',
      publishedDate: '2018-03-14',
      publishedYear: 2018,
      language: 'ru',
      pageCount: 412,
      seriesName: 'Pathway of the Chosen',
      seriesIndex: 2,
      isbn13: '9781729419007',
      isbn10: '1729419001',
      rating: 4.5,
      authors: [
        { name: 'Cat Bruno', sortName: 'Bruno, Cat' },
        { name: 'James David Victor', sortName: 'Victor, James David' },
        { name: 'Prince', sortName: null },
      ],
      genres: ['Fantasy', 'Epic & Heroic'],
      tags: ['favourite', 'to-reread'],
      goodreadsId: '12345',
      amazonId: 'B07XYZ',
      hardcoverId: 'hc-9',
      googleBooksId: 'gb-1',
      openLibraryId: 'OL1W',
      koboId: 'kobo-1',
      itunesId: 'it-1',
      coverBytes: cover,
    };

    const { parsed } = await writeAndRead(payload);

    expect(parsed.title).toBe(payload.title);
    expect(parsed.subtitle).toBe(payload.subtitle);
    expect(parsed.description).toContain('First paragraph.');
    expect(parsed.description).toContain('Second paragraph.');
    expect(parsed.publisher).toBe(payload.publisher);
    expect(parsed.publishedDate).toBe('2018-03-14');
    expect(parsed.publishedYear).toBe(2018);
    expect(parsed.language).toBe('ru');
    expect(parsed.pageCount).toBe(412);
    expect(parsed.seriesName).toBe('Pathway of the Chosen');
    expect(parsed.seriesIndex).toBe(2);
    expect(parsed.isbn13).toBe('9781729419007');
    expect(parsed.isbn10).toBe('1729419001');
    expect(parsed.rating).toBe(4.5);
    expect(parsed.authors.map((author) => author.name)).toEqual(['Cat Bruno', 'James David Victor', 'Prince']);
    expect(parsed.genres).toEqual(['Fantasy', 'Epic & Heroic']);
    expect(parsed.tags).toEqual(['favourite', 'to-reread']);
    expect(parsed.goodreadsId).toBe('12345');
    expect(parsed.amazonId).toBe('B07XYZ');
    expect(parsed.hardcoverId).toBe('hc-9');
    expect(parsed.googleBooksId).toBe('gb-1');
    expect(parsed.openLibraryId).toBe('OL1W');
    expect(parsed.koboId).toBe('kobo-1');
    expect(parsed.itunesId).toBe('it-1');
    expect(parsed.cover?.equals(cover)).toBe(true);
  });

  it('round-trips a fractional series index', async () => {
    const { parsed } = await writeAndRead({ seriesName: 'Series', seriesIndex: 2.5 });
    expect(parsed.seriesIndex).toBe(2.5);
  });

  it('round-trips cyrillic metadata in a windows-1251 file', async () => {
    const source = SOURCE.replace('encoding="UTF-8"', 'encoding="windows-1251"').replace('<p>Chapter one.</p>', '<p>В белом плаще.</p>');
    const { parsed, path } = await writeAndRead(
      { title: 'Мастер и Маргарита', authors: [{ name: 'Михаил Булгаков', sortName: 'Булгаков, Михаил' }], seriesName: 'Классика' },
      source,
      'win1251',
    );

    expect(parsed.title).toBe('Мастер и Маргарита');
    expect(parsed.authors[0]?.name).toBe('Михаил Булгаков');
    expect(parsed.seriesName).toBe('Классика');
    expect(iconv.decode(await readFile(path), 'win1251')).toContain('В белом плаще.');
  });

  it('round-trips a cover injected into a file that had none', async () => {
    const { parsed } = await writeAndRead({ coverBytes: cover });
    expect(parsed.cover?.equals(cover)).toBe(true);
  });

  it('leaves untouched fields readable after a partial write', async () => {
    const path = join(testRoot, 'book.fb2');
    await writeFile(path, SOURCE, 'utf8');

    await writer.write(path, { title: 'Only Title Changed' }, { fieldMask: new Set<BookWritePayloadKey>(['title']), dryRun: false });

    const parsed = await extractor.extract(path);
    expect(parsed?.title).toBe('Only Title Changed');
    expect(parsed?.language).toBe('en');
    expect(parsed?.publishedYear).toBe(1901);
    expect(parsed?.authors.map((author) => author.name)).toEqual(['Old Author']);
    expect(parsed?.genres).toEqual(['antique']);
  });

  it('re-extracts identical metadata after a second identical write, so scans do not churn', async () => {
    const payload: BookWritePayload = {
      title: 'Stable',
      authors: [{ name: 'A B', sortName: 'B, A' }],
      genres: ['Fantasy'],
      tags: ['x'],
      language: 'en',
      publishedDate: '2010-05-06',
      publisher: 'Pub',
      seriesName: 'S',
      seriesIndex: 1,
      rating: 3,
      coverBytes: cover,
    };
    const { parsed: first, path } = await writeAndRead(payload);
    const bytesAfterFirst = await readFile(path);

    await writer.write(path, payload, { fieldMask: FULL_MASK, dryRun: false });
    const second = await extractor.extract(path);

    expect((await readFile(path)).equals(bytesAfterFirst)).toBe(true);
    expect(second).toEqual(first);
  });
});
