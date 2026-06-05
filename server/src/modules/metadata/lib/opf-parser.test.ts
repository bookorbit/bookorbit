import { parseOpf } from './opf-parser';

// Minimal valid EPUB2 OPF wrapper
function epub2Opf(metadataBody: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    ${metadataBody}
  </metadata>
</package>`;
}

function epub3Opf(metadataBody: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${metadataBody}
  </metadata>
</package>`;
}

describe('parseOpf', () => {
  describe('title', () => {
    it('parses a single title', () => {
      const r = parseOpf(epub2Opf('<dc:title>Foundation</dc:title>'));
      expect(r.title).toBe('Foundation');
    });

    it('returns null when no title element', () => {
      const r = parseOpf(epub2Opf(''));
      expect(r.title).toBeNull();
    });

    it('parses EPUB3 subtitle via title-type refinement', () => {
      const xml = epub3Opf(`
        <dc:title id="t1">Main Title</dc:title>
        <dc:title id="t2">The Subtitle</dc:title>
        <meta refines="#t2" property="title-type">subtitle</meta>
      `);
      const r = parseOpf(xml);
      expect(r.title).toBe('Main Title');
      expect(r.subtitle).toBe('The Subtitle');
    });

    it('returns null subtitle when no refinement present', () => {
      const r = parseOpf(epub2Opf('<dc:title>Only Title</dc:title>'));
      expect(r.subtitle).toBeNull();
    });

    it('uses first title as main title when multiple titles but no refinements', () => {
      const xml = epub3Opf(`
        <dc:title id="t1">First Title</dc:title>
        <dc:title id="t2">Second Title</dc:title>
      `);
      const r = parseOpf(xml);
      expect(r.title).toBe('First Title');
      expect(r.subtitle).toBeNull();
    });
  });

  describe('authors', () => {
    it('parses a single EPUB2 author with opf:role and opf:file-as', () => {
      const xml = epub2Opf(`
        <dc:creator opf:role="aut" opf:file-as="Asimov, Isaac">Isaac Asimov</dc:creator>
      `);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(1);
      expect(r.authors[0].name).toBe('Isaac Asimov');
      expect(r.authors[0].sortName).toBe('Asimov, Isaac');
    });

    it('includes creator with no role (defaults to aut)', () => {
      const xml = epub2Opf(`<dc:creator>Jane Doe</dc:creator>`);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(1);
      expect(r.authors[0].name).toBe('Jane Doe');
    });

    it('skips non-author roles (editors, illustrators)', () => {
      const xml = epub2Opf(`
        <dc:creator opf:role="aut">Author Name</dc:creator>
        <dc:creator opf:role="edt">Editor Name</dc:creator>
        <dc:creator opf:role="ill">Illustrator Name</dc:creator>
      `);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(1);
      expect(r.authors[0].name).toBe('Author Name');
    });

    it('parses multiple authors', () => {
      const xml = epub2Opf(`
        <dc:creator opf:role="aut">Author One</dc:creator>
        <dc:creator opf:role="aut">Author Two</dc:creator>
      `);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(2);
    });

    it('parses EPUB3 role and file-as via refines', () => {
      const xml = epub3Opf(`
        <dc:creator id="cr1">Terry Pratchett</dc:creator>
        <meta refines="#cr1" property="role" scheme="marc:relators">aut</meta>
        <meta refines="#cr1" property="file-as">Pratchett, Terry</meta>
      `);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(1);
      expect(r.authors[0].name).toBe('Terry Pratchett');
      expect(r.authors[0].sortName).toBe('Pratchett, Terry');
    });

    it('accepts EPUB3 role values in full relator URI form', () => {
      const xml = epub3Opf(`
        <dc:creator id="cr1">Ursula Le Guin</dc:creator>
        <meta refines="#cr1" property="role">http://id.loc.gov/vocabulary/relators/aut</meta>
      `);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(1);
      expect(r.authors[0].name).toBe('Ursula Le Guin');
    });

    it('treats uppercase EPUB2 role codes as authors', () => {
      const xml = epub2Opf(`<dc:creator opf:role="AUT">Octavia Butler</dc:creator>`);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(1);
      expect(r.authors[0].name).toBe('Octavia Butler');
    });

    it('returns empty authors array when no creators', () => {
      const r = parseOpf(epub2Opf('<dc:title>Book</dc:title>'));
      expect(r.authors).toHaveLength(0);
    });

    it('skips creator entries with empty text', () => {
      const xml = epub2Opf(`<dc:creator opf:role="aut">  </dc:creator>`);
      const r = parseOpf(xml);
      expect(r.authors).toHaveLength(0);
    });
  });

  describe('ISBN parsing', () => {
    it('detects bare ISBN-13 from unique identifier with no scheme', () => {
      const xml = epub3Opf(`<dc:identifier id="bookid">9780008337193</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.isbn13).toBe('9780008337193');
    });

    it('detects bare ISBN-10 from identifier with no scheme', () => {
      const xml = epub2Opf(`<dc:identifier id="bookid">0441013597</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.isbn10).toBe('0441013597');
    });

    it('does not treat a short numeric id with no scheme as an ISBN', () => {
      const xml = epub2Opf(`<dc:identifier id="bookid">12345</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.isbn10).toBeNull();
      expect(r.isbn13).toBeNull();
    });

    it('parses ISBN-13 from identifier with scheme isbn', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="ISBN">9780441013593</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.isbn13).toBe('9780441013593');
      expect(r.isbn10).toBeNull();
    });

    it('parses ISBN-10 from identifier', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="ISBN">0441013597</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.isbn10).toBe('0441013597');
      expect(r.isbn13).toBeNull();
    });

    it('detects ISBN from identifier value containing "isbn" prefix', () => {
      const xml = epub2Opf(`
        <dc:identifier id="uid">isbn:9780441013593</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.isbn13).toBe('9780441013593');
    });

    it('handles ISBN with hyphens', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="ISBN">978-0-441-01359-3</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.isbn13).toBe('9780441013593');
    });

    it('returns null for both ISBNs when not present', () => {
      const r = parseOpf(epub2Opf(''));
      expect(r.isbn10).toBeNull();
      expect(r.isbn13).toBeNull();
    });

    it('ignores identifier with wrong length', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="ISBN">12345</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.isbn10).toBeNull();
      expect(r.isbn13).toBeNull();
    });
  });

  describe('series', () => {
    it('parses Calibre EPUB2 series from named meta tags', () => {
      const xml = epub2Opf(`
        <meta name="calibre:series" content="The Foundation Series"/>
        <meta name="calibre:series_index" content="1"/>
      `);
      const r = parseOpf(xml);
      expect(r.seriesName).toBe('The Foundation Series');
      expect(r.seriesIndex).toBe(1);
    });

    it('parses fractional series index', () => {
      const xml = epub2Opf(`
        <meta name="calibre:series" content="Discworld"/>
        <meta name="calibre:series_index" content="1.5"/>
      `);
      const r = parseOpf(xml);
      expect(r.seriesIndex).toBe(1.5);
    });

    it('parses EPUB3 belongs-to-collection series', () => {
      const xml = epub3Opf(`
        <meta id="series" property="belongs-to-collection">Dune Chronicles</meta>
        <meta refines="#series" property="collection-type">series</meta>
        <meta refines="#series" property="group-position">1</meta>
      `);
      const r = parseOpf(xml);
      expect(r.seriesName).toBe('Dune Chronicles');
      expect(r.seriesIndex).toBe(1);
    });

    it('Calibre series takes precedence over EPUB3 belongs-to-collection', () => {
      const xml = epub3Opf(`
        <meta name="calibre:series" content="Calibre Series"/>
        <meta name="calibre:series_index" content="2"/>
        <meta property="belongs-to-collection">EPUB3 Series</meta>
      `);
      const r = parseOpf(xml);
      expect(r.seriesName).toBe('Calibre Series');
    });

    it('preserves series index 0 (valid for prequels)', () => {
      const xml = epub2Opf(`
        <meta name="calibre:series" content="Prequel Series"/>
        <meta name="calibre:series_index" content="0"/>
      `);
      const r = parseOpf(xml);
      expect(r.seriesName).toBe('Prequel Series');
      expect(r.seriesIndex).toBe(0);
    });

    it('returns null for series when not present', () => {
      const r = parseOpf(epub2Opf('<dc:title>Standalone</dc:title>'));
      expect(r.seriesName).toBeNull();
      expect(r.seriesIndex).toBeNull();
    });
  });

  describe('other metadata fields', () => {
    it('parses publisher', () => {
      const xml = epub2Opf(`<dc:publisher>Ace Books</dc:publisher>`);
      expect(parseOpf(xml).publisher).toBe('Ace Books');
    });

    it('parses language', () => {
      const xml = epub2Opf(`<dc:language>en</dc:language>`);
      expect(parseOpf(xml).language).toBe('en');
    });

    it('parses published year from date element', () => {
      const xml = epub2Opf(`<dc:date>1965-08-01</dc:date>`);
      expect(parseOpf(xml).publishedYear).toBe(1965);
    });

    it('parses year from a bare 4-digit date', () => {
      const xml = epub2Opf(`<dc:date>1951</dc:date>`);
      expect(parseOpf(xml).publishedYear).toBe(1951);
    });

    it('parses description', () => {
      const xml = epub2Opf(`<dc:description>A science fiction classic.</dc:description>`);
      expect(parseOpf(xml).description).toBe('A science fiction classic.');
    });

    it('parses genres from subject elements', () => {
      const xml = epub2Opf(`
        <dc:subject>Science Fiction</dc:subject>
        <dc:subject>Space Opera</dc:subject>
      `);
      const r = parseOpf(xml);
      expect(r.genres).toEqual(['Science Fiction', 'Space Opera']);
      expect(r.tags).toHaveLength(0);
    });

    it('returns empty tags array when no bookorbit:tags meta', () => {
      const r = parseOpf(epub2Opf(''));
      expect(r.tags).toHaveLength(0);
    });
  });

  describe('provider identifiers', () => {
    it('parses Google Books ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="GOOGLE">RPyFDwAAQBAJ</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.googleBooksId).toBe('RPyFDwAAQBAJ');
    });

    it('parses Amazon ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="AMAZON">198893706X</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.amazonId).toBe('198893706X');
    });

    it('parses Goodreads ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="GOODREADS">42129393</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.goodreadsId).toBe('42129393');
    });

    it('parses OpenLibrary ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="OPENLIBRARY">OL20652610W</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.openLibraryId).toBe('OL20652610W');
    });

    it('parses Hardcover ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="HARDCOVER">new-orleans-rush</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.hardcoverId).toBe('new-orleans-rush');
    });

    it('parses iTunes ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="ITUNES">123456789</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.itunesId).toBe('123456789');
    });

    it('parses RanobeDB ID from opf:scheme attribute', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="RANOBEDB">ranobe-1</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.ranobedbId).toBe('ranobe-1');
    });

    it('parses provider IDs from legacy urn: format (backward compat)', () => {
      const xml = epub2Opf(`
        <dc:identifier>urn:google:RPyFDwAAQBAJ</dc:identifier>
        <dc:identifier>urn:amazon:198893706X</dc:identifier>
        <dc:identifier>urn:goodreads:42129393</dc:identifier>
        <dc:identifier>urn:openlibrary:OL20652610W</dc:identifier>
        <dc:identifier>urn:ranobedb:ranobe-legacy</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.googleBooksId).toBe('RPyFDwAAQBAJ');
      expect(r.amazonId).toBe('198893706X');
      expect(r.goodreadsId).toBe('42129393');
      expect(r.openLibraryId).toBe('OL20652610W');
      expect(r.ranobedbId).toBe('ranobe-legacy');
    });

    it('opf:scheme format wins over urn: when both are present for the same provider', () => {
      // urn: appears first in document order — scheme should still win
      const xml = epub2Opf(`
        <dc:identifier>urn:google:OLD_URN_VALUE</dc:identifier>
        <dc:identifier opf:scheme="GOOGLE">SCHEME_VALUE</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.googleBooksId).toBe('SCHEME_VALUE');
    });

    it('opf:scheme wins even when urn: appears after it in document order', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="AMAZON">SCHEME_ASIN</dc:identifier>
        <dc:identifier>urn:amazon:URN_ASIN</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.amazonId).toBe('SCHEME_ASIN');
    });

    it('parses all providers together from a mixed real-world file (opf:scheme format)', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="ISBN">9781635766271</dc:identifier>
        <dc:identifier opf:scheme="GOOGLE">RPyFDwAAQBAJ</dc:identifier>
        <dc:identifier opf:scheme="AMAZON">198893706X</dc:identifier>
        <dc:identifier opf:scheme="GOODREADS">42129393</dc:identifier>
        <dc:identifier opf:scheme="OPENLIBRARY">OL20652610W</dc:identifier>
        <dc:identifier opf:scheme="RANOBEDB">ranobe-1</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.isbn13).toBe('9781635766271');
      expect(r.googleBooksId).toBe('RPyFDwAAQBAJ');
      expect(r.amazonId).toBe('198893706X');
      expect(r.goodreadsId).toBe('42129393');
      expect(r.openLibraryId).toBe('OL20652610W');
      expect(r.ranobedbId).toBe('ranobe-1');
    });

    it('is case-insensitive for opf:scheme values', () => {
      const xml = epub2Opf(`<dc:identifier opf:scheme="google">lowercaseId</dc:identifier>`);
      const r = parseOpf(xml);
      expect(r.googleBooksId).toBe('lowercaseId');
    });

    it('returns null for all provider IDs when no identifiers present', () => {
      const r = parseOpf(epub2Opf(''));
      expect(r.googleBooksId).toBeNull();
      expect(r.amazonId).toBeNull();
      expect(r.goodreadsId).toBeNull();
      expect(r.hardcoverId).toBeNull();
      expect(r.openLibraryId).toBeNull();
      expect(r.ranobedbId).toBeNull();
      expect(r.itunesId).toBeNull();
    });
  });

  describe('graceful handling of bad input', () => {
    it('returns empty result for empty metadata', () => {
      const r = parseOpf(epub2Opf(''));
      expect(r.title).toBeNull();
      expect(r.authors).toHaveLength(0);
      expect(r.tags).toHaveLength(0);
    });

    it('returns empty result for minimal valid XML', () => {
      const r = parseOpf('<package/>');
      expect(r.title).toBeNull();
      expect(r.authors).toHaveLength(0);
    });
  });
});
