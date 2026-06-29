import { XMLParser } from 'fast-xml-parser';

import { OpdsService } from '../opds.service';
import type { OpdsBookEntry } from '../opds-book.service';

function makeService() {
  return new OpdsService();
}

const BASE = '/api/v1/opds';

function sampleBook(overrides?: Partial<OpdsBookEntry>): OpdsBookEntry {
  return {
    id: 1,
    title: 'Mistborn: The Final Empire',
    folderPath: '/books/mistborn',
    addedAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
    description: 'A fantasy novel by Brandon Sanderson',
    seriesId: 1,
    seriesName: 'Mistborn',
    seriesIndex: 1,
    language: 'en',
    publisher: 'Tor Books',
    isbn13: '9780765311788',
    hasCover: true,
    authors: ['Brandon Sanderson'],
    files: [{ id: 10, format: 'epub' }],
    ...overrides,
  };
}

describe('OpdsService', () => {
  describe('generateRootNavigation', () => {
    it('produces valid OPDS navigation XML', () => {
      const service = makeService();
      const xml = service.generateRootNavigation();

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
      expect(xml).toContain('<title>bookorbit OPDS Catalog</title>');
      expect(xml).toContain('<id>urn:bookorbit:root</id>');
    });

    it('contains all expected navigation entries', () => {
      const service = makeService();
      const xml = service.generateRootNavigation();

      expect(xml).toContain('All Books');
      expect(xml).toContain('Recent Books');
      expect(xml).toContain('Random Books');
      expect(xml).toContain('Libraries');
      expect(xml).toContain('Collections');
      expect(xml).toContain('SmartScopes');
      expect(xml).toContain('Authors');
      expect(xml).toContain('Series');
    });

    it('includes search link', () => {
      const service = makeService();
      const xml = service.generateRootNavigation();
      expect(xml).toContain(`href="${BASE}/search.opds"`);
    });

    it('uses relative paths for all links', () => {
      const service = makeService();
      const xml = service.generateRootNavigation();
      expect(xml).not.toContain('http://localhost');
      expect(xml).toContain(`href="${BASE}"`);
      expect(xml).toContain(`href="${BASE}/catalog"`);
    });
  });

  describe('generateLibrariesNavigation', () => {
    it('generates entries for each library', () => {
      const service = makeService();
      const xml = service.generateLibrariesNavigation([
        { id: 1, name: 'Fiction', bookCount: 42 },
        { id: 2, name: 'Non-Fiction', bookCount: 13 },
      ]);

      expect(xml).toContain('<title>Fiction</title>');
      expect(xml).toContain('42 books');
      expect(xml).toContain(`${BASE}/catalog?libraryId=1`);
      expect(xml).toContain('<title>Non-Fiction</title>');
    });

    it('handles empty libraries list', () => {
      const service = makeService();
      const xml = service.generateLibrariesNavigation([]);
      expect(xml).toContain('<title>Libraries</title>');
      expect(xml).not.toContain('<entry>');
    });
  });

  describe('generateCollectionsNavigation', () => {
    it('generates entries for each collection', () => {
      const service = makeService();
      const xml = service.generateCollectionsNavigation([{ id: 5, name: 'Favorites', bookCount: 7 }]);

      expect(xml).toContain('<title>Favorites</title>');
      expect(xml).toContain(`${BASE}/catalog?collectionId=5`);
    });
  });

  describe('generateAuthorsNavigation', () => {
    it('URL-encodes author names', () => {
      const service = makeService();
      const xml = service.generateAuthorsNavigation([{ name: 'J.R.R. Tolkien', bookCount: 12 }]);

      expect(xml).toContain('<title>J.R.R. Tolkien</title>');
      expect(xml).toContain(encodeURIComponent('J.R.R. Tolkien'));
    });
  });

  describe('generateSeriesNavigation', () => {
    it('URL-encodes series names', () => {
      const service = makeService();
      const xml = service.generateSeriesNavigation([{ name: 'The Lord of the Rings', bookCount: 3 }]);

      expect(xml).toContain(encodeURIComponent('The Lord of the Rings'));
    });

    it('uses stable series ids when available', () => {
      const service = makeService();
      const xml = service.generateSeriesNavigation([{ id: 42, name: 'The Lord of the Rings', bookCount: 3 }]);

      expect(xml).toContain('urn:bookorbit:series:42');
      expect(xml).toContain(`${BASE}/catalog?seriesId=42`);
      expect(xml).not.toContain('catalog?series=The%20Lord%20of%20the%20Rings');
    });
  });

  describe('generateAcquisitionFeed', () => {
    it('includes book entry with title, author, and acquisition link', () => {
      const service = makeService();
      const book = sampleBook();
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain('<title>Mistborn: The Final Empire</title>');
      expect(xml).toContain('<name>Brandon Sanderson</name>');
      expect(xml).toContain('application/epub+zip');
      expect(xml).toContain('http://opds-spec.org/acquisition');
    });

    it('includes cover and thumbnail links with relative paths', () => {
      const service = makeService();
      const book = sampleBook();
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain(`${BASE}/1/cover`);
      expect(xml).toContain(`${BASE}/1/thumbnail`);
      expect(xml).toContain('http://opds-spec.org/image"');
      expect(xml).toContain('http://opds-spec.org/image/thumbnail"');
      expect(xml).not.toMatch(/href="http:\/\/localhost/);
    });

    it('omits cover and thumbnail links when hasCover is false', () => {
      const service = makeService();
      const book = sampleBook({ hasCover: false });
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).not.toContain('http://opds-spec.org/image');
      expect(xml).not.toContain(`${BASE}/1/cover`);
      expect(xml).not.toContain(`${BASE}/1/thumbnail`);
    });

    it('includes series link when seriesName is set', () => {
      const service = makeService();
      const book = sampleBook();
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain('Mistborn #1');
      expect(xml).toContain(`${BASE}/catalog?seriesId=1`);
    });

    it('omits series link when seriesName is null', () => {
      const service = makeService();
      const book = sampleBook({ seriesId: null, seriesName: null, seriesIndex: null });
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).not.toContain('http://opds-spec.org/sort/series');
    });

    it('includes Dublin Core metadata', () => {
      const service = makeService();
      const book = sampleBook();
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain('<dc:language>en</dc:language>');
      expect(xml).toContain('<dc:publisher>Tor Books</dc:publisher>');
      expect(xml).toContain('urn:isbn:9780765311788');
    });

    it('includes totalResults element', () => {
      const service = makeService();
      const xml = service.generateAcquisitionFeed('Catalog', 'urn:bookorbit:catalog', [], 42, 1, 50, `${BASE}/catalog?page=1&size=50`, 'test-token');

      expect(xml).toContain('<opensearch:totalResults>42</opensearch:totalResults>');
    });

    it('adds pagination links for multi-page results', () => {
      const service = makeService();
      const xml = service.generateAcquisitionFeed('Catalog', 'urn:bookorbit:catalog', [], 100, 2, 10, `${BASE}/catalog?size=10&page=2`, 'test-token');

      expect(xml).toContain('rel="previous"');
      expect(xml).toContain('rel="next"');
      expect(xml).toContain('rel="first"');
      expect(xml).toContain('rel="last"');
    });

    it('generates correct pagination URLs', () => {
      const service = makeService();
      const xml = service.generateAcquisitionFeed('Catalog', 'urn:bookorbit:catalog', [], 100, 2, 10, `${BASE}/catalog?size=10&page=2`, 'test-token');

      expect(xml).toContain(`${BASE}/catalog?size=10&amp;page=1`);
      expect(xml).toContain(`${BASE}/catalog?size=10&amp;page=3`);
      expect(xml).toContain(`${BASE}/catalog?size=10&amp;page=10`);
    });

    it('generates correct pagination URLs with filters', () => {
      const service = makeService();
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [],
        100,
        2,
        10,
        `${BASE}/catalog?libraryId=5&page=2&size=10`,
        'test-token',
      );

      expect(xml).toContain('libraryId=5');
      expect(xml).toContain('page=3');
      expect(xml).not.toMatch(/page=2&amp;page=/);
    });

    it('omits previous/first links on page 1', () => {
      const service = makeService();
      const xml = service.generateAcquisitionFeed('Catalog', 'urn:bookorbit:catalog', [], 100, 1, 10, `${BASE}/catalog?size=10&page=1`, 'test-token');

      expect(xml).not.toContain('rel="previous"');
      expect(xml).not.toContain('rel="first"');
      expect(xml).toContain('rel="next"');
    });

    it('omits next/last links on last page', () => {
      const service = makeService();
      const xml = service.generateAcquisitionFeed('Catalog', 'urn:bookorbit:catalog', [], 20, 2, 10, `${BASE}/catalog?size=10&page=2`, 'test-token');

      expect(xml).not.toContain('rel="next"');
      expect(xml).not.toContain('rel="last"');
      expect(xml).toContain('rel="previous"');
    });

    it('handles multiple file formats per book', () => {
      const service = makeService();
      const book = sampleBook({
        files: [
          { id: 10, format: 'epub' },
          { id: 11, format: 'pdf' },
        ],
      });
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain('application/epub+zip');
      expect(xml).toContain('application/pdf');
      expect(xml).toContain('fileId=10');
      expect(xml).toContain('fileId=11');
    });
  });

  describe('generateOpenSearchDescription', () => {
    it('produces valid OpenSearch XML with search template', () => {
      const service = makeService();
      const xml = service.generateOpenSearchDescription();

      expect(xml).toContain('<OpenSearchDescription');
      expect(xml).toContain('<ShortName>bookorbit OPDS</ShortName>');
      expect(xml).toContain('{searchTerms}');
      expect(xml).toContain(`${BASE}/catalog?q={searchTerms}`);
    });
  });

  describe('feed well-formedness (issue #260)', () => {
    // XML 1.0 Char production forbids every code point below 0x20 except tab/LF/CR,
    // plus the noncharacters U+FFFE/U+FFFF. A feed carrying any of these is not
    // well-formed, and lenient OPDS clients (e.g. KOReader) recover by shifting
    // entry boundaries, pairing one entry's title with a neighbouring entry's
    // acquisition link, which downloads the wrong book.
    /* eslint-disable no-control-regex -- detecting these characters is the purpose of this matcher */
    const XML_1_0_INVALID = new RegExp(
      '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]',
    );
    /* eslint-enable no-control-regex */

    function acquisitionHref(entry: Record<string, unknown>): string {
      const links = entry.link as Array<Record<string, string>>;
      const acq = links.find((link) => link['@_rel'] === 'http://opds-spec.org/acquisition');
      return acq!['@_href'];
    }

    it('strips control characters from metadata so each title keeps its own download link', () => {
      const service = makeService();

      // Recent feed, newest first. "Children of Dune" was imported just before
      // "Empire of AI"; its extracted metadata carries the exact junk that
      // corrupted the feed in issue #260: a vertical tab and a lone surrogate in
      // the title, and a NUL in the description.
      const empire = sampleBook({
        id: 501,
        title: 'Empire of AI',
        description: 'How AI was built',
        seriesName: null,
        seriesIndex: null,
        files: [{ id: 9001, format: 'epub' }],
      });
      const children = sampleBook({
        id: 500,
        title: 'Children of Dune\u000B\uD800',
        description: 'Book three of the Dune\u0000 Chronicles',
        seriesName: null,
        seriesIndex: null,
        files: [{ id: 9000, format: 'epub' }],
      });

      const xml = service.generateAcquisitionFeed(
        'Recent Books',
        'urn:bookorbit:recent',
        [empire, children],
        2,
        1,
        50,
        `${BASE}/recent?page=1&size=50`,
        'test-token',
      );

      expect(XML_1_0_INVALID.test(xml)).toBe(false);

      const parsed = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'entry' || name === 'link' }).parse(xml);
      const entries = parsed.feed.entry as Array<Record<string, unknown>>;
      const byTitle = new Map(entries.map((entry) => [entry.title, entry]));

      expect(acquisitionHref(byTitle.get('Empire of AI')!)).toContain('/501/download?fileId=9001');
      expect(acquisitionHref(byTitle.get('Children of Dune')!)).toContain('/500/download?fileId=9000');
    });

    it('produces well-formed entries when titles, authors, and publisher contain control characters', () => {
      const service = makeService();
      const book = sampleBook({
        title: 'Bad \u000BTitle',
        authors: ['Jane\u0000 Doe'],
        publisher: 'Acme\u001F Press',
      });

      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(XML_1_0_INVALID.test(xml)).toBe(false);
      expect(xml).toContain('<title>Bad Title</title>');
      expect(xml).toContain('<name>Jane Doe</name>');
      expect(xml).toContain('<dc:publisher>Acme Press</dc:publisher>');
    });
  });

  describe('XML escaping', () => {
    it('escapes special characters in titles', () => {
      const service = makeService();
      const book = sampleBook({ title: 'Rock & Roll <Vol. 1> "Greatest"' });
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      expect(xml).toContain('&quot;');
      expect(xml).not.toContain('<Vol. 1>');
    });

    it('escapes special characters in author names', () => {
      const service = makeService();
      const book = sampleBook({ authors: ["O'Brien & Sons"] });
      const xml = service.generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?page=1&size=50`,
        'test-token',
      );

      expect(xml).toContain('&amp;');
      expect(xml).toContain('&apos;');
    });
  });
});
