import {
  buildKoboBookUrl,
  buildKoboSearchUrl,
  extractKoboProviderId,
  extractKoboSearchResults,
  isKoboChallengePage,
  normalizeKoboProviderId,
  parseKoboBookPage,
} from './kobo.scraper';

describe('Kobo scraper', () => {
  it('builds regional search and lookup URLs like the Kobo metadata plugin', () => {
    expect(buildKoboSearchUrl('Fourth Wing Rebecca Yarros', 2, { country: 'au', language: 'en' })).toBe(
      'https://www.kobo.com/au/en/search?query=Fourth+Wing+Rebecca+Yarros&fcmedia=Book&pageNumber=2&fclanguages=en',
    );
    expect(buildKoboBookUrl('fourth-wing-1', { country: 'au', language: 'en' })).toBe('https://www.kobo.com/au/en/ebook/fourth-wing-1');
    expect(buildKoboBookUrl('fourth-wing-1', { country: 'au', language: 'all' })).toBe('https://www.kobo.com/au/ebook/fourth-wing-1');
  });

  it('extracts and normalizes Kobo provider IDs', () => {
    expect(extractKoboProviderId('https://www.kobo.com/us/en/ebook/fourth-wing-1?utm=1')).toBe('fourth-wing-1');
    expect(extractKoboProviderId('/us/en/ebook/fourth-wing-1')).toBe('fourth-wing-1');
    expect(normalizeKoboProviderId(' https://www.kobo.com/us/en/ebook/fourth-wing-1 ')).toBe('fourth-wing-1');
  });

  it('extracts search results from the current Kobo search layout and dedupes duplicate anchors', () => {
    const html = `
      <div data-testid="search-result-widget">
        <a data-testid="title" href="/us/en/ebook/fourth-wing-1">Fourth Wing</a>
        <a data-testid="title" href="/us/en/ebook/fourth-wing-1">Fourth Wing mobile duplicate</a>
        <a data-testid="title" href="/us/en/ebook/iron-flame-1">Iron Flame</a>
      </div>
    `;

    expect(extractKoboSearchResults(html, 10)).toEqual([
      { providerId: 'fourth-wing-1', url: 'https://www.kobo.com/us/en/ebook/fourth-wing-1' },
      { providerId: 'iron-flame-1', url: 'https://www.kobo.com/us/en/ebook/iron-flame-1' },
    ]);
  });

  it('extracts search results from the legacy product field layout', () => {
    const html = `
      <h2 class="title product-field"><a href="/au/en/ebook/old-layout-book">Old Layout Book</a></h2>
    `;

    expect(extractKoboSearchResults(html, 1)).toEqual([{ providerId: 'old-layout-book', url: 'https://www.kobo.com/au/en/ebook/old-layout-book' }]);
  });

  it('parses Kobo product pages using the Calibre plugin selectors', () => {
    const html = `
      <html>
        <head><meta property="og:image" content="https://cdn.kobo.com/book-images/44f0/353/569/90/False/cover.jpg"></head>
        <body>
          <h1 class="title product-field">Fourth Wing: Empyrean Book 1</h1>
          <span class="subtitle product-field"></span>
          <span class="visible-contributors"><a>Rebecca Yarros</a></span>
          <span class="series product-field">
            <span class="sequenced-name-prefix">Book 1 - </span>
            <span class="product-sequence-field"><a>The Empyrean</a></span>
          </span>
          <div class="bookitem-secondary-metadata">
            <ul>
              <li>Entangled Publishing, LLC</li>
              <li>Release Date:<span>May 2, 2023</span></li>
              <li>ISBN:<span>9781649374042</span></li>
              <li>Language:<span>English</span></li>
              <li>Pages:<span>640</span></li>
            </ul>
          </div>
          <ul class="category-rankings">
            <meta property="genre" content="Fantasy" />
            <meta property="genre" content="Romance" />
          </ul>
          <div data-full-synopsis="">A young dragon rider enters a war college.</div>
        </body>
      </html>
    `;

    expect(parseKoboBookPage(html, 'https://www.kobo.com/us/en/ebook/fourth-wing-1')).toEqual({
      providerId: 'fourth-wing-1',
      title: 'Fourth Wing',
      subtitle: 'Empyrean Book 1',
      authors: ['Rebecca Yarros'],
      description: 'A young dragon rider enters a war college.',
      publisher: 'Entangled Publishing, LLC',
      publishedDate: '2023-05-02',
      publishedYear: 2023,
      language: 'English',
      pageCount: 640,
      isbn10: undefined,
      isbn13: '9781649374042',
      seriesName: 'The Empyrean',
      seriesIndex: 1,
      genres: ['Fantasy', 'Romance'],
      coverUrl: 'https://cdn.kobo.com/book-images/44f0/1650/2200/100/False/cover.jpg',
      sourceUrl: 'https://www.kobo.com/us/en/ebook/fourth-wing-1',
    });
  });

  it('parses visible subtitle and page stats from the current Kobo layout', () => {
    const html = `
      <h1 class="title product-field">Beautiful Ugly</h1>
      <span class="subtitle product-field">A Novel</span>
      <span class="visible-contributors"><a>Alice Feeney</a></span>
      <div id="about-this-book-widget">
        <div class="book-stats">
          <div class="column"><strong>304</strong><span>Pages</span></div>
          <div class="column"><strong>7 - 8</strong><span>Hours to read</span></div>
        </div>
      </div>
      <div class="bookitem-secondary-metadata">
        <ul>
          <li>Flatiron Books</li>
          <li>Release Date:<span>January 14, 2025</span></li>
          <li>Book ID:<span>9781250337795</span></li>
          <li>Language:<span>English</span></li>
        </ul>
      </div>
    `;

    expect(parseKoboBookPage(html, 'https://www.kobo.com/us/en/ebook/beautiful-ugly-3')).toEqual(
      expect.objectContaining({
        providerId: 'beautiful-ugly-3',
        title: 'Beautiful Ugly',
        subtitle: 'A Novel',
        authors: ['Alice Feeney'],
        publisher: 'Flatiron Books',
        publishedYear: 2025,
        language: 'English',
        pageCount: 304,
        isbn13: '9781250337795',
      }),
    );
  });

  it('detects Kobo Cloudflare challenge pages', () => {
    const html = '<html><title>Challenged | Kobo.com</title><span id="challenge-error-text">Enable JavaScript and cookies</span></html>';
    expect(isKoboChallengePage(html)).toBe(true);
    expect(isKoboChallengePage('<html>ok</html>', { headers: new Headers({ 'cf-mitigated': 'challenge' }) })).toBe(true);
  });
});
