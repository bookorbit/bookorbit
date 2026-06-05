import { PDFDocument, PDFName } from 'pdf-lib';
import { BOOKORBIT_NS_PREFIX, BOOKORBIT_NS_URI } from '../../../common/bookorbit-ns';
import { extractXmpXml, parseXmp } from './pdf-xmp-reader';

// Wraps XMP content in standard RDF envelope
function xmpDoc(body: string): string {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:${BOOKORBIT_NS_PREFIX}="${BOOKORBIT_NS_URI}">
      ${body}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

describe('parseXmp', () => {
  describe('dc: namespace fields', () => {
    it('parses dc:title as plain string', () => {
      const r = parseXmp(xmpDoc('<dc:title>Dune</dc:title>'));
      expect(r?.title).toBe('Dune');
    });

    it('parses dc:title from rdf:Alt container (Calibre style)', () => {
      const r = parseXmp(
        xmpDoc(`
        <dc:title>
          <rdf:Alt>
            <rdf:li xml:lang="x-default">Foundation</rdf:li>
            <rdf:li xml:lang="en">Foundation</rdf:li>
          </rdf:Alt>
        </dc:title>
      `),
      );
      expect(r?.title).toBe('Foundation');
    });

    it('prefers x-default lang in rdf:Alt', () => {
      const r = parseXmp(
        xmpDoc(`
        <dc:title>
          <rdf:Alt>
            <rdf:li xml:lang="fr">Le Titre</rdf:li>
            <rdf:li xml:lang="x-default">The Title</rdf:li>
          </rdf:Alt>
        </dc:title>
      `),
      );
      expect(r?.title).toBe('The Title');
    });

    it('falls back to first item when no x-default in rdf:Alt', () => {
      const r = parseXmp(
        xmpDoc(`
        <dc:title>
          <rdf:Alt>
            <rdf:li xml:lang="en">English Title</rdf:li>
          </rdf:Alt>
        </dc:title>
      `),
      );
      expect(r?.title).toBe('English Title');
    });

    it('parses dc:creator list from rdf:Seq', () => {
      const r = parseXmp(
        xmpDoc(`
        <dc:creator>
          <rdf:Seq>
            <rdf:li>Isaac Asimov</rdf:li>
            <rdf:li>Robert Heinlein</rdf:li>
          </rdf:Seq>
        </dc:creator>
      `),
      );
      expect(r?.authors).toHaveLength(2);
      expect(r?.authors[0].name).toBe('Isaac Asimov');
      expect(r?.authors[1].name).toBe('Robert Heinlein');
      expect(r?.authors[0].sortName).toBeNull();
    });

    it('parses dc:subject (genres) from rdf:Bag', () => {
      const r = parseXmp(
        xmpDoc(`
        <dc:subject>
          <rdf:Bag>
            <rdf:li>Science Fiction</rdf:li>
            <rdf:li>Space Opera</rdf:li>
          </rdf:Bag>
        </dc:subject>
      `),
      );
      expect(r?.genres).toEqual(['Science Fiction', 'Space Opera']);
    });

    it('parses dc:description', () => {
      const r = parseXmp(xmpDoc('<dc:description>A story about worms.</dc:description>'));
      expect(r?.description).toBe('A story about worms.');
    });

    it('parses dc:publisher', () => {
      const r = parseXmp(xmpDoc('<dc:publisher>Ace Books</dc:publisher>'));
      expect(r?.publisher).toBe('Ace Books');
    });

    it('parses dc:date as year', () => {
      const r = parseXmp(xmpDoc('<dc:date>1965-08-01</dc:date>'));
      expect(r?.publishedYear).toBe(1965);
    });

    it('parses bare 4-digit dc:date', () => {
      const r = parseXmp(xmpDoc('<dc:date>1951</dc:date>'));
      expect(r?.publishedYear).toBe(1951);
    });

    it('returns null publishedYear when date is missing', () => {
      const r = parseXmp(xmpDoc(''));
      expect(r?.publishedYear).toBeNull();
    });
  });

  describe('bookorbit: namespace fields', () => {
    it('parses bookorbit:subtitle', () => {
      const r = parseXmp(xmpDoc('<bookorbit:subtitle>A Novel</bookorbit:subtitle>'));
      expect(r?.subtitle).toBe('A Novel');
    });

    it('parses bookorbit:isbn13 - preserves leading zeros', () => {
      // parseTagValue: false prevents numeric conversion that would destroy leading zeros
      const r = parseXmp(xmpDoc('<bookorbit:isbn13>9780441013593</bookorbit:isbn13>'));
      expect(r?.isbn13).toBe('9780441013593');
    });

    it('parses bookorbit:isbn10', () => {
      const r = parseXmp(xmpDoc('<bookorbit:isbn10>0441013597</bookorbit:isbn10>'));
      expect(r?.isbn10).toBe('0441013597');
    });

    it('parses bookorbit:seriesName', () => {
      const r = parseXmp(xmpDoc('<bookorbit:seriesName>Dune Chronicles</bookorbit:seriesName>'));
      expect(r?.seriesName).toBe('Dune Chronicles');
    });

    it('parses bookorbit:seriesIndex as number', () => {
      const r = parseXmp(xmpDoc('<bookorbit:seriesIndex>3</bookorbit:seriesIndex>'));
      expect(r?.seriesIndex).toBe(3);
    });

    it('parses bookorbit:tags list', () => {
      const r = parseXmp(
        xmpDoc(`
        <bookorbit:tags>
          <rdf:Seq>
            <rdf:li>favorites</rdf:li>
            <rdf:li>to-read</rdf:li>
          </rdf:Seq>
        </bookorbit:tags>
      `),
      );
      expect(r?.tags).toEqual(['favorites', 'to-read']);
    });

    it('parses bookorbit:rating', () => {
      const r = parseXmp(xmpDoc('<bookorbit:rating>4.5</bookorbit:rating>'));
      expect(r?.rating).toBe(4.5);
    });

    it('parses bookorbit:pageCount', () => {
      const r = parseXmp(xmpDoc('<bookorbit:pageCount>412</bookorbit:pageCount>'));
      expect(r?.pageCount).toBe(412);
    });

    it('parses bookorbit:googleBooksId', () => {
      const r = parseXmp(xmpDoc('<bookorbit:googleBooksId>abc123</bookorbit:googleBooksId>'));
      expect(r?.googleBooksId).toBe('abc123');
    });

    it('parses bookorbit:ranobedbId', () => {
      const r = parseXmp(xmpDoc('<bookorbit:ranobedbId>ranobe-1</bookorbit:ranobedbId>'));
      expect(r?.ranobedbId).toBe('ranobe-1');
    });

    it('parses bookorbit:goodreadsId', () => {
      const r = parseXmp(xmpDoc('<bookorbit:goodreadsId>1234567</bookorbit:goodreadsId>'));
      expect(r?.goodreadsId).toBe('1234567');
    });

    it('parses bookorbit:amazonId', () => {
      const r = parseXmp(xmpDoc('<bookorbit:amazonId>B001234567</bookorbit:amazonId>'));
      expect(r?.amazonId).toBe('B001234567');
    });
  });

  describe('multiple rdf:Description blocks', () => {
    it('merges fields from separate rdf:Description blocks', () => {
      const xml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>Merged Title</dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:${BOOKORBIT_NS_PREFIX}="${BOOKORBIT_NS_URI}">
      <bookorbit:seriesName>Merged Series</bookorbit:seriesName>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
      const r = parseXmp(xml);
      expect(r?.title).toBe('Merged Title');
      expect(r?.seriesName).toBe('Merged Series');
    });

    it('first occurrence of a field wins when multiple blocks define it', () => {
      const xml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>First Title</dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>Second Title</dc:title>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
      const r = parseXmp(xml);
      expect(r?.title).toBe('First Title');
    });
  });

  describe('null/missing field handling', () => {
    it('returns null for all fields when XMP body is empty', () => {
      const r = parseXmp(xmpDoc(''));
      expect(r).not.toBeNull();
      expect(r?.title).toBeNull();
      expect(r?.authors).toHaveLength(0);
      expect(r?.genres).toHaveLength(0);
      expect(r?.tags).toHaveLength(0);
      expect(r?.isbn10).toBeNull();
      expect(r?.isbn13).toBeNull();
    });

    it('returns null for invalid XML', () => {
      const r = parseXmp('not xml at all <<< >>>');
      // fast-xml-parser is lenient; may not throw — but must not crash
      // If it returns something, it should have null fields or null itself
      if (r !== null) {
        expect(r.title).toBeNull();
      }
    });

    it('returns null when no rdf:RDF root found', () => {
      const r = parseXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><other/></x:xmpmeta>');
      expect(r).toBeNull();
    });
  });
});

describe('extractXmpXml', () => {
  it('decodes compressed metadata streams', async () => {
    const xmp = xmpDoc('<dc:title>Compressed title</dc:title>');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    const metadata = doc.context.flateStream(Buffer.from(xmp, 'utf-8'), {
      Type: PDFName.of('Metadata'),
      Subtype: PDFName.of('XML'),
    });
    const metadataRef = doc.context.register(metadata);
    doc.catalog.set(PDFName.of('Metadata'), metadataRef);

    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const xml = extractXmpXml(loaded);

    expect(xml).toContain('<dc:title>Compressed title</dc:title>');
  });

  it('returns null when the PDF has no metadata stream', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes, { ignoreEncryption: true });

    expect(extractXmpXml(loaded)).toBeNull();
  });
});
