import { Test, TestingModule } from '@nestjs/testing';
import { MetadataProviderKey, ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { LubimyczytacProvider } from './lubimyczytac.provider';

const SEARCH_HTML = `
  <div class="book-card">
    <a class="book-card__title" href="/ksiazka/123456/ostatnie-zyczenie">Ostatnie życzenie</a>
  </div>
`;

const BOOK_HTML = `
  <h1 class="book__title">Ostatnie życzenie</h1>
  <div class="book-cover"><img src="/upload/books/cover.jpg" /></div>
  <a href="/wydawnictwo/123/superNowa">superNOWA</a>
  <dl><dt>Język:</dt><dd>polski</dd></dl>
  <meta property="books:isbn" content="9788375780635" />
  <script type="application/ld+json">
  { "@type": "Book", "url": "https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie", "numberOfPages": 330, "datePublished": "2014-05-12", "author": { "@type": "Person", "name": "Andrzej Sapkowski" } }
  </script>
`;

describe('LubimyczytacProvider', () => {
  let provider: LubimyczytacProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true, coverResolution: 'high' },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    kobo: { enabled: false, country: 'us', language: 'en' },
    lubimyczytac: { enabled: true },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LubimyczytacProvider,
        {
          provide: ProviderConfigService,
          useValue: { getConfig: vi.fn().mockResolvedValue(mockConfig) },
        },
      ],
    }).compile();

    provider = module.get<LubimyczytacProvider>(LubimyczytacProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchSequence(...bodies: string[]) {
    const fetch = vi.fn();
    for (const body of bodies) {
      fetch.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(body) } as Response);
    }
    global.fetch = fetch;
    return fetch;
  }

  describe('search', () => {
    it('returns empty array when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, lubimyczytac: { enabled: false } });
      const result = await provider.search({ title: 'Wiedźmin' });
      expect(result).toEqual([]);
    });

    it('searches by title then fetches book details', async () => {
      mockFetchSequence(SEARCH_HTML, BOOK_HTML);

      const result = await provider.search({ title: 'Ostatnie życzenie', author: 'Andrzej Sapkowski' });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        provider: MetadataProviderKey.LUBIMYCZYTAC,
        providerId: '123456/ostatnie-zyczenie',
        title: 'Ostatnie życzenie',
        authors: ['Andrzej Sapkowski'],
        publisher: 'superNOWA',
        language: 'pl',
        pageCount: 330,
        publishedYear: 2014,
        isbn13: '9788375780635',
        sourceUrl: 'https://lubimyczytac.pl/ksiazka/123456/ostatnie-zyczenie',
      });
    });

    it('returns empty array when there is no query', async () => {
      const fetch = mockFetchSequence();
      const result = await provider.search({});
      expect(result).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('lookupById', () => {
    it('fetches a book by its provider id', async () => {
      mockFetchSequence(BOOK_HTML);
      const result = await provider.lookupById('123456');
      expect(result?.providerId).toBe('123456/ostatnie-zyczenie');
      expect(result?.title).toBe('Ostatnie życzenie');
    });

    it('returns null when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, lubimyczytac: { enabled: false } });
      expect(await provider.lookupById('123456')).toBeNull();
    });

    it('returns null for an invalid providerId', async () => {
      expect(await provider.lookupById('not-a-valid-id')).toBeNull();
    });

    it('returns null when book page has no title', async () => {
      mockFetchSequence('<html><body></body></html>');
      expect(await provider.lookupById('123456')).toBeNull();
    });

    it('returns null on non-ok HTTP response', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') } as unknown as Response);
      expect(await provider.lookupById('123456')).toBeNull();
    });

    it('rethrows ProviderThrottleError', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        headers: { get: () => null },
      } as unknown as Response);
      await expect(provider.lookupById('123456')).rejects.toBeInstanceOf(ProviderThrottleError);
    });

    it('returns null on generic fetch error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network failure'));
      expect(await provider.lookupById('123456')).toBeNull();
    });

    it('returns null on non-Error rejection', async () => {
      global.fetch = vi.fn().mockRejectedValue('string rejection');
      expect(await provider.lookupById('123456')).toBeNull();
    });
  });

  describe('search — additional branches', () => {
    it('searches by isbn when no title is given', async () => {
      mockFetchSequence(SEARCH_HTML, BOOK_HTML);
      const result = await provider.search({ isbn: '9788375780635' });
      expect(result).toHaveLength(1);
    });

    it('returns empty array on non-ok search response', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') } as unknown as Response);
      expect(await provider.search({ title: 'Wiedźmin' })).toEqual([]);
    });

    it('skips book fetch when book page returns no title', async () => {
      const SEARCH_TWO = `
        <a class="book-card__title" href="/ksiazka/1/first">First</a>
        <a class="book-card__title" href="/ksiazka/2/second">Second</a>
      `;
      mockFetchSequence(SEARCH_TWO, '<html><body></body></html>', '<html><body></body></html>');
      expect(await provider.search({ title: 'Wiedźmin' })).toEqual([]);
    });

    it('omits authors and genres fields when empty', async () => {
      const NO_AUTHORS_HTML = `
        <h1 class="book__title">Test Book</h1>
        <script type="application/ld+json">
        { "@type": "Book", "url": "https://lubimyczytac.pl/ksiazka/1/test" }
        </script>
      `;
      mockFetchSequence(SEARCH_HTML, NO_AUTHORS_HTML);
      const result = await provider.search({ title: 'Test' });
      expect(result[0]?.authors).toBeUndefined();
      expect(result[0]?.genres).toBeUndefined();
    });

    it('breaks the fetch loop when signal is pre-aborted', async () => {
      const SEARCH_TWO = `
        <a class="book-card__title" href="/ksiazka/1/first">First</a>
        <a class="book-card__title" href="/ksiazka/2/second">Second</a>
      `;
      const fetch = mockFetchSequence(SEARCH_TWO);
      const result = await provider.search({ title: 'Wiedźmin', signal: AbortSignal.abort() });
      expect(result).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('sleeps between multiple book fetches', async () => {
      const SEARCH_TWO = `
        <a class="book-card__title" href="/ksiazka/123456/ostatnie-zyczenie">Ostatnie życzenie</a>
        <a class="book-card__title" href="/ksiazka/789012/miecz-przeznaczenia">Miecz przeznaczenia</a>
      `;
      const BOOK_HTML_2 = `
        <h1 class="book__title">Miecz przeznaczenia</h1>
        <script type="application/ld+json">
        { "@type": "Book", "url": "https://lubimyczytac.pl/ksiazka/789012/miecz-przeznaczenia", "numberOfPages": 280, "datePublished": "2015" }
        </script>
      `;
      mockFetchSequence(SEARCH_TWO, BOOK_HTML, BOOK_HTML_2);
      const result = await provider.search({ title: 'Sapkowski' });
      expect(result).toHaveLength(2);
      expect(result[1]?.title).toBe('Miecz przeznaczenia');
    }, 10_000);
  });
});
