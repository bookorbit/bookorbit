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

function epub2OpfFull(parts: { metadata?: string; manifest?: string; guide?: string }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    ${parts.metadata ?? ''}
  </metadata>
  ${parts.manifest != null ? `<manifest>${parts.manifest}</manifest>` : ''}
  ${parts.guide != null ? `<guide>${parts.guide}</guide>` : ''}
</package>`;
}

function epub3OpfFull(parts: { metadata?: string; manifest?: string }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${parts.metadata ?? ''}
  </metadata>
  ${parts.manifest != null ? `<manifest>${parts.manifest}</manifest>` : ''}
</package>`;
}

describe('parseOpf', () => {
  describe('custom metadata', () => {
    it('parses BookOrbit custom metadata from named and property meta tags', () => {
      const xml = epub3Opf(`
        <meta property="bookorbit:custom:original_title">Le Comte de Monte-Cristo</meta>
        <meta name="bookorbit:custom:novel_source" content="https://example.test/novel" />
        <meta property="bookorbit:custom:bad-key">Ignored</meta>
      `);

      const r = parseOpf(xml);

      expect(r.customMetadata).toEqual({
        original_title: 'Le Comte de Monte-Cristo',
        novel_source: 'https://example.test/novel',
      });
    });
  });

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

    it('parses bookorbit:tags from an EPUB3 property meta with a JSON array value', () => {
      const xml = epub3Opf(`
        <meta property="bookorbit:tags">["Science Fiction", "Classic"]</meta>
      `);
      const r = parseOpf(xml);
      expect(r.tags).toEqual(['Science Fiction', 'Classic']);
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

    it('parses Hardcover edition ID from opf:scheme, urn, and prefix formats', () => {
      expect(parseOpf(epub2Opf(`<dc:identifier opf:scheme="HARDCOVER_EDITION">8941973</dc:identifier>`)).hardcoverEditionId).toBe('8941973');
      expect(parseOpf(epub2Opf(`<dc:identifier>urn:hardcover_edition:8941974</dc:identifier>`)).hardcoverEditionId).toBe('8941974');
      expect(parseOpf(epub3Opf(`<dc:identifier>hardcover-edition:8941975</dc:identifier>`)).hardcoverEditionId).toBe('8941975');
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

    it('normalizes urn-prefixed provider IDs when opf:scheme is present', () => {
      const xml = epub2Opf(`
        <dc:identifier opf:scheme="GOOGLE">urn:google:RPyFDwAAQBAJ</dc:identifier>
        <dc:identifier opf:scheme="AMAZON">urn:amazon:0345415000</dc:identifier>
        <dc:identifier opf:scheme="GOODREADS">urn:goodreads:42129393</dc:identifier>
        <dc:identifier opf:scheme="HARDCOVER">urn:hardcover:new-orleans-rush</dc:identifier>
        <dc:identifier opf:scheme="OPENLIBRARY">urn:openlibrary:OL20652610W</dc:identifier>
        <dc:identifier opf:scheme="RANOBEDB">urn:ranobedb:ranobe-legacy</dc:identifier>
        <dc:identifier opf:scheme="KOBO">urn:kobo:kobo-123</dc:identifier>
        <dc:identifier opf:scheme="LUBIMYCZYTAC">urn:lubimyczytac:lub-99999</dc:identifier>
        <dc:identifier opf:scheme="ALADIN">urn:aladin:9791190090018</dc:identifier>
        <dc:identifier opf:scheme="ITUNES">urn:itunes:123456789</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.googleBooksId).toBe('RPyFDwAAQBAJ');
      expect(r.amazonId).toBe('0345415000');
      expect(r.goodreadsId).toBe('42129393');
      expect(r.hardcoverId).toBe('new-orleans-rush');
      expect(r.openLibraryId).toBe('OL20652610W');
      expect(r.ranobedbId).toBe('ranobe-legacy');
      expect(r.koboId).toBe('kobo-123');
      expect(r.lubimyczytacId).toBe('lub-99999');
      expect(r.aladinId).toBe('9791190090018');
      expect(r.itunesId).toBe('123456789');
    });

    it('normalizes the real-world Amazon URN value that exceeds the amazon_id column when untrimmed', () => {
      const r = parseOpf(epub2Opf(`<dc:identifier opf:scheme="AMAZON">urn:amazon:0345415000</dc:identifier>`));
      expect(r.amazonId).toBe('0345415000');
      expect(r.amazonId).toHaveLength(10);
    });

    it('normalizes provider URN prefixes case-insensitively', () => {
      const xml = epub2Opf(`
        <dc:identifier>URN:GOOGLE:CaseSensitiveGoogleId</dc:identifier>
        <dc:identifier>URN:AMAZON:B0G3YRNY6Y</dc:identifier>
      `);
      const r = parseOpf(xml);
      expect(r.googleBooksId).toBe('CaseSensitiveGoogleId');
      expect(r.amazonId).toBe('B0G3YRNY6Y');
    });

    it('normalizes Amazon alias prefixes when opf:scheme is present', () => {
      expect(parseOpf(epub2Opf(`<dc:identifier opf:scheme="AMAZON">amazon:B0G3YRNY6Y</dc:identifier>`)).amazonId).toBe('B0G3YRNY6Y');
      expect(parseOpf(epub2Opf(`<dc:identifier opf:scheme="AMAZON">asin:B0G3YRNY6Y</dc:identifier>`)).amazonId).toBe('B0G3YRNY6Y');
      expect(parseOpf(epub2Opf(`<dc:identifier opf:scheme="AMAZON">mobi-asin:B0ABCDEFGH</dc:identifier>`)).amazonId).toBe('B0ABCDEFGH');
    });

    it('opf:scheme format wins over urn: when both are present for the same provider', () => {
      // urn: appears first in document order; scheme should still win.
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
      expect(r.hardcoverEditionId).toBeNull();
      expect(r.openLibraryId).toBeNull();
      expect(r.ranobedbId).toBeNull();
      expect(r.itunesId).toBeNull();
    });

    describe('Calibre prefix:value identifiers (opf3 fallback)', () => {
      it('parses every known provider prefix from bare prefix:value text', () => {
        const xml = epub3Opf(`
          <dc:identifier>amazon:B0G3YRNY6Y</dc:identifier>
          <dc:identifier>goodreads:244564568</dc:identifier>
          <dc:identifier>google:ABCD1234</dc:identifier>
          <dc:identifier>openlibrary:OL99999999W</dc:identifier>
          <dc:identifier>hardcover:test-book-slug</dc:identifier>
          <dc:identifier>hardcover_edition:8941973</dc:identifier>
          <dc:identifier>kobo:test-kobo-id</dc:identifier>
          <dc:identifier>itunes:987654321</dc:identifier>
          <dc:identifier>lubimyczytac:lub-99999</dc:identifier>
          <dc:identifier>ranobedb:ranobe-999</dc:identifier>
        `);
        const r = parseOpf(xml);
        expect(r.amazonId).toBe('B0G3YRNY6Y');
        expect(r.goodreadsId).toBe('244564568');
        expect(r.googleBooksId).toBe('ABCD1234');
        expect(r.openLibraryId).toBe('OL99999999W');
        expect(r.hardcoverId).toBe('test-book-slug');
        expect(r.hardcoverEditionId).toBe('8941973');
        expect(r.koboId).toBe('test-kobo-id');
        expect(r.itunesId).toBe('987654321');
        expect(r.lubimyczytacId).toBe('lub-99999');
        expect(r.ranobedbId).toBe('ranobe-999');
      });

      it('maps both asin: and mobi-asin: to amazonId', () => {
        expect(parseOpf(epub3Opf(`<dc:identifier>asin:B0G3YRNY6Y</dc:identifier>`)).amazonId).toBe('B0G3YRNY6Y');
        expect(parseOpf(epub3Opf(`<dc:identifier>mobi-asin:B0ABCDEFGH</dc:identifier>`)).amazonId).toBe('B0ABCDEFGH');
      });

      it('lets opf:scheme win over prefix:value for the same provider', () => {
        const xml = epub2Opf(`
          <dc:identifier>amazon:PREFIX_ASIN</dc:identifier>
          <dc:identifier opf:scheme="AMAZON">SCHEME_ASIN</dc:identifier>
        `);
        expect(parseOpf(xml).amazonId).toBe('SCHEME_ASIN');
      });

      it('lets urn: win over prefix:value for the same provider', () => {
        const xml = epub2Opf(`
          <dc:identifier>amazon:PREFIX_ASIN</dc:identifier>
          <dc:identifier>urn:amazon:URN_ASIN</dc:identifier>
        `);
        expect(parseOpf(xml).amazonId).toBe('URN_ASIN');
      });

      it('uses prefix:value only as a fallback when scheme and urn are absent', () => {
        const xml = epub3Opf(`<dc:identifier>amazon:ONLY_PREFIX</dc:identifier>`);
        expect(parseOpf(xml).amazonId).toBe('ONLY_PREFIX');
      });

      it('ignores unknown prefixes', () => {
        const xml = epub3Opf(`
          <dc:identifier>uuid:123e4567-e89b-12d3-a456-426614174000</dc:identifier>
          <dc:identifier>calibre:12345</dc:identifier>
          <dc:identifier>doi:10.1000/xyz123</dc:identifier>
        `);
        const r = parseOpf(xml);
        expect(r.amazonId).toBeNull();
        expect(r.googleBooksId).toBeNull();
        expect(r.goodreadsId).toBeNull();
        expect(r.openLibraryId).toBeNull();
      });

      it('still parses isbn:VALUE as an ISBN, not a provider id', () => {
        const r = parseOpf(epub3Opf(`<dc:identifier>isbn:9780441013593</dc:identifier>`));
        expect(r.isbn13).toBe('9780441013593');
        expect(r.amazonId).toBeNull();
        expect(r.googleBooksId).toBeNull();
      });

      it('splits on the first colon only, keeping colons in the id', () => {
        const r = parseOpf(epub3Opf(`<dc:identifier>hardcover:some:slug</dc:identifier>`));
        expect(r.hardcoverId).toBe('some:slug');
      });

      it('matches the prefix case-insensitively while preserving the id case', () => {
        const r = parseOpf(epub3Opf(`<dc:identifier>AMAZON:B0G3YRNY6Y</dc:identifier>`));
        expect(r.amazonId).toBe('B0G3YRNY6Y');
      });

      it('ignores a known prefix with an empty value', () => {
        const r = parseOpf(epub3Opf(`<dc:identifier>amazon:</dc:identifier>`));
        expect(r.amazonId).toBeNull();
      });

      it('ignores a bare identifier with no colon', () => {
        const r = parseOpf(epub3Opf(`<dc:identifier>SOMEBAREID</dc:identifier>`));
        expect(r.amazonId).toBeNull();
        expect(r.googleBooksId).toBeNull();
      });

      it('parses a full real-world Calibre 9.x opf3 identifier block', () => {
        const xml = epub3Opf(`
          <dc:identifier>urn:uuid:5f3c2b1a-0000-4444-8888-aaaabbbbcccc</dc:identifier>
          <dc:identifier>amazon:B0G3YRNY6Y</dc:identifier>
          <dc:identifier>goodreads:244564568</dc:identifier>
          <dc:identifier>google:ABCD1234</dc:identifier>
        `);
        const r = parseOpf(xml);
        expect(r.amazonId).toBe('B0G3YRNY6Y');
        expect(r.goodreadsId).toBe('244564568');
        expect(r.googleBooksId).toBe('ABCD1234');
      });
    });
  });

  describe('Calibre user_metadata (pageCount & subtitle)', () => {
    it('parses page count from a #pagecount custom column', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#pagecount":{"#value#":353}}</meta>`);
      expect(parseOpf(xml).pageCount).toBe(353);
    });

    it('parses page count from a #page_count custom column', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#page_count":{"#value#":400}}</meta>`);
      expect(parseOpf(xml).pageCount).toBe(400);
    });

    it('parses a string numeric page count value', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#page_count":{"#value#":"400"}}</meta>`);
      expect(parseOpf(xml).pageCount).toBe(400);
    });

    it('parses subtitle from a #subtitle custom column', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#subtitle":{"#value#":"A Subtitle"}}</meta>`);
      expect(parseOpf(xml).subtitle).toBe('A Subtitle');
    });

    it('parses page count and subtitle together from one blob (issue sample)', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#pagecount":{"#value#":353},"#subtitle":{"#value#":"TEST-SUBTITLE"}}</meta>`);
      const r = parseOpf(xml);
      expect(r.pageCount).toBe(353);
      expect(r.subtitle).toBe('TEST-SUBTITLE');
    });

    it('prefers bookorbit:page_count over the Calibre user_metadata page count', () => {
      const xml = epub3Opf(`
        <meta property="bookorbit:page_count">100</meta>
        <meta property="calibre:user_metadata">{"#pagecount":{"#value#":353}}</meta>
      `);
      expect(parseOpf(xml).pageCount).toBe(100);
    });

    it('prefers the EPUB3 title-type subtitle over the Calibre user_metadata subtitle', () => {
      const xml = epub3Opf(`
        <dc:title id="t1">Main Title</dc:title>
        <dc:title id="t2">Real Subtitle</dc:title>
        <meta refines="#t2" property="title-type">subtitle</meta>
        <meta property="calibre:user_metadata">{"#subtitle":{"#value#":"Calibre Subtitle"}}</meta>
      `);
      expect(parseOpf(xml).subtitle).toBe('Real Subtitle');
    });

    it('ignores a malformed user_metadata JSON blob without throwing', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{not valid json}</meta>`);
      const r = parseOpf(xml);
      expect(r.pageCount).toBeNull();
      expect(r.subtitle).toBeNull();
    });

    it('ignores a zero or negative page count value', () => {
      expect(parseOpf(epub3Opf(`<meta property="calibre:user_metadata">{"#pagecount":{"#value#":0}}</meta>`)).pageCount).toBeNull();
      expect(parseOpf(epub3Opf(`<meta property="calibre:user_metadata">{"#pagecount":{"#value#":-5}}</meta>`)).pageCount).toBeNull();
    });

    it('ignores a non-string subtitle value', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#subtitle":{"#value#":42}}</meta>`);
      expect(parseOpf(xml).subtitle).toBeNull();
    });

    it('leaves fields null when the blob has only unrelated columns', () => {
      const xml = epub3Opf(`<meta property="calibre:user_metadata">{"#myrating":{"#value#":5}}</meta>`);
      const r = parseOpf(xml);
      expect(r.pageCount).toBeNull();
      expect(r.subtitle).toBeNull();
    });

    it('ignores a blob that is a JSON array rather than an object', () => {
      const r = parseOpf(epub3Opf(`<meta property="calibre:user_metadata">[1,2,3]</meta>`));
      expect(r.pageCount).toBeNull();
      expect(r.subtitle).toBeNull();
    });

    it('ignores a column whose value is not an object with a #value# key', () => {
      const r = parseOpf(epub3Opf(`<meta property="calibre:user_metadata">{"#pagecount":353,"#subtitle":{}}</meta>`));
      expect(r.pageCount).toBeNull();
      expect(r.subtitle).toBeNull();
    });

    it('ignores a non-numeric page count value', () => {
      const r = parseOpf(epub3Opf(`<meta property="calibre:user_metadata">{"#pagecount":{"#value#":"lots"}}</meta>`));
      expect(r.pageCount).toBeNull();
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

  describe('coverHref', () => {
    it('returns null when no guide, manifest cover-image, or calibre cover meta is present', () => {
      const r = parseOpf(epub2Opf('<dc:title>No Cover</dc:title>'));
      expect(r.coverHref).toBeNull();
    });

    it('extracts href from EPUB2 guide reference with type="cover"', () => {
      const xml = epub2OpfFull({
        metadata: '<dc:title>Test</dc:title>',
        guide: '<reference type="cover" title="Cover" href="cover.jpg"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('cover.jpg');
    });

    it('is case-insensitive for the guide reference type attribute', () => {
      const xml = epub2OpfFull({
        guide: '<reference type="Cover" href="COVER.JPG"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('COVER.JPG');
    });

    it('ignores guide references whose type is not "cover"', () => {
      const xml = epub2OpfFull({
        guide: '<reference type="toc" href="toc.html"/>',
      });
      expect(parseOpf(xml).coverHref).toBeNull();
    });

    it('skips guide references with an empty href and continues to next source', () => {
      const xml = epub2OpfFull({
        guide: '<reference type="cover" href=""/>',
        manifest: '<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('images/cover.jpg');
    });

    it('extracts href from EPUB3 manifest item with properties="cover-image"', () => {
      const xml = epub3OpfFull({
        manifest: '<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('images/cover.jpg');
    });

    it('extracts href when "cover-image" is one of multiple space-separated manifest item properties', () => {
      const xml = epub3OpfFull({
        manifest: '<item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image mathml"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('cover.png');
    });

    it('resolves Calibre meta name="cover" through manifest item id lookup', () => {
      const xml = epub2OpfFull({
        metadata: '<meta name="cover" content="cover-image-id"/>',
        manifest: '<item id="cover-image-id" href="images/cover.jpg" media-type="image/jpeg"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('images/cover.jpg');
    });

    it('returns null when Calibre cover meta points to a manifest item id that does not exist', () => {
      const xml = epub2OpfFull({
        metadata: '<meta name="cover" content="missing-id"/>',
        manifest: '<item id="other-id" href="other.jpg" media-type="image/jpeg"/>',
      });
      expect(parseOpf(xml).coverHref).toBeNull();
    });

    it('guide reference takes priority over EPUB3 manifest cover-image', () => {
      const xml = epub2OpfFull({
        manifest: '<item id="cover-img" href="manifest-cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
        guide: '<reference type="cover" href="guide-cover.jpg"/>',
      });
      expect(parseOpf(xml).coverHref).toBe('guide-cover.jpg');
    });

    it('manifest cover-image takes priority over Calibre meta lookup', () => {
      const xml = epub3OpfFull({
        metadata: '<meta name="cover" content="calibre-img"/>',
        manifest: `
          <item id="calibre-img" href="calibre-cover.jpg" media-type="image/jpeg"/>
          <item id="epub3-cover" href="epub3-cover.jpg" media-type="image/jpeg" properties="cover-image"/>
        `,
      });
      expect(parseOpf(xml).coverHref).toBe('epub3-cover.jpg');
    });
  });
});
