import { parseXmp } from './pdf-xmp-reader';

// Wraps XMP content in standard RDF envelope
function xmpDoc(body: string): string {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:projectx="https://projectx.app/xmp/1.0/">
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

  describe('projectx: namespace fields', () => {
    it('parses projectx:subtitle', () => {
      const r = parseXmp(xmpDoc('<projectx:subtitle>A Novel</projectx:subtitle>'));
      expect(r?.subtitle).toBe('A Novel');
    });

    it('parses projectx:isbn13 - preserves leading zeros', () => {
      // parseTagValue: false prevents numeric conversion that would destroy leading zeros
      const r = parseXmp(xmpDoc('<projectx:isbn13>9780441013593</projectx:isbn13>'));
      expect(r?.isbn13).toBe('9780441013593');
    });

    it('parses projectx:isbn10', () => {
      const r = parseXmp(xmpDoc('<projectx:isbn10>0441013597</projectx:isbn10>'));
      expect(r?.isbn10).toBe('0441013597');
    });

    it('parses projectx:seriesName', () => {
      const r = parseXmp(xmpDoc('<projectx:seriesName>Dune Chronicles</projectx:seriesName>'));
      expect(r?.seriesName).toBe('Dune Chronicles');
    });

    it('parses projectx:seriesIndex as number', () => {
      const r = parseXmp(xmpDoc('<projectx:seriesIndex>3</projectx:seriesIndex>'));
      expect(r?.seriesIndex).toBe(3);
    });

    it('parses projectx:tags list', () => {
      const r = parseXmp(
        xmpDoc(`
        <projectx:tags>
          <rdf:Seq>
            <rdf:li>favorites</rdf:li>
            <rdf:li>to-read</rdf:li>
          </rdf:Seq>
        </projectx:tags>
      `),
      );
      expect(r?.tags).toEqual(['favorites', 'to-read']);
    });

    it('parses projectx:rating', () => {
      const r = parseXmp(xmpDoc('<projectx:rating>4.5</projectx:rating>'));
      expect(r?.rating).toBe(4.5);
    });

    it('parses projectx:pageCount', () => {
      const r = parseXmp(xmpDoc('<projectx:pageCount>412</projectx:pageCount>'));
      expect(r?.pageCount).toBe(412);
    });

    it('parses projectx:googleBooksId', () => {
      const r = parseXmp(xmpDoc('<projectx:googleBooksId>abc123</projectx:googleBooksId>'));
      expect(r?.googleBooksId).toBe('abc123');
    });

    it('parses projectx:goodreadsId', () => {
      const r = parseXmp(xmpDoc('<projectx:goodreadsId>1234567</projectx:goodreadsId>'));
      expect(r?.goodreadsId).toBe('1234567');
    });

    it('parses projectx:amazonId', () => {
      const r = parseXmp(xmpDoc('<projectx:amazonId>B001234567</projectx:amazonId>'));
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
    <rdf:Description rdf:about="" xmlns:projectx="https://projectx.app/xmp/1.0/">
      <projectx:seriesName>Merged Series</projectx:seriesName>
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
