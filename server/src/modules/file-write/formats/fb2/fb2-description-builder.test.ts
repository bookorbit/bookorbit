import { FB2_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';

import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { buildFb2Description, readCoverEntryId } from './fb2-description-builder';
import { locateElement, scanChildElements } from './fb2-element-scanner';

const FULL_MASK = new Set<BookWritePayloadKey>(FB2_BOOK_FILE_WRITE_FIELDS);

function description(titleInfo: string, extra = ''): string {
  return `<description>\n  <title-info>\n${titleInfo}\n  </title-info>\n${extra}</description>`;
}

const MINIMAL = description('    <genre>sf</genre>\n    <book-title>Old Title</book-title>\n    <lang>en</lang>');

function build(
  xml: string,
  payload: BookWritePayload,
  mask: Set<BookWritePayloadKey> = FULL_MASK,
  options: { xlinkPrefix?: string; coverEntryId?: string | null } = {},
) {
  const result = buildFb2Description(xml, payload, mask, { xlinkPrefix: options.xlinkPrefix ?? 'l', coverEntryId: options.coverEntryId ?? null });
  if (result.status !== 'built') throw new Error(`expected a built description, got skipped: ${result.reason}`);
  return result;
}

function maskOf(...fields: BookWritePayloadKey[]): Set<BookWritePayloadKey> {
  return new Set(fields);
}

function childOrder(xml: string, parent: string): string[] {
  const element = locateElement(xml, parent);
  if (!element || element.selfClosing) throw new Error(`missing <${parent}>`);
  return scanChildElements(xml, element.contentStart, element.contentEnd).map((child) => child.name);
}

describe('buildFb2Description field mapping', () => {
  it('writes the title into book-title', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { title: 'New Title' });
    expect(descriptionXml).toContain('<book-title>New Title</book-title>');
    expect(descriptionXml).not.toContain('Old Title');
    expect(fieldsWritten).toEqual(['title']);
  });

  it('writes the language into lang', () => {
    expect(build(MINIMAL, { language: 'ru' }).descriptionXml).toContain('<lang>ru</lang>');
  });

  it('writes genres as one genre element each, replacing the originals', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { genres: ['Fantasy', 'Epic'] });
    expect(descriptionXml).toContain('<genre>Fantasy</genre>');
    expect(descriptionXml).toContain('<genre>Epic</genre>');
    expect(descriptionXml).not.toContain('<genre>sf</genre>');
    expect(fieldsWritten).toEqual(['genres']);
  });

  it('writes tags into keywords as a comma separated list', () => {
    expect(build(MINIMAL, { tags: ['favourite', 'to-reread'] }).descriptionXml).toContain('<keywords>favourite, to-reread</keywords>');
  });

  it('writes the description into an annotation with one paragraph per blank line', () => {
    const { descriptionXml } = build(MINIMAL, { description: 'First para.\n\nSecond para.' });
    expect(descriptionXml).toContain('<annotation><p>First para.</p><p>Second para.</p></annotation>');
  });

  it('collapses newlines inside a paragraph', () => {
    const { descriptionXml } = build(MINIMAL, { description: 'One\nline\nwrapped' });
    expect(descriptionXml).toContain('<annotation><p>One line wrapped</p></annotation>');
  });

  it('writes an iso published date to title-info date with a value attribute', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { publishedDate: '2018-03-14' });
    expect(descriptionXml).toContain('<date value="2018-03-14">2018-03-14</date>');
    expect(descriptionXml).toContain('<year>2018</year>');
    expect(fieldsWritten).toEqual(['publishedDate']);
  });

  it('writes a bare year when only publishedYear is known', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { publishedYear: 1999 });
    expect(descriptionXml).toContain('<date>1999</date>');
    expect(descriptionXml).toContain('<year>1999</year>');
    expect(fieldsWritten).toEqual(['publishedYear']);
  });

  it('ignores a non-iso published date for the date element but still writes the year', () => {
    const { descriptionXml } = build(MINIMAL, { publishedDate: '2018' });
    expect(descriptionXml).not.toContain('<date value=');
    expect(descriptionXml).toContain('<year>2018</year>');
  });

  it('writes publisher and isbn13 into publish-info', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { publisher: 'Pub & Co', isbn13: '9780000000001' });
    expect(descriptionXml).toContain('<publisher>Pub &amp; Co</publisher>');
    expect(descriptionXml).toContain('<isbn>9780000000001</isbn>');
    expect(fieldsWritten).toEqual(expect.arrayContaining(['publisher', 'isbn13']));
  });

  it('creates publish-info when the source document has none', () => {
    expect(MINIMAL).not.toContain('publish-info');
    const { descriptionXml } = build(MINIMAL, { publisher: 'New Publisher' });
    expect(descriptionXml).toContain('<publish-info>');
    expect(descriptionXml).toContain('</publish-info>');
  });

  it('writes series name and index into a sequence element', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { seriesName: 'My "Series"', seriesIndex: 3 });
    expect(descriptionXml).toContain('<sequence name="My &quot;Series&quot;" number="3"/>');
    expect(fieldsWritten).toEqual(expect.arrayContaining(['seriesName', 'seriesIndex']));
  });

  it('keeps a fractional series index, which real readers accept', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { seriesName: 'S', seriesIndex: 1.5 });
    expect(descriptionXml).toContain('number="1.5"');
    expect(fieldsWritten).toContain('seriesIndex');
  });

  it('writes the sequence without a number when no index is known', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { seriesName: 'S', seriesIndex: null });
    expect(descriptionXml).toContain('<sequence name="S"/>');
    expect(fieldsWritten).not.toContain('seriesIndex');
  });

  it('writes fields without an FB2 slot into namespaced custom-info', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, {
      subtitle: 'A Subtitle',
      pageCount: 412,
      rating: 4.5,
      isbn10: '1729419001',
      goodreadsId: '12345',
    });
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:subtitle">A Subtitle</custom-info>');
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:pageCount">412</custom-info>');
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:rating">4.5</custom-info>');
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:isbn10">1729419001</custom-info>');
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:goodreadsId">12345</custom-info>');
    expect(fieldsWritten).toEqual(expect.arrayContaining(['subtitle', 'pageCount', 'rating', 'isbn10', 'goodreadsId']));
  });

  it('writes custom metadata entries under a custom prefix', () => {
    const { descriptionXml } = build(MINIMAL, {
      customMetadata: [{ fieldId: 1, key: 'shelf', label: 'Shelf', type: 'text', displayOrder: 0, value: 'Attic' }],
    });
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:custom:shelf">Attic</custom-info>');
  });

  it('skips custom metadata entries with no value', () => {
    const { descriptionXml } = build(MINIMAL, {
      customMetadata: [{ fieldId: 1, key: 'shelf', label: 'Shelf', type: 'text', displayOrder: 0, value: null }],
    });
    expect(descriptionXml).not.toContain('bookorbit:custom:shelf');
  });
});

describe('buildFb2Description authors', () => {
  it('splits a sort name into first, middle and last names', () => {
    const { descriptionXml } = build(MINIMAL, { authors: [{ name: 'James David Victor', sortName: 'Victor, James David' }] });
    expect(descriptionXml).toContain('<author><first-name>James</first-name><middle-name>David</middle-name><last-name>Victor</last-name></author>');
  });

  it('falls back to the display name when there is no sort name', () => {
    const { descriptionXml } = build(MINIMAL, { authors: [{ name: 'Cat Bruno', sortName: null }] });
    expect(descriptionXml).toContain('<author><first-name>Cat</first-name><last-name>Bruno</last-name></author>');
  });

  it('writes a single-word author as a nickname, which FB2 allows', () => {
    const { descriptionXml } = build(MINIMAL, { authors: [{ name: 'Prince', sortName: null }] });
    expect(descriptionXml).toContain('<author><nickname>Prince</nickname></author>');
  });

  it('writes every author in payload order', () => {
    const { descriptionXml } = build(MINIMAL, {
      authors: [
        { name: 'Chuck DeVore', sortName: 'DeVore, Chuck' },
        { name: 'Steven Mosher', sortName: 'Mosher, Steven' },
      ],
    });
    expect(descriptionXml.indexOf('DeVore')).toBeLessThan(descriptionXml.indexOf('Mosher'));
    expect(descriptionXml.match(/<author>/g)).toHaveLength(2);
  });

  it('drops blank authors instead of emitting an empty author element', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, {
      authors: [
        { name: '   ', sortName: null },
        { name: 'Real Person', sortName: null },
      ],
    });
    expect(descriptionXml).not.toContain('<author></author>');
    expect(descriptionXml.match(/<author>/g)).toHaveLength(1);
    expect(fieldsWritten).toContain('authors');
  });

  it('reports nothing written when every author is blank', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { authors: [{ name: '', sortName: null }] });
    expect(fieldsWritten).not.toContain('authors');
    expect(descriptionXml).not.toContain('<author>');
  });

  it('ignores a sort name with an empty surname', () => {
    const { descriptionXml } = build(MINIMAL, { authors: [{ name: 'Ada Lovelace', sortName: ', Ada' }] });
    expect(descriptionXml).toContain('<author><first-name>Ada</first-name><last-name>Lovelace</last-name></author>');
  });
});

describe('buildFb2Description escaping', () => {
  it('escapes xml significant characters in text', () => {
    const { descriptionXml } = build(MINIMAL, { title: 'A & B < C > D' });
    expect(descriptionXml).toContain('<book-title>A &amp; B &lt; C &gt; D</book-title>');
  });

  it('escapes quotes in attribute values', () => {
    const { descriptionXml } = build(MINIMAL, { seriesName: 'He said "hi" & left' });
    expect(descriptionXml).toContain('name="He said &quot;hi&quot; &amp; left"');
  });

  it('keeps non-ascii characters as-is for the encoder to handle', () => {
    const { descriptionXml } = build(MINIMAL, { title: 'Мастер и Маргарита' });
    expect(descriptionXml).toContain('<book-title>Мастер и Маргарита</book-title>');
  });
});

describe('buildFb2Description structure', () => {
  it('emits title-info children in schema order even when the source is out of order', () => {
    const outOfOrder = description('    <book-title>T</book-title>\n    <lang>en</lang>\n    <genre>antique</genre>');
    const { descriptionXml } = build(outOfOrder, {
      title: 'T2',
      authors: [{ name: 'A B', sortName: 'B, A' }],
      description: 'Note.',
      tags: ['x'],
      publishedDate: '2001-02-03',
      seriesName: 'S',
      seriesIndex: 1,
    });
    expect(childOrder(descriptionXml, 'title-info')).toEqual(['genre', 'author', 'book-title', 'annotation', 'keywords', 'date', 'lang', 'sequence']);
  });

  it('emits description children in schema order', () => {
    const xml = description(
      '    <genre>sf</genre>\n    <book-title>T</book-title>',
      '  <custom-info info-type="calibre">x</custom-info>\n  <publish-info><year>2001</year></publish-info>\n  <document-info><id>abc</id></document-info>\n',
    );
    const { descriptionXml } = build(xml, { title: 'T2' });
    expect(childOrder(descriptionXml, 'description')).toEqual(['title-info', 'document-info', 'publish-info', 'custom-info']);
  });

  it('preserves document-info byte for byte', () => {
    const documentInfo =
      '  <document-info><id>abc-123</id><version>1.0</version><program-used><![CDATA[FBE <2.6>]]></program-used></document-info>\n';
    const xml = description('    <genre>sf</genre>\n    <book-title>T</book-title>', documentInfo);
    const { descriptionXml } = build(xml, { title: 'T2' });
    expect(descriptionXml).toContain(documentInfo.trim());
  });

  it('preserves src-title-info and unknown description children', () => {
    const xml = description(
      '    <genre>sf</genre>\n    <book-title>T</book-title>',
      '  <src-title-info><book-title>Original</book-title></src-title-info>\n  <output mode="free"/>\n',
    );
    const { descriptionXml } = build(xml, { title: 'T2' });
    expect(descriptionXml).toContain('<src-title-info><book-title>Original</book-title></src-title-info>');
    expect(descriptionXml).toContain('<output mode="free"/>');
  });

  it('preserves foreign custom-info but replaces our own', () => {
    const xml = description(
      '    <genre>sf</genre>\n    <book-title>T</book-title>',
      '  <custom-info info-type="calibre-uuid">keep-me</custom-info>\n  <custom-info info-type="bookorbit:rating">1</custom-info>\n',
    );
    const { descriptionXml } = build(xml, { rating: 5 });
    expect(descriptionXml).toContain('<custom-info info-type="calibre-uuid">keep-me</custom-info>');
    expect(descriptionXml).toContain('<custom-info info-type="bookorbit:rating">5</custom-info>');
    expect(descriptionXml).not.toContain('>1</custom-info>');
  });

  it('preserves publish-info elements it does not manage', () => {
    const xml = description(
      '    <genre>sf</genre>\n    <book-title>T</book-title>',
      '  <publish-info><book-name>Publisher Title</book-name><city>New York</city><year>1975</year></publish-info>\n',
    );
    const { descriptionXml } = build(xml, { publisher: 'New Pub' });
    expect(descriptionXml).toContain('<book-name>Publisher Title</book-name>');
    expect(descriptionXml).toContain('<city>New York</city>');
    expect(descriptionXml).toContain('<year>1975</year>');
    expect(descriptionXml).toContain('<publisher>New Pub</publisher>');
  });

  it('preserves attributes on the description and title-info start tags', () => {
    const xml = '<description xml:lang="ru">\n  <title-info xml:lang="ru">\n    <genre>sf</genre>\n  </title-info>\n</description>';
    const { descriptionXml } = build(xml, { title: 'T' });
    expect(descriptionXml.startsWith('<description xml:lang="ru">')).toBe(true);
    expect(descriptionXml).toContain('<title-info xml:lang="ru">');
  });

  it('preserves the crlf line style of the source block', () => {
    const xml = MINIMAL.replace(/\n/g, '\r\n');
    const { descriptionXml } = build(xml, { title: 'T' });
    expect(descriptionXml).toContain('\r\n');
    expect(descriptionXml.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('keeps the indentation style of the source block', () => {
    const xml = '<description>\n\t<title-info>\n\t\t<genre>sf</genre>\n\t</title-info>\n</description>';
    const { descriptionXml } = build(xml, { title: 'T' });
    expect(descriptionXml).toContain('\n\t<title-info>');
    expect(descriptionXml).toContain('\n\t\t<book-title>T</book-title>');
  });

  it('falls back to two-space indentation when the block is on one line', () => {
    const xml = '<description><title-info><genre>sf</genre><book-title>T</book-title></title-info></description>';
    const { descriptionXml } = build(xml, { title: 'T2' });
    expect(descriptionXml).toContain('\n  <title-info>');
    expect(descriptionXml).toContain('\n    <book-title>T2</book-title>');
    expect(descriptionXml).not.toContain('<description><title-info>');
  });

  it('is idempotent: rebuilding its own output changes nothing', () => {
    const payload: BookWritePayload = {
      title: 'Stable',
      authors: [{ name: 'A B', sortName: 'B, A' }],
      genres: ['Fantasy'],
      tags: ['x'],
      language: 'en',
      publishedDate: '2020-01-02',
      publisher: 'Pub',
      isbn13: '9780000000001',
      seriesName: 'S',
      seriesIndex: 2,
      rating: 4,
      description: 'Note.',
    };
    const first = build(MINIMAL, payload).descriptionXml;
    const second = build(first, payload).descriptionXml;
    expect(second).toBe(first);
  });
});

describe('buildFb2Description masking', () => {
  it('writes only fields present in the mask', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { title: 'New', language: 'de' }, maskOf('title'));
    expect(descriptionXml).toContain('<book-title>New</book-title>');
    expect(descriptionXml).toContain('<lang>en</lang>');
    expect(fieldsWritten).toEqual(['title']);
  });

  it('ignores fields FB2 cannot represent even when masked in', () => {
    const { fieldsWritten } = build(
      MINIMAL,
      { comicIssueNumber: '3', narrators: ['Reader'] },
      new Set(['comicIssueNumber', 'narrators'] as BookWritePayloadKey[]),
    );
    expect(fieldsWritten).toEqual([]);
  });

  it('leaves existing values untouched for null payload fields', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { title: null, language: undefined });
    expect(descriptionXml).toContain('<book-title>Old Title</book-title>');
    expect(descriptionXml).toContain('<lang>en</lang>');
    expect(fieldsWritten).toEqual([]);
  });

  it('treats blank strings as no value', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { title: '   ' });
    expect(descriptionXml).toContain('<book-title>Old Title</book-title>');
    expect(fieldsWritten).toEqual([]);
  });

  it('treats empty arrays as no value', () => {
    const { descriptionXml, fieldsWritten } = build(MINIMAL, { genres: [], tags: [] });
    expect(descriptionXml).toContain('<genre>sf</genre>');
    expect(fieldsWritten).toEqual([]);
  });

  it('trims values before writing them', () => {
    expect(build(MINIMAL, { title: '  Trimmed  ' }).descriptionXml).toContain('<book-title>Trimmed</book-title>');
  });
});

describe('buildFb2Description coverpage', () => {
  it('adds a coverpage pointing at the requested binary id', () => {
    const { descriptionXml } = build(MINIMAL, {}, FULL_MASK, { coverEntryId: 'cover.jpg' });
    expect(descriptionXml).toContain('<coverpage><image l:href="#cover.jpg"/></coverpage>');
  });

  it('uses the document xlink prefix', () => {
    const { descriptionXml } = build(MINIMAL, {}, FULL_MASK, { coverEntryId: 'c.jpg', xlinkPrefix: 'xlink' });
    expect(descriptionXml).toContain('<image xlink:href="#c.jpg"/>');
  });

  it('replaces an existing coverpage rather than adding a second one', () => {
    const xml = description('    <genre>sf</genre>\n    <coverpage><image l:href="#old.jpg"/></coverpage>\n    <lang>en</lang>');
    const { descriptionXml } = build(xml, {}, FULL_MASK, { coverEntryId: 'new.jpg' });
    expect(descriptionXml.match(/<coverpage>/g)).toHaveLength(1);
    expect(descriptionXml).toContain('#new.jpg');
    expect(descriptionXml).not.toContain('#old.jpg');
  });

  it('leaves the coverpage alone when no cover is being written', () => {
    const xml = description('    <genre>sf</genre>\n    <coverpage><image l:href="#old.jpg"/></coverpage>');
    expect(build(xml, { title: 'T' }).descriptionXml).toContain('<coverpage><image l:href="#old.jpg"/></coverpage>');
  });
});

describe('buildFb2Description refusals', () => {
  it('skips a description without title-info', () => {
    const result = buildFb2Description('<description><document-info><id>1</id></document-info></description>', { title: 'T' }, FULL_MASK, {
      xlinkPrefix: 'l',
    });
    expect(result).toEqual({ status: 'skipped', reason: 'description has no title-info' });
  });

  it('skips a self-closing description', () => {
    const result = buildFb2Description('<description/>', { title: 'T' }, FULL_MASK, { xlinkPrefix: 'l' });
    expect(result.status).toBe('skipped');
  });

  it('skips an unclosed description instead of throwing', () => {
    const result = buildFb2Description('<description><title-info><book-title>T', { title: 'T' }, FULL_MASK, { xlinkPrefix: 'l' });
    expect(result).toMatchObject({ status: 'skipped' });
    expect(result.status === 'skipped' && result.reason).toMatch(/unclosed/);
  });
});

describe('readCoverEntryId', () => {
  it('reads the id from a coverpage href', () => {
    const xml = description('    <coverpage><image l:href="#img_0"/></coverpage>');
    expect(readCoverEntryId(xml, 'l')).toBe('img_0');
  });

  it('reads a single-quoted href', () => {
    const xml = description("    <coverpage><image l:href='#cover(1).jpg'/></coverpage>");
    expect(readCoverEntryId(xml, 'l')).toBe('cover(1).jpg');
  });

  it('reads an href written with a different prefix than the document declares', () => {
    const xml = description('    <coverpage><image xlink:href="#c.jpg"/></coverpage>');
    expect(readCoverEntryId(xml, 'l')).toBe('c.jpg');
  });

  it('reads an unprefixed href', () => {
    const xml = description('    <coverpage><image href="#c.jpg"/></coverpage>');
    expect(readCoverEntryId(xml, 'l')).toBe('c.jpg');
  });

  it('returns the first image when a coverpage lists several', () => {
    const xml = description('    <coverpage><image l:href="#first.jpg"/><image l:href="#second.jpg"/></coverpage>');
    expect(readCoverEntryId(xml, 'l')).toBe('first.jpg');
  });

  it('returns null when there is no coverpage', () => {
    expect(readCoverEntryId(MINIMAL, 'l')).toBeNull();
  });

  it('ignores a coverpage that belongs to src-title-info', () => {
    const xml = description('    <genre>sf</genre>', '  <src-title-info><coverpage><image l:href="#other.jpg"/></coverpage></src-title-info>\n');
    expect(readCoverEntryId(xml, 'l')).toBeNull();
  });
});
