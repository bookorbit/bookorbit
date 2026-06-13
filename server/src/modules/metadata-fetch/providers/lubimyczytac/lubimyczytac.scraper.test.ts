import {
  buildLubimyczytacBookUrl,
  buildLubimyczytacSearchUrl,
  extractLubimyczytacId,
  extractLubimyczytacPath,
  extractLubimyczytacSearchResults,
  parseLubimyczytacBookPage,
} from './lubimyczytac.scraper';

const BOOK_HTML = `
  <h1 class="book__title">Ostatnie życzenie</h1>
  <div class="book-cover"><img src="/upload/books/cover.jpg" /></div>
  <a href="/wydawnictwo/123/superNowa">superNOWA</a>
  <dl>
    <dt>Język:</dt><dd>polski</dd>
  </dl>
  <div class="book__description text-collapse">Opis książki o wiedźminie Geralcie.</div>
  <meta property="books:isbn" content="978-83-7578-063-5" />
  <a class="book__category d-sm-block d-none" href="/ksiazki/k/64/fantasy-fantastyka">Fantasy, fantastyka</a>
  <span class="d-none d-sm-block mt-1">Cykl: Wiedźmin (tom 1)</span>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Book",
    "name": "Ostatnie życzenie",
    "numberOfPages": 330,
    "datePublished": "2014-05-12",
    "author": [{ "@type": "Person", "name": "Andrzej Sapkowski" }],
    "genre": "https://lubimyczytac.pl/ksiazki/k/64/fantasy-fantastyka"
  }
  </script>
`;

describe('LubimyczytacScraper', () => {
  describe('buildLubimyczytacSearchUrl', () => {
    it('encodes phrase and author', () => {
      const url = buildLubimyczytacSearchUrl('Wiedźmin', 'Andrzej Sapkowski');
      expect(url).toContain('https://lubimyczytac.pl/szukaj/ksiazki');
      expect(url).toContain('phrase=Wied%C5%BAmin');
      expect(url).toContain('author=Andrzej+Sapkowski');
    });

    it('omits author when not provided', () => {
      expect(buildLubimyczytacSearchUrl('Lalka')).not.toContain('author=');
    });
  });

  describe('extractLubimyczytacId', () => {
    it('extracts the numeric id from a book url', () => {
      expect(extractLubimyczytacId('https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie')).toBe('123456');
      expect(extractLubimyczytacId('/ksiazka/789012')).toBe('789012');
    });

    it('accepts a bare numeric id', () => {
      expect(extractLubimyczytacId('4815162342')).toBe('4815162342');
    });

    it('returns undefined for non-book urls', () => {
      expect(extractLubimyczytacId('https://lubimyczytac.pl/autor/123/foo')).toBeUndefined();
    });
  });

  describe('extractLubimyczytacPath', () => {
    it('keeps the id and slug as the canonical path', () => {
      expect(extractLubimyczytacPath('https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie')).toBe('123456/ostatnie-zyczenie');
      expect(extractLubimyczytacPath('/ksiazka/789012/x?ref=1')).toBe('789012/x');
      expect(extractLubimyczytacPath('123456/ostatnie-zyczenie')).toBe('123456/ostatnie-zyczenie');
    });

    it('returns the bare id when no slug is present', () => {
      expect(extractLubimyczytacPath('/ksiazka/789012')).toBe('789012');
    });
  });

  describe('buildLubimyczytacBookUrl', () => {
    it('builds a url from an id/slug path', () => {
      expect(buildLubimyczytacBookUrl('123456/ostatnie-zyczenie')).toBe('https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie');
    });

    it('appends a placeholder slug for a bare numeric id (slug-less urls 404)', () => {
      expect(buildLubimyczytacBookUrl('123456')).toBe('https://lubimyczytac.pl/ksiazka/123456/-');
    });
  });

  describe('extractLubimyczytacSearchResults', () => {
    it('extracts unique book links from search results', () => {
      const html = `
        <div class="book-card">
          <a class="book-card__cover-link" href="/ksiazka/123456/ostatnie-zyczenie"><img /></a>
          <a class="book-card__title" href="/ksiazka/123456/ostatnie-zyczenie">Ostatnie życzenie</a>
        </div>
        <div class="book-card">
          <a class="book-card__title" href="https://lubimyczytac.pl/ksiazka/789012/miecz-przeznaczenia">Miecz przeznaczenia</a>
        </div>
      `;
      const results = extractLubimyczytacSearchResults(html, 5);
      expect(results).toEqual([
        { providerId: '123456/ostatnie-zyczenie', url: 'https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie' },
        { providerId: '789012/miecz-przeznaczenia', url: 'https://lubimyczytac.pl/ksiazka/789012/miecz-przeznaczenia' },
      ]);
    });

    it('falls back to the legacy authorAllBooks layout', () => {
      const html = `
        <div class="authorAllBooks__single">
          <a class="authorAllBooks__singleTextTitle" href="/ksiazka/555/legacy">Legacy</a>
        </div>
      `;
      expect(extractLubimyczytacSearchResults(html, 5)).toEqual([{ providerId: '555/legacy', url: 'https://lubimyczytac.pl/ksiazka/555/legacy' }]);
    });

    it('respects the limit', () => {
      const html = `
        <a class="book-card__title" href="/ksiazka/1/a">A</a>
        <a class="book-card__title" href="/ksiazka/2/b">B</a>
      `;
      expect(extractLubimyczytacSearchResults(html, 1)).toHaveLength(1);
    });
  });

  describe('parseLubimyczytacBookPage', () => {
    it('parses a complete book page', () => {
      const data = parseLubimyczytacBookPage(BOOK_HTML, 'https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie');
      expect(data.providerId).toBe('123456/ostatnie-zyczenie');
      expect(data.title).toBe('Ostatnie życzenie');
      expect(data.authors).toEqual(['Andrzej Sapkowski']);
      expect(data.description).toBe('Opis książki o wiedźminie Geralcie.');
      expect(data.publisher).toBe('superNOWA');
      expect(data.language).toBe('pl');
      expect(data.pageCount).toBe(330);
      expect(data.publishedYear).toBe(2014);
      expect(data.isbn13).toBe('9788375780635');
      expect(data.seriesName).toBe('Wiedźmin');
      expect(data.seriesIndex).toBe(1);
      expect(data.genres).toEqual(['Fantasy', 'fantastyka']);
      expect(data.coverUrl).toBe('https://lubimyczytac.pl/upload/books/cover.jpg');
    });

    it('falls back to the json-ld genre slug when no tags are present', () => {
      const html = `
        <h1 class="book__title">Bez tagów</h1>
        <script type="application/ld+json">
        { "@type": "Book", "genre": "https://lubimyczytac.pl/ksiazki/k/69/poradniki" }
        </script>
      `;
      expect(parseLubimyczytacBookPage(html).genres).toEqual(['poradniki']);
    });

    it('parses the series index from a trailing volume number', () => {
      const html = `
        <h1 class="book__title">Uwikłana</h1>
        <span class="d-none d-sm-block mt-1">Cykl: <a href="/cykl/1/x">Komisarz Tymon Hanter 4</a></span>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.seriesName).toBe('Komisarz Tymon Hanter');
      expect(data.seriesIndex).toBe(4);
    });

    it('returns no title for an empty page', () => {
      expect(parseLubimyczytacBookPage('<html><body></body></html>').title).toBeUndefined();
    });

    it('derives providerId from canonical url in json-ld', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">
        { "@type": "Book", "url": "https://lubimyczytac.pl/ksiazka/999/canonical-slug" }
        </script>
      `;
      expect(parseLubimyczytacBookPage(html).providerId).toBe('999/canonical-slug');
    });

    it('derives providerId from sourceUrl when no canonical url in json-ld', () => {
      const html = `<h1 class="book__title">Test</h1>`;
      expect(parseLubimyczytacBookPage(html, 'https://lubimyczytac.pl/ksiazka/777/from-source').providerId).toBe('777/from-source');
    });

    it('returns undefined providerId when called without sourceUrl and no json-ld url', () => {
      const html = `<h1 class="book__title">Test</h1>`;
      expect(parseLubimyczytacBookPage(html).providerId).toBeUndefined();
    });

    it('handles invalid JSON in ld+json script gracefully', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ broken json }</script>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.title).toBe('Test');
      expect(data.pageCount).toBeUndefined();
    });

    it('parses numberOfPages from a string value in json-ld', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": "330" }</script>
      `;
      expect(parseLubimyczytacBookPage(html).pageCount).toBe(330);
    });

    it('returns undefined pageCount for a non-numeric string in json-ld', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": "brak danych" }</script>
      `;
      expect(parseLubimyczytacBookPage(html).pageCount).toBeUndefined();
    });

    it('returns undefined pageCount when numberOfPages is an object', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": {"value": 300} }</script>
      `;
      expect(parseLubimyczytacBookPage(html).pageCount).toBeUndefined();
    });

    it('returns undefined publishedYear when datePublished is a number', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "datePublished": 2020 }</script>
      `;
      expect(parseLubimyczytacBookPage(html).publishedYear).toBeUndefined();
    });

    it('returns undefined publishedYear when datePublished string contains no year', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "datePublished": "unknown" }</script>
      `;
      expect(parseLubimyczytacBookPage(html).publishedYear).toBeUndefined();
    });

    it('extracts isbn10', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <meta property="books:isbn" content="0-7432-7356-7" />
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.isbn10).toBe('0743273567');
      expect(data.isbn13).toBeUndefined();
    });

    it('uses og:image as cover fallback', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <meta property="og:image" content="https://example.com/cover.jpg" />
      `;
      expect(parseLubimyczytacBookPage(html).coverUrl).toBe('https://example.com/cover.jpg');
    });

    it('resolves a protocol-relative cover url', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <div class="book-cover"><img src="//static.lubimyczytac.pl/cover.jpg" /></div>
      `;
      expect(parseLubimyczytacBookPage(html).coverUrl).toBe('https://static.lubimyczytac.pl/cover.jpg');
    });

    it('uses og:description as description fallback', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <meta property="og:description" content="Opis z og." />
      `;
      expect(parseLubimyczytacBookPage(html).description).toBe('Opis z og.');
    });

    it('passes through unknown language values unchanged', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <dl><dt>Język:</dt><dd>klingon</dd></dl>
      `;
      expect(parseLubimyczytacBookPage(html).language).toBe('klingon');
    });

    it('uses inLanguage from json-ld when no dt/dd language block', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "inLanguage": "pl" }</script>
      `;
      expect(parseLubimyczytacBookPage(html).language).toBe('pl');
    });

    it('parses a plain string author from json-ld', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "author": "Andrzej Sapkowski" }</script>
      `;
      expect(parseLubimyczytacBookPage(html).authors).toEqual(['Andrzej Sapkowski']);
    });

    it('ignores author object with a non-string name', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "author": { "name": 42 } }</script>
      `;
      expect(parseLubimyczytacBookPage(html).authors).toEqual([]);
    });

    it('ignores author object with a whitespace-only name', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "author": { "name": "   " } }</script>
      `;
      expect(parseLubimyczytacBookPage(html).authors).toEqual([]);
    });

    it('ignores a whitespace-only string author', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "author": "   " }</script>
      `;
      expect(parseLubimyczytacBookPage(html).authors).toEqual([]);
    });

    it('returns undefined pageCount when numberOfPages overflows to Infinity', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": 1e309 }</script>
      `;
      expect(parseLubimyczytacBookPage(html).pageCount).toBeUndefined();
    });

    it('parses json-ld wrapped in a @graph node', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">
        { "@graph": [{ "@type": "Book", "numberOfPages": 200, "datePublished": "2020-01-01" }] }
        </script>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.pageCount).toBe(200);
      expect(data.publishedYear).toBe(2020);
    });

    it('parses json-ld from an array at root', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">
        [{ "@type": "WebPage" }, { "@type": "Book", "numberOfPages": 100 }]
        </script>
      `;
      expect(parseLubimyczytacBookPage(html).pageCount).toBe(100);
    });

    it('uses second json-ld script block when first has no book node', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "WebSite" }</script>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": 150 }</script>
      `;
      expect(parseLubimyczytacBookPage(html).pageCount).toBe(150);
    });

    it('extracts genres from user tag links', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <a href="/ksiazki/t/1/fantasy">Fantasy</a>
        <a href="/ksiazki/t/2/kryminał">Kryminał</a>
      `;
      expect(parseLubimyczytacBookPage(html).genres).toEqual(['Fantasy', 'Kryminał']);
    });

    it('returns no series info when no cykl block is present', () => {
      const data = parseLubimyczytacBookPage('<h1 class="book__title">Test</h1>');
      expect(data.seriesName).toBeUndefined();
      expect(data.seriesIndex).toBeUndefined();
    });

    it('parses a decimal series index with comma notation', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <span class="d-none d-sm-block mt-1">Cykl: Wiedźmin (tom 2,5)</span>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.seriesName).toBe('Wiedźmin');
      expect(data.seriesIndex).toBe(2.5);
    });

    it('returns series name only when no volume number is present', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <span class="d-none d-sm-block mt-1">Cykl: Wiedźmin</span>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.seriesName).toBe('Wiedźmin');
      expect(data.seriesIndex).toBeUndefined();
    });

    it('deduplicates authors from html', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <a class="link-name" href="/autor/1/sapkowski">Andrzej Sapkowski</a>
        <a href="/autor/1/sapkowski">Andrzej Sapkowski</a>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.authors?.filter((a) => a === 'Andrzej Sapkowski').length).toBe(1);
    });

    it('returns no metadata from a json-ld array containing no book nodes', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">
        [{ "@type": "WebPage" }, { "@type": "WebSite" }]
        </script>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.pageCount).toBeUndefined();
      expect(data.publishedYear).toBeUndefined();
    });

    it('parses an Audiobook type json-ld node', () => {
      const html = `
        <h1 class="book__title">Test Audio</h1>
        <script type="application/ld+json">
        { "@type": "Audiobook", "numberOfPages": 400, "datePublished": "2021-03-15" }
        </script>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.pageCount).toBe(400);
      expect(data.publishedYear).toBe(2021);
    });

    it('does not overwrite fields already parsed from an earlier json-ld block', () => {
      const html = `
        <h1 class="book__title">Test</h1>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": 100, "datePublished": "2019" }</script>
        <script type="application/ld+json">{ "@type": "Book", "numberOfPages": 999, "datePublished": "2099" }</script>
      `;
      const data = parseLubimyczytacBookPage(html);
      expect(data.pageCount).toBe(100);
      expect(data.publishedYear).toBe(2019);
    });

    it('returns undefined for genres when no genre links or json-ld genre are present', () => {
      const data = parseLubimyczytacBookPage('<h1 class="book__title">Test</h1>');
      expect(data.genres).toEqual([]);
    });
  });
});
