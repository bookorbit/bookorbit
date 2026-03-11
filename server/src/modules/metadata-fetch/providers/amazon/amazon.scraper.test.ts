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
  });
});
