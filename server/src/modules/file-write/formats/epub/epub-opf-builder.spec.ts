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
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws on unsupported package version', () => {
    const opf = `<package version="1.0"><metadata></metadata></package>`;

    expect(() => build(opf, { title: 'Book' }, { fieldMask: new Set(['title']), dryRun: false })).toThrow(
      'Unsupported EPUB version: "1.0"',
    );
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

    const result = build(
      opf,
      {
        title: 'New Title',
        subtitle: 'Sub',
        authors: [{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
        genres: ['Sci-Fi'],
        seriesName: 'Dune',
        seriesIndex: 1,
        tags: ['Classic'],
      },
      { fieldMask: new Set(['title']), dryRun: false },
    );

    expect(result.newOpfXml).toContain('projectx: https://projectx.app/metadata/1.0/');
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

  it('supports OPF documents with opf:metadata element', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid">
        <opf:metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:title>Old</dc:title>
        </opf:metadata>
      </package>
    `;

    const result = build(opf, { title: 'Replacement' }, { fieldMask: new Set(['title']), dryRun: false });

    expect(result.newOpfXml).toContain('<opf:metadata>');
    expect(result.newOpfXml).toContain('Replacement');
    expect(result.newOpfXml).toContain('urn:uuid:abc');

    const parsed = parser.parse(result.newOpfXml) as Record<string, unknown>[];
    expect(parsed.length).toBeGreaterThan(0);
  });
});
