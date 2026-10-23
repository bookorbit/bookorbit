import { XMLParser } from 'fast-xml-parser';

import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import { build } from './epub-opf-builder';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
  textNodeName: '#text',
  isArray: (name) => ['dc:creator', 'dc:identifier', 'dc:subject', 'dc:title', 'meta'].includes(name),
});

const inspector = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  textNodeName: '#text',
  parseTagValue: false,
});

const OPF_NS = 'http://www.idpf.org/2007/opf';
const DC_NS = 'http://purl.org/dc/elements/1.1/';

type OrderedNode = Record<string, unknown>;

interface MetadataElement {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

function tagOf(node: OrderedNode): string {
  return Object.keys(node).find((key) => key !== ':@') ?? '';
}

function childrenOf(nodes: OrderedNode[], localName: string): OrderedNode[] {
  const node = nodes.find((candidate) => tagOf(candidate).split(':').at(-1) === localName);
  if (!node) throw new Error(`Missing <${localName}> in OPF`);
  return node[tagOf(node)] as OrderedNode[];
}

function metadataElements(opfXml: string): MetadataElement[] {
  const packageChildren = childrenOf(inspector.parse(opfXml) as OrderedNode[], 'package');
  return childrenOf(packageChildren, 'metadata').map((node) => {
    const tag = tagOf(node);
    const text = (node[tag] as OrderedNode[]).map((child) => (typeof child['#text'] === 'string' ? child['#text'] : '')).join('');
    return { tag, attrs: (node[':@'] ?? {}) as Record<string, string>, text };
  });
}

function duplicatedElements(elements: MetadataElement[]): string[] {
  const serialized = elements.map((element) => JSON.stringify(element));
  return serialized.filter((element, index) => serialized.indexOf(element) !== index);
}

// `prefix` is what the file binds the OPF namespace to; '' is the usual default namespace.
function opfDocument(version: '2.0' | '3.0', prefix: string, metadata: (p: string) => string, packageAttrs = `xmlns:dc="${DC_NS}"`): string {
  const p = prefix ? `${prefix}:` : '';
  const opfBinding = prefix ? `xmlns:${prefix}` : 'xmlns';
  return `<?xml version="1.0" encoding="utf-8"?>
<${p}package ${opfBinding}="${OPF_NS}" ${packageAttrs} version="${version}" unique-identifier="uid">
  <${p}metadata>${metadata(p)}
  </${p}metadata>
  <${p}manifest><${p}item id="cover-image" href="cover.jpg" media-type="image/jpeg" /></${p}manifest>
</${p}package>`;
}

function sourceMetadata(p: string): string {
  return `
    <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
    <dc:title>Old title</dc:title>
    <dc:creator>Old Author</dc:creator>
    <dc:language>pt</dc:language>
    <${p}meta name="cover" content="cover-image" />
    <${p}meta name="calibre:timestamp" content="2020-01-01T00:00:00+00:00" />`;
}

function saveRepeatedly(opfXml: string, payload: BookWritePayload, saves: number): string[] {
  const outputs: string[] = [];
  let current = opfXml;
  for (let save = 0; save < saves; save += 1) {
    current = build(current, payload).newOpfXml;
    outputs.push(current);
  }
  return outputs;
}

const FULL_PAYLOAD: BookWritePayload = {
  title: 'Dune',
  subtitle: 'Book One',
  description: 'Arrakis',
  publisher: 'Ace',
  publishedDate: '1965-08-01',
  language: 'en',
  pageCount: 412,
  seriesName: 'Dune Chronicles',
  seriesIndex: '1',
  isbn10: '0441172717',
  isbn13: '9780441172719',
  rating: 5,
  authors: [
    { name: 'Frank Herbert', sortName: 'Herbert, Frank' },
    { name: 'Brian Herbert', sortName: null },
  ],
  genres: ['Science Fiction', 'Classic'],
  tags: ['space', 'desert'],
  goodreadsId: '44767458',
  customMetadata: [{ fieldId: 1, key: 'original_title', label: 'Original Title', type: 'text', displayOrder: 0, value: 'Dune' }],
};

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
      seriesIndex: '5.10',
      tags: ['Classic'],
    });

    expect(result.newOpfXml).toContain('bookorbit: https://bookorbit.app/metadata/1.0/');
    expect(result.newOpfXml).toContain('urn:uuid:abc');
    expect(result.newOpfXml).toContain('New Title');
    expect(result.newOpfXml).toContain('Frank Herbert');
    expect(result.newOpfXml).toContain('belongs-to-collection');
    expect(result.newOpfXml).toContain('content="5.10"');
    expect(result.newOpfXml).toContain('>5.10</meta>');
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
      hardcoverEditionId: '8941973',
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
    expect(result.newOpfXml).toContain('opf:scheme="HARDCOVER_EDITION"');
    expect(result.newOpfXml).toContain('>8941973<');
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

  it('adds xmlns:dc to <package> when source declarations are scoped to replaced metadata elements', () => {
    const opf = `
      <package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:opf="http://www.idpf.org/2007/opf">
          <dc:identifier xmlns:dc="http://purl.org/dc/elements/1.1/" id="uid">urn:uuid:abc</dc:identifier>
          <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Old title</dc:title>
          <dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">Old publisher</dc:publisher>
        </metadata>
      </package>
    `;

    const result = build(opf, { title: 'Replacement', publisher: 'New publisher', language: 'en' });
    const packageTag = result.newOpfXml.match(/<package\b[^>]*>/)?.[0];

    expect(packageTag).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(result.newOpfXml).toContain('<dc:title id="t-main">Replacement</dc:title>');
    expect(result.newOpfXml).toContain('<dc:publisher>New publisher</dc:publisher>');
    expect(result.newOpfXml).toContain('<dc:language>en</dc:language>');
  });

  it('does not duplicate xmlns:dc when already declared on <package>', () => {
    const opf = `
      <package version="3.0" unique-identifier="uid" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:title>Old title</dc:title>
        </metadata>
      </package>
    `;

    const result = build(opf, { title: 'Replacement' });

    expect(result.newOpfXml.match(/xmlns:dc=/g)).toHaveLength(1);
  });

  it('preserves an existing xmlns:dc binding on <package>', () => {
    const opf = `
      <package version="2.0" unique-identifier="uid" xmlns:dc="urn:publisher:dc">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:title>Old title</dc:title>
        </metadata>
      </package>
    `;

    const result = build(opf, { title: 'Replacement' });
    const packageTag = result.newOpfXml.match(/<package\b[^>]*>/)?.[0];

    expect(packageTag).toContain('xmlns:dc="urn:publisher:dc"');
    expect(packageTag).not.toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
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

  it('preserves explicit OPF prefixes when the whole package is namespaced', () => {
    const opf = `
      <opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" unique-identifier="uid">
        <opf:metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <dc:title>Old</dc:title>
          <opf:meta name="cover" content="cover" />
        </opf:metadata>
        <opf:manifest><opf:item id="cover" href="cover.jpg" media-type="image/jpeg" /></opf:manifest>
      </opf:package>
    `;

    const result = build(opf, { title: 'Replacement', subtitle: 'Subtitle' });

    expect(result.newOpfXml).toContain('<opf:package');
    expect(result.newOpfXml).toContain('<opf:metadata>');
    expect(result.newOpfXml).toContain('<opf:meta name="bookorbit:subtitle" content="Subtitle"></opf:meta>');
    expect(result.newOpfXml).toContain('<opf:meta name="cover" content="cover"></opf:meta>');
    expect(result.newOpfXml).toContain('<opf:manifest><opf:item');
    expect(result.newOpfXml).not.toContain('<meta name="bookorbit:subtitle"');
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

  it('writes stable custom metadata tags and reports written custom fields', () => {
    const opf = `
      <package version="3.0" unique-identifier="uid">
        <metadata>
          <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
          <meta property="bookorbit:custom:old_field">Old</meta>
        </metadata>
      </package>
    `;

    const result = build(opf, {
      customMetadata: [
        { fieldId: 1, key: 'original_title', label: 'Original Title', type: 'text', displayOrder: 0, value: 'Le Comte de Monte-Cristo' },
        { fieldId: 2, key: 'translated', label: 'Translated', type: 'boolean', displayOrder: 1, value: false },
        { fieldId: 3, key: 'empty_field', label: 'Empty Field', type: 'text', displayOrder: 2, value: null },
      ],
    });

    expect(result.newOpfXml).toContain('property="bookorbit:custom:original_title"');
    expect(result.newOpfXml).toContain('Le Comte de Monte-Cristo');
    expect(result.newOpfXml).toContain('property="bookorbit:custom:translated"');
    expect(result.newOpfXml).toContain('>false<');
    expect(result.newOpfXml).not.toContain('old_field');
    expect(result.newOpfXml).not.toContain('empty_field');
    expect(result.fieldsWritten).toEqual(['customMetadata:original_title', 'customMetadata:translated']);
  });

  describe('repeated saves', () => {
    const shapes = [
      { shape: 'an unprefixed EPUB 2 package', version: '2.0', prefix: '' },
      { shape: 'an opf-prefixed EPUB 2 package', version: '2.0', prefix: 'opf' },
      { shape: 'an ns0-prefixed EPUB 2 package', version: '2.0', prefix: 'ns0' },
      { shape: 'an unprefixed EPUB 3 package', version: '3.0', prefix: '' },
      { shape: 'an opf-prefixed EPUB 3 package', version: '3.0', prefix: 'opf' },
      { shape: 'an ns0-prefixed EPUB 3 package', version: '3.0', prefix: 'ns0' },
    ] as const;

    it.each(shapes)('writes the same document on every save of $shape', ({ version, prefix }) => {
      const [first, second, third] = saveRepeatedly(opfDocument(version, prefix, sourceMetadata), FULL_PAYLOAD, 3);

      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it.each(shapes)('writes every value once into $shape', ({ version, prefix }) => {
      const elements = metadataElements(saveRepeatedly(opfDocument(version, prefix, sourceMetadata), FULL_PAYLOAD, 3)[2]);

      expect(duplicatedElements(elements)).toEqual([]);
      expect(elements.filter((element) => element.attrs.name === 'cover')).toHaveLength(1);
      expect(elements.filter((element) => element.attrs.name === 'calibre:timestamp')).toHaveLength(1);
    });

    it('keeps one bookorbit:isbn10 entry while unrelated fields are saved one after another', () => {
      const titleFix: BookWritePayload = { title: 'Titulo', publisher: 'Editora', language: 'pt', isbn10: '9722623702', genres: ['Romance'] };
      const authorFix: BookWritePayload = { ...titleFix, authors: [{ name: 'Autor', sortName: null }] };
      const descriptionFix: BookWritePayload = { ...authorFix, description: 'Sinopse' };

      let opf = opfDocument('2.0', 'ns0', sourceMetadata);
      for (const payload of [titleFix, authorFix, descriptionFix]) {
        opf = build(opf, payload).newOpfXml;

        expect(metadataElements(opf).filter((element) => element.attrs.name === 'bookorbit:isbn10')).toEqual([
          { tag: 'ns0:meta', attrs: { name: 'bookorbit:isbn10', content: '9722623702' }, text: '' },
        ]);
      }
    });

    it('keeps one title-type refinement per title on EPUB 3', () => {
      const [, , third] = saveRepeatedly(opfDocument('3.0', '', sourceMetadata), { title: 'Dune', subtitle: 'Book One' }, 3);

      expect(metadataElements(third).filter((element) => element.attrs.property === 'title-type')).toEqual([
        { tag: 'meta', attrs: { refines: '#t-main', property: 'title-type' }, text: 'main' },
        { tag: 'meta', attrs: { refines: '#t-sub', property: 'title-type' }, text: 'subtitle' },
      ]);
    });

    it('removes the subtitle refinement once the subtitle is cleared', () => {
      const withSubtitle = build(opfDocument('3.0', '', sourceMetadata), { title: 'Dune', subtitle: 'Book One' }).newOpfXml;
      const withoutSubtitle = build(withSubtitle, { title: 'Dune', subtitle: null }).newOpfXml;

      expect(metadataElements(withoutSubtitle).filter((element) => element.attrs.refines === '#t-sub')).toEqual([]);
    });

    it('collapses bookorbit entries duplicated by earlier saves', () => {
      const duplicated = '<ns0:meta name="bookorbit:isbn10" content="9722623702"></ns0:meta>'.repeat(3);
      const damaged = opfDocument('2.0', 'ns0', (p) => `${sourceMetadata(p)}${duplicated}`);

      const repaired = build(damaged, { title: 'Titulo', isbn10: '9722623702' }).newOpfXml;

      expect(metadataElements(repaired).filter((element) => element.attrs.name === 'bookorbit:isbn10')).toHaveLength(1);
    });

    it('collapses title refinements accumulated by earlier saves', () => {
      const accumulated = '<meta refines="#t-main" property="title-type">main</meta>'.repeat(3);
      const damaged = opfDocument(
        '3.0',
        '',
        () => `<dc:identifier id="uid">urn:uuid:abc</dc:identifier><dc:title id="t-main">Dune</dc:title>${accumulated}`,
      );

      const repaired = build(damaged, { title: 'Dune' }).newOpfXml;

      expect(metadataElements(repaired).filter((element) => element.attrs.property === 'title-type')).toHaveLength(1);
    });

    describe('subtitle refinements an earlier save left without a subtitle', () => {
      const orphaned = '<meta refines="#t-sub" property="title-type">subtitle</meta>'.repeat(3);
      const damaged = opfDocument(
        '3.0',
        '',
        () => `<dc:identifier id="uid">urn:uuid:abc</dc:identifier><dc:title id="t-main">Dune</dc:title>${orphaned}`,
      );

      it('do not attach to a subtitle that is written again', () => {
        const [first, second] = saveRepeatedly(damaged, { title: 'Dune', subtitle: 'Book One' }, 2);

        expect(metadataElements(first).filter((element) => element.attrs.refines === '#t-sub')).toEqual([
          { tag: 'meta', attrs: { refines: '#t-sub', property: 'title-type' }, text: 'subtitle' },
        ]);
        expect(second).toBe(first);
      });

      it('are removed when there is still no subtitle', () => {
        const repaired = build(damaged, { title: 'Dune' }).newOpfXml;

        expect(metadataElements(repaired).filter((element) => element.attrs.refines === '#t-sub')).toEqual([]);
      });
    });
  });

  describe('refinements', () => {
    const source = opfDocument(
      '3.0',
      '',
      () => `
      <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
      <meta refines="#uid" property="identifier-type" scheme="onix:codelist5">22</meta>
      <dc:title id="title">Old title</dc:title>
      <meta refines="#title" property="title-type">main</meta>
      <meta refines="#title" property="file-as">Old title, The</meta>
      <dc:subject id="subject-1">Old subject</dc:subject>
      <meta refines="#subject-1" property="authority">BISAC</meta>
      <meta refines="subject-1" property="term">FIC000000</meta>
      <dc:contributor id="translator">Translator</dc:contributor>
      <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
      <meta refines="#chapter-overlay" property="media:duration">0:01:00</meta>
      <meta property="media:duration">0:10:00</meta>`,
    );

    function refinementsOf(opfXml: string, target: string): MetadataElement[] {
      return metadataElements(opfXml).filter((element) => element.attrs.refines === target);
    }

    it('drops refinements of the elements it replaces', () => {
      const result = build(source, { title: 'Dune', genres: ['Classic'] }).newOpfXml;

      expect(refinementsOf(result, '#title')).toEqual([]);
      expect(refinementsOf(result, '#subject-1')).toEqual([]);
      expect(refinementsOf(result, 'subject-1')).toEqual([]);
    });

    it('keeps refinements of the elements it leaves in place', () => {
      const result = build(source, { title: 'Dune', genres: ['Classic'] }).newOpfXml;

      expect(refinementsOf(result, '#uid')).toEqual([
        { tag: 'meta', attrs: { refines: '#uid', property: 'identifier-type', scheme: 'onix:codelist5' }, text: '22' },
      ]);
      expect(refinementsOf(result, '#translator')).toEqual([
        { tag: 'meta', attrs: { refines: '#translator', property: 'role', scheme: 'marc:relators' }, text: 'trl' },
      ]);
      expect(refinementsOf(result, '#chapter-overlay')).toHaveLength(1);
      expect(metadataElements(result).filter((element) => element.attrs.property === 'media:duration')).toHaveLength(2);
    });
  });

  describe('elements the writer does not own', () => {
    const source = opfDocument(
      '3.0',
      '',
      () => `
      <dc:identifier id="uid">0441172717</dc:identifier>
      <meta refines="#uid" property="identifier-type" scheme="onix:codelist5">02</meta>
      <dc:title>Old title</dc:title>
      <dc:rights>&#169; 2020 Caf&#xE9; &amp; Bar</dc:rights>
      <dc:type>&amp;#233; &amp;amp;</dc:type>
      <dc:source>0x1F</dc:source>
      <dc:coverage>1.50</dc:coverage>
      <dc:relation>1e5</dc:relation>
      <meta property="schema:numberOfPages">0320</meta>
      <meta name="calibre:title_sort" content="Caf&#233; &amp; Bar" />`,
    );

    it('keeps their text exactly as written instead of reading it as a number', () => {
      const elements = metadataElements(build(source, { title: 'Dune' }).newOpfXml);
      const texts = Object.fromEntries(elements.map((element) => [element.attrs.property ?? element.tag, element.text]));

      expect(texts).toMatchObject({
        'dc:identifier': '0441172717',
        'identifier-type': '02',
        'dc:source': '0x1F',
        'dc:coverage': '1.50',
        'dc:relation': '1e5',
        'schema:numberOfPages': '0320',
      });
    });

    it('keeps character references readable instead of escaping them a second time', () => {
      const result = build(source, { title: 'Dune' }).newOpfXml;

      expect(result).toContain('<dc:rights>© 2020 Café &amp; Bar</dc:rights>');
      expect(result).toContain('<meta name="calibre:title_sort" content="Café &amp; Bar"></meta>');
    });

    it('keeps an escaped ampersand escaped', () => {
      const result = build(source, { title: 'Dune' }).newOpfXml;

      expect(result).toContain('<dc:type>&amp;#233; &amp;amp;</dc:type>');
    });

    it('leaves them unchanged on every later save', () => {
      const [first, second, third] = saveRepeatedly(source, { title: 'Dune' }, 3);

      expect(second).toBe(first);
      expect(third).toBe(first);
    });
  });

  describe('packages that bind namespaces to other prefixes', () => {
    function textsOf(opfXml: string, localName: string): string[] {
      return metadataElements(opfXml)
        .filter((element) => element.tag.split(':').at(-1) === localName)
        .map((element) => element.text);
    }

    it('replaces calibre series entries and keeps unrelated ones under a foreign OPF prefix', () => {
      const source = opfDocument(
        '2.0',
        'ns0',
        (p) => `${sourceMetadata(p)}
        <${p}meta name="calibre:series" content="Old Series" />
        <${p}meta name="calibre:series_index" content="3" />`,
      );

      const [, second] = saveRepeatedly(source, { title: 'Dune', seriesName: 'Dune Chronicles', seriesIndex: '1' }, 2);
      const contentsOf = (name: string) =>
        metadataElements(second)
          .filter((element) => element.attrs.name === name)
          .map((element) => element.attrs.content);

      expect(contentsOf('calibre:series')).toEqual(['Dune Chronicles']);
      expect(contentsOf('calibre:series_index')).toEqual(['1']);
      expect(contentsOf('cover')).toEqual(['cover-image']);
      expect(contentsOf('calibre:timestamp')).toEqual(['2020-01-01T00:00:00+00:00']);
    });

    it('replaces Dublin Core elements bound to a foreign prefix', () => {
      const source = opfDocument(
        '2.0',
        'ns0',
        () => `
        <ns1:identifier id="uid">urn:uuid:abc</ns1:identifier>
        <ns1:title>Old title</ns1:title>
        <ns1:creator>Old Author</ns1:creator>
        <ns1:rights>All rights reserved</ns1:rights>`,
        `xmlns:ns1="${DC_NS}"`,
      );

      const [, second] = saveRepeatedly(source, { title: 'Dune', authors: [{ name: 'Frank Herbert', sortName: null }] }, 2);

      expect(textsOf(second, 'title')).toEqual(['Dune']);
      expect(textsOf(second, 'creator')).toEqual(['Frank Herbert']);
      expect(textsOf(second, 'identifier')).toEqual(['urn:uuid:abc']);
      expect(textsOf(second, 'rights')).toEqual(['All rights reserved']);
    });

    it('replaces Dublin Core elements that declare the namespace on themselves', () => {
      const source = opfDocument(
        '2.0',
        '',
        () => `
        <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
        <x:title xmlns:x="${DC_NS}">Old title</x:title>
        <y:creator xmlns:y="${DC_NS}">Old Author</y:creator>
        <publisher xmlns="${DC_NS}">Old publisher</publisher>`,
      );

      const [, second] = saveRepeatedly(source, { title: 'Dune', publisher: 'Ace', authors: [{ name: 'Frank Herbert', sortName: null }] }, 2);

      expect(textsOf(second, 'title')).toEqual(['Dune']);
      expect(textsOf(second, 'creator')).toEqual(['Frank Herbert']);
      expect(textsOf(second, 'publisher')).toEqual(['Ace']);
    });

    it('leaves same-named elements from other namespaces in place', () => {
      const source = opfDocument(
        '2.0',
        '',
        () => `
        <dc:identifier id="uid">urn:uuid:abc</dc:identifier>
        <dc:title>Old title</dc:title>
        <shelf:title xmlns:shelf="urn:example:shelf">Shelf label</shelf:title>`,
      );

      const result = build(source, { title: 'Dune' }).newOpfXml;

      expect(textsOf(result, 'title')).toEqual(['Dune', 'Shelf label']);
    });
  });

  // epubBuilder spells the package's default namespace `mlns`, so foliate found no <spine> once a
  // save bound opf: on <package> (bookorbit/bookorbit#1680).
  describe('packages without a default namespace', () => {
    function epubBuilderOpf(extraPackageAttrs = ''): string {
      return `<?xml version="1.0" encoding="UTF-8"?><package version="2.0" unique-identifier="PrimaryID" mlns="${OPF_NS}"${extraPackageAttrs}><metadata xmlns:dc="${DC_NS}" xmlns:opf="${OPF_NS}"><dc:title>鬼吹灯Ⅰ</dc:title><dc:creator opf:role="aut" opf:file-as="天下霸唱">天下霸唱</dc:creator><dc:identifier id="PrimaryID">urn:isbn:9787539628042</dc:identifier><meta name="cover" content="cover-image"></meta></metadata><manifest><item id="chapter1" href="chapter1.html" media-type="application/xhtml+xml"></item><item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"></item></manifest><spine toc="ncx"><itemref idref="chapter1" linear="yes"></itemref></spine></package>`;
    }

    function packageAttributes(opfXml: string): Record<string, string> {
      const node = (inspector.parse(opfXml) as OrderedNode[]).find((candidate) => tagOf(candidate).split(':').at(-1) === 'package');
      if (!node) throw new Error('Missing <package> in OPF');
      return (node[':@'] ?? {}) as Record<string, string>;
    }

    function declarationsOnPackage(opfXml: string, declaration: string): number {
      const packageTag = opfXml.match(/<(?:\w+:)?package\b[^>]*>/)?.[0] ?? '';
      return packageTag.split(/\s+/).filter((token) => token.startsWith(`${declaration}=`)).length;
    }

    it('puts a package with a misspelled xmlns back in the OPF namespace', () => {
      const result = build(epubBuilderOpf(), { title: 'Replacement' }).newOpfXml;

      expect(packageAttributes(result)).toMatchObject({ xmlns: OPF_NS, 'xmlns:opf': OPF_NS, 'xmlns:dc': DC_NS, mlns: OPF_NS });
    });

    it('repairs a package an earlier save already bound opf: and dc: on', () => {
      const shipped = epubBuilderOpf(` xmlns:opf="${OPF_NS}" xmlns:dc="${DC_NS}"`);

      const result = build(shipped, { title: 'Replacement' }).newOpfXml;

      expect(packageAttributes(result).xmlns).toBe(OPF_NS);
      expect(declarationsOnPackage(result, 'xmlns:opf')).toBe(1);
      expect(declarationsOnPackage(result, 'xmlns:dc')).toBe(1);
    });

    it('leaves the manifest and spine exactly as written', () => {
      const result = build(epubBuilderOpf(), { title: 'Replacement' }).newOpfXml;

      expect(result).toContain(
        '<manifest><item id="chapter1" href="chapter1.html" media-type="application/xhtml+xml"></item><item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"></item></manifest>',
      );
      expect(result).toContain('<spine toc="ncx"><itemref idref="chapter1" linear="yes"></itemref></spine>');
    });

    it('declares the namespace once across repeated saves', () => {
      const outputs = saveRepeatedly(epubBuilderOpf(), { title: 'Replacement' }, 3);

      expect(outputs.map((output) => declarationsOnPackage(output, 'xmlns'))).toEqual([1, 1, 1]);
    });

    it('keeps the default namespace a package already declares', () => {
      const result = build(opfDocument('2.0', '', sourceMetadata), { title: 'Replacement' }).newOpfXml;

      expect(packageAttributes(result).xmlns).toBe(OPF_NS);
      expect(declarationsOnPackage(result, 'xmlns')).toBe(1);
    });

    it('does not add a default namespace to a package qualified with a prefix', () => {
      const result = build(opfDocument('2.0', 'opf', sourceMetadata), { title: 'Replacement' }).newOpfXml;

      expect(packageAttributes(result)).not.toHaveProperty('xmlns');
      expect(result).toContain('<opf:package');
    });
  });
});
