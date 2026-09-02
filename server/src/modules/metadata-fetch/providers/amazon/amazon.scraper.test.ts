import { extractAsins, parseBookPage } from './amazon.scraper';

describe('AmazonScraper', () => {
  describe('extractAsins', () => {
    it('should extract ASINs from search results', () => {
      const html = `
        <div data-component-type="s-search-result" data-asin="1234567890">
          <div data-cy="title-recipe">The Great Gatsby</div>
          <a href="/dp/1234567890">Paperback</a>
        </div>
        <div data-component-type="s-search-result" data-asin="0987654321">
          <div data-cy="title-recipe">Another Book</div>
          <a href="/dp/0987654321">Hardcover</a>
        </div>
      `;
      const result = extractAsins(html, 5);
      expect(result).toEqual(['1234567890', '0987654321']);
    });

    it('should respect format preference', () => {
      const html = `
        <div data-component-type="s-search-result">
          <div data-cy="title-recipe">Test Book</div>
          <a href="/dp/HARDCOVER1">Hardcover</a>
          <a href="/dp/KINDLE0001">Kindle</a>
        </div>
      `;
      const result = extractAsins(html, 5);
      expect(result).toEqual(['KINDLE0001']); // Kindle is preferred over Hardcover
    });

    it('should skip unwanted titles', () => {
      const html = `
        <div data-component-type="s-search-result" data-asin="SET1234567">
          <div data-cy="title-recipe">Box Set of Books</div>
        </div>
        <div data-component-type="s-search-result" data-asin="GOOD123456">
          <div data-cy="title-recipe">Good Book</div>
        </div>
      `;
      const result = extractAsins(html, 5);
      expect(result).toEqual(['GOOD123456']);
    });

    it('should skip sponsored cards before following unrelated format links', () => {
      const html = `
        <div data-component-type="s-search-result" data-asin="SPONSOR001">
          <div data-cy="title-recipe">Sponsored Sponsored result</div>
          <a href="/dp/SERIES0001">Book 1 of 3: A Series</a>
        </div>
        <div data-component-type="s-search-result" data-asin="B123456789">
          <div data-cy="title-recipe">Wanted Book</div>
          <a href="/dp/B123456789">Kindle</a>
        </div>
      `;

      expect(extractAsins(html, 5)).toEqual(['B123456789']);
    });
  });

  describe('parseBookPage', () => {
    it('should parse a complete book page', () => {
      const html = `
        <span id="productTitle">The Great Gatsby: A Novel</span>
        <div id="bylineInfo">
          <span class="author"><a href="#">F. Scott Fitzgerald</a></span>
        </div>
        <div id="bookDescription_feature_div">
          <div class="a-expander-content">A classic story.</div>
        </div>
        <div id="rpi-attribute-book_details-isbn13"><span class="rpi-attribute-value"><span>978-1234567890</span></span></div>
        <div id="rpi-attribute-book_details-isbn10"><span class="rpi-attribute-value"><span>1234567890</span></span></div>
        <div id="rpi-attribute-book_details-publisher"><span class="rpi-attribute-value"><span>Scribner</span></span></div>
        <div id="rpi-attribute-book_details-publication_date"><span class="rpi-attribute-value"><span>April 10, 1925</span></span></div>
        <div id="rpi-attribute-language"><span class="rpi-attribute-value"><span>English</span></span></div>
        <div id="rpi-attribute-book_details-fiona_pages"><span class="rpi-attribute-value"><span>180 pages</span></span></div>
        <div id="averageCustomerReviews_feature_div">
          <span id="acrPopover" title="4.8 out of 5 stars">
            <span class="a-icon-alt">4.8 out of 5 stars</span>
          </span>
          <span id="acrCustomerReviewText" aria-label="104,451 Reviews">104,451 ratings</span>
        </div>
        <img id="landingImage" data-a-dynamic-image='{"https://m.media-amazon.com/images/I/123._SY342_.jpg": [225, 342]}'>
      `;

      const result = parseBookPage(html);

      expect(result).toMatchObject({
        title: 'The Great Gatsby',
        subtitle: 'A Novel',
        authors: ['F. Scott Fitzgerald'],
        description: 'A classic story.',
        isbn13: '9781234567890',
        isbn10: '1234567890',
        publisher: 'Scribner',
        publishedYear: 1925,
        language: 'English',
        pageCount: 180,
        coverUrl: 'https://m.media-amazon.com/images/I/123.jpg',
        communityRating: 4.8,
        communityRatingCount: 104451,
      });
    });

    it('should parse older layout detail bullets', () => {
      const html = `
        <span id="productTitle">Old Layout Book</span>
        <div id="detailBullets_feature_div">
          <span class="a-text-bold">Publisher :</span> <span>Penguin (January 1, 2020)</span>
          <span class="a-text-bold">ISBN-13 :</span> <span>978-0987654321</span>
          <span class="a-text-bold">Print length :</span> <span>1,234 pages</span>
        </div>
      `;
      const result = parseBookPage(html);
      expect(result.publisher).toBe('Penguin');
      expect(result.publishedYear).toBe(2020);
      expect(result.isbn13).toBe('9780987654321');
      expect(result.pageCount).toBe(1234);
    });

    describe('series attributes', () => {
      function seriesHtml(label: string, name = 'The Expanse'): string {
        return `
          <span id="productTitle">A Book</span>
          <div id="rpi-attribute-book_details-series">
            <span class="rpi-attribute-label"><span>${label}</span></span>
            <span class="rpi-attribute-value"><a href="/dp/X"><span>${name}</span></a></span>
          </div>
        `;
      }

      it('reads the series name, position and length from one label', () => {
        const result = parseBookPage(seriesHtml('Book 3 of 7'));

        expect(result.seriesName).toBe('The Expanse');
        expect(result.seriesIndex).toBe('3');
        expect(result.seriesTotalBooks).toBe(7);
      });

      it('keeps a fractional position while still reading the length', () => {
        const result = parseBookPage(seriesHtml('Book 2.5 of 9'));

        expect(result.seriesIndex).toBe('2.5');
        expect(result.seriesTotalBooks).toBe(9);
      });

      it('still yields the position when the label states no length', () => {
        const result = parseBookPage(seriesHtml('Book 3 of'));

        expect(result.seriesIndex).toBe('3');
        expect(result.seriesTotalBooks).toBeUndefined();
      });

      it('preserves trailing zeros in a fractional position', () => {
        expect(parseBookPage(seriesHtml('Book 5.10 of 12')).seriesIndex).toBe('5.10');
      });

      it('yields nothing when the page has no series block', () => {
        const result = parseBookPage('<span id="productTitle">A Book</span>');

        expect(result.seriesName).toBeUndefined();
        expect(result.seriesIndex).toBeUndefined();
        expect(result.seriesTotalBooks).toBeUndefined();
      });

      it('rejects a length beyond the supported ceiling', () => {
        expect(parseBookPage(seriesHtml('Book 1 of 10001')).seriesTotalBooks).toBeUndefined();
      });
    });

    it('rejects a negative rating value', () => {
      const html = `
        <span id="productTitle">Bad Rating Book</span>
        <div id="averageCustomerReviews_feature_div">
          <span id="acrPopover" title="-1 out of 5 stars">
            <span class="a-icon-alt">-1 out of 5 stars</span>
          </span>
          <span id="acrCustomerReviewText">500 ratings</span>
        </div>
      `;
      const result = parseBookPage(html);
      expect(result.communityRating).toBeUndefined();
    });

    it('rejects a negative rating count', () => {
      const html = `
        <span id="productTitle">Bad Count Book</span>
        <div id="averageCustomerReviews_feature_div">
          <span id="acrPopover" title="4.0 out of 5 stars">
            <span class="a-icon-alt">4.0 out of 5 stars</span>
          </span>
          <span id="acrCustomerReviewText">-10 ratings</span>
        </div>
      `;
      const result = parseBookPage(html);
      expect(result.communityRating).toBe(4.0);
      expect(result.communityRatingCount).toBeUndefined();
    });
  });
});
