import { XMLParser } from 'fast-xml-parser';

import { build } from './epub-opf-builder';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
  textNodeName: '#text',
  isArray: (name) => ['dc:creator', 'dc:identifier', 'dc:subject', 'dc:title', 'meta'].includes(name),
});

describe('epub-opf-builder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws on unsupported package version', () => {
    const opf = `<package version="1.0"><metadata></metadata></package>`;

    expect(() => build(opf, { title: 'Book' })).toThrow('Unsupported EPUB version: "1.0"');
  });

  it('rewrites metadata for EPUB3, preserves UID, and appends required namespace prefix', () => {
    const opf = `
      <package version="3.0" unique-identifier="uid">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:title>Old</dc:title>
          <dc:creator id="creator-old">Old Author</dc:creator>
          <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
          <meta name="calibre:series" content="Old Series" />
        </metadata>
      </package>
    `;

    const result = build(opf, {
      title: 'New Title',
      subtitle: 'Sub',
      authors: [{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
      genres: ['Sci-Fi'],
      seriesName: 'Dune',
      seriesIndex: 1,
      tags: ['Classic'],
    });

    expect(result.newOpfXml).toContain('bookorbit: https://bookorbit.app/metadata/1.0/');
    expect(result.newOpfXml).toContain('urn:uuid:abc');
    expect(result.newOpfXml).toContain('New Title');
    expect(result.newOpfXml).toContain('Frank Herbert');
    expect(result.newOpfXml).toContain('belongs-to-collection');
    expect(result.newOpfXml).toContain('dcterms:modified');
    expect(result.newOpfXml).toContain('2026-01-02T03:04:05.000Z');
    expect(result.newOpfXml).not.toContain('Old Author');
    expect(result.newOpfXml).not.toContain('Old Series');
    expect(result.fieldsWritten).toEqual(['title', 'subtitle', 'authors', 'genres', 'seriesName', 'seriesIndex', 'tags']);
  });

  it('writes provider IDs using opf:scheme attribute format', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid">
        <metadata xmlns:opf="http://www.idpf.org/2007/opf">
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
        </metadata>
      </package>
    `;

    const result = build(opf, {
      googleBooksId: 'RPyFDwAAQBAJ',
      amazonId: '198893706X',
      goodreadsId: '42129393',
      openLibraryId: 'OL20652610W',
      hardcoverId: 'new-orleans-rush',
      ranobedbId: 'ranobe-1',
      itunesId: '123456789',
    });

    expect(result.newOpfXml).toContain('opf:scheme="GOOGLE"');
    expect(result.newOpfXml).toContain('>RPyFDwAAQBAJ<');
    expect(result.newOpfXml).toContain('opf:scheme="AMAZON"');
    expect(result.newOpfXml).toContain('>198893706X<');
    expect(result.newOpfXml).toContain('opf:scheme="GOODREADS"');
    expect(result.newOpfXml).toContain('opf:scheme="OPENLIBRARY"');
    expect(result.newOpfXml).toContain('opf:scheme="HARDCOVER"');
    expect(result.newOpfXml).toContain('opf:scheme="RANOBEDB"');
    expect(result.newOpfXml).toContain('>ranobe-1<');
    expect(result.newOpfXml).toContain('opf:scheme="ITUNES"');
    // Must not use old urn: prefix style
    expect(result.newOpfXml).not.toContain('urn:google:');
    expect(result.newOpfXml).not.toContain('urn:amazon:');
    expect(result.newOpfXml).not.toContain('urn:goodreads:');
  });

  it('adds xmlns:opf to <package> when not already declared', () => {
    const opf = `
      <package version="3.0" unique-identifier="uid">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
        </metadata>
      </package>
    `;

    const result = build(opf, { googleBooksId: 'testId' });

    expect(result.newOpfXml).toContain('xmlns:opf="http://www.idpf.org/2007/opf"');
  });

  it('does not duplicate xmlns:opf when already present on <package>', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid" xmlns:opf="http://www.idpf.org/2007/opf">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
        </metadata>
      </package>
    `;

    const result = build(opf, { googleBooksId: 'testId' });

    const count = (result.newOpfXml.match(/xmlns:opf/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('strips legacy urn: provider identifiers and replaces with opf:scheme format', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid" xmlns:opf="http://www.idpf.org/2007/opf">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:identifier>urn:google:OLD_VALUE</dc:identifier>
          <dc:identifier>urn:amazon:OLD_ASIN</dc:identifier>
        </metadata>
      </package>
    `;

    const result = build(opf, { googleBooksId: 'NEW_GOOGLE', amazonId: 'NEW_ASIN' });

    expect(result.newOpfXml).toContain('opf:scheme="GOOGLE"');
    expect(result.newOpfXml).toContain('>NEW_GOOGLE<');
    expect(result.newOpfXml).not.toContain('urn:google:');
    expect(result.newOpfXml).not.toContain('OLD_VALUE');
    expect(result.newOpfXml).not.toContain('OLD_ASIN');
  });

  it('supports OPF documents with opf:metadata element', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid">
        <opf:metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:title>Old</dc:title>
        </opf:metadata>
      </package>
    `;

    const result = build(opf, { title: 'Replacement' });

    expect(result.newOpfXml).toContain('<opf:metadata>');
    expect(result.newOpfXml).toContain('Replacement');
    expect(result.newOpfXml).toContain('urn:uuid:abc');

    const parsed = parser.parse(result.newOpfXml) as Record<string, unknown>[];
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('writes EPUB2-only BookOrbit metadata fields and preserves omitted values', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
        </metadata>
      </package>
    `;

    const result = build(opf, {
      subtitle: 'Book One',
      isbn10: '0441172717',
      isbn13: '9780441172719',
      pageCount: 412,
      rating: 5,
      tags: ['classic', 'space'],
      publishedYear: 1965,
      language: 'en',
      publisher: 'Ace',
      description: 'Arrakis',
    });

    expect(result.newOpfXml).toContain('meta name="bookorbit:subtitle" content="Book One"');
    expect(result.newOpfXml).toContain('meta name="bookorbit:isbn10" content="0441172717"');
    expect(result.newOpfXml).toContain('meta name="bookorbit:page_count" content="412"');
    expect(result.newOpfXml).toContain('meta name="bookorbit:rating" content="5"');
    expect(result.newOpfXml).toContain('classic');
    expect(result.newOpfXml).toContain('urn:isbn:9780441172719');
    expect(result.fieldsWritten).toEqual(
      expect.arrayContaining([
        'subtitle',
        'description',
        'publisher',
        'publishedYear',
        'language',
        'pageCount',
        'isbn10',
        'isbn13',
        'rating',
        'tags',
      ]),
    );
    expect(result.fieldsWritten).toHaveLength(10);
  });
});
