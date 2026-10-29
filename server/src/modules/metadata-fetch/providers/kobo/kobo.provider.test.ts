import { Test, TestingModule } from '@nestjs/testing';
import { MetadataProviderKey, ProviderConfigurations } from '@bookorbit/types';

import { appConfig } from '../../../../config/config';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { fetchKoboHtmlWithCloudscraper } from './kobo-cloudscraper.fetcher';
import { KoboProvider } from './kobo.provider';

vi.mock('./kobo-cloudscraper.fetcher', () => ({
  fetchKoboHtmlWithCloudscraper: vi.fn(),
}));

describe('KoboProvider', () => {
  let provider: KoboProvider;
  let providerConfig: ProviderConfigService;
  const mockFetchKoboHtml = vi.mocked(fetchKoboHtmlWithCloudscraper);

  const mockConfig: ProviderConfigurations = {
    google: { enabled: false, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true, coverResolution: 'high' },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    kobo: { enabled: true, country: 'us', language: 'en' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KoboProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
        {
          provide: appConfig.KEY,
          useValue: {
            koboCloudscraperPython: undefined,
          },
        },
      ],
    }).compile();

    provider = module.get<KoboProvider>(KoboProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockFetchKoboHtml.mockReset();
  });

  it('returns empty results when disabled', async () => {
    vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
      ...mockConfig,
      kobo: { enabled: false, country: 'us', language: 'en' },
    });

    await expect(provider.search({ title: 'Fourth Wing' })).resolves.toEqual([]);
  });

  it('searches Kobo pages and maps product details to metadata candidates', async () => {
    const searchHtml = `
      <div data-testid="search-result-widget">
        <a data-testid="title" href="/us/en/ebook/fourth-wing-1">Fourth Wing</a>
      </div>
    `;
    const bookHtml = `
      <h1 class="title product-field">Fourth Wing</h1>
      <span class="subtitle product-field">Empyrean Book 1</span>
      <span class="visible-contributors"><a>Rebecca Yarros</a></span>
      <div id="about-this-book-widget"><div class="book-stats"><div class="column"><strong>640</strong><span>Pages</span></div></div></div>
      <div class="bookitem-secondary-metadata"><ul><li>Entangled Publishing, LLC</li><li>ISBN:<span>9781649374042</span></li></ul></div>
    `;

    mockFetchKoboHtml
      .mockResolvedValueOnce(
        makeCloudscraperResult(searchHtml, 'https://www.kobo.com/us/en/search?query=Fourth+Wing&fcmedia=Book&pageNumber=1&fclanguages=en'),
      )
      .mockResolvedValueOnce(makeCloudscraperResult(bookHtml, 'https://www.kobo.com/us/en/ebook/fourth-wing-1'));

    const result = await provider.search({ title: 'Fourth Wing' });

    expect(mockFetchKoboHtml).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('https://www.kobo.com/us/en/search?'),
      expect.objectContaining({ maxAttempts: 1, timeoutMs: 5_000 }),
    );
    expect(mockFetchKoboHtml).toHaveBeenNthCalledWith(
      2,
      'https://www.kobo.com/us/en/ebook/fourth-wing-1',
      expect.objectContaining({ maxAttempts: 1, timeoutMs: 5_000 }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        provider: MetadataProviderKey.KOBO,
        providerId: 'fourth-wing-1',
        title: 'Fourth Wing',
        subtitle: 'Empyrean Book 1',
        authors: ['Rebecca Yarros'],
        publisher: 'Entangled Publishing, LLC',
        pageCount: 640,
        isbn13: '9781649374042',
        sourceUrl: 'https://www.kobo.com/us/en/ebook/fourth-wing-1',
      }),
    ]);
  });

  it('retries Kobo search with a fresh subprocess when cloudscraper times out', async () => {
    const searchHtml = `
      <div data-testid="search-result-widget">
        <a data-testid="title" href="/us/en/ebook/a-head-full-of-ghosts">A Head Full of Ghosts</a>
      </div>
    `;
    const bookHtml = `
      <h1 class="title product-field">A Head Full of Ghosts</h1>
      <span class="visible-contributors"><a>Paul Tremblay</a></span>
    `;

    mockFetchKoboHtml
      .mockRejectedValueOnce(Object.assign(new Error('cloudscraper timed out'), { name: 'KoboCloudscraperError' }))
      .mockResolvedValueOnce(
        makeCloudscraperResult(
          searchHtml,
          'https://www.kobo.com/us/en/search?query=A+Head+Full+of+Ghosts+Paul+Tremblay&fcmedia=Book&pageNumber=1&fclanguages=en',
        ),
      )
      .mockResolvedValueOnce(makeCloudscraperResult(bookHtml, 'https://www.kobo.com/us/en/ebook/a-head-full-of-ghosts'));

    const result = await provider.search({ title: 'A Head Full of Ghosts', author: 'Paul Tremblay' });

    expect(mockFetchKoboHtml).toHaveBeenCalledTimes(3);
    expect(mockFetchKoboHtml).toHaveBeenNthCalledWith(1, expect.stringContaining('A+Head+Full+of+Ghosts+Paul+Tremblay'), expect.any(Object));
    expect(mockFetchKoboHtml).toHaveBeenNthCalledWith(2, expect.stringContaining('A+Head+Full+of+Ghosts+Paul+Tremblay'), expect.any(Object));
    expect(result[0]).toEqual(
      expect.objectContaining({
        provider: MetadataProviderKey.KOBO,
        providerId: 'a-head-full-of-ghosts',
        title: 'A Head Full of Ghosts',
        authors: ['Paul Tremblay'],
      }),
    );
  });

  it('handles Kobo search redirects to product pages', async () => {
    const bookHtml = `<h1 class="title product-field">Direct Hit</h1>`;
    mockFetchKoboHtml
      .mockResolvedValueOnce(makeCloudscraperResult(bookHtml, 'https://www.kobo.com/us/en/ebook/direct-hit'))
      .mockResolvedValueOnce(makeCloudscraperResult(bookHtml, 'https://www.kobo.com/us/en/ebook/direct-hit'));

    const result = await provider.search({ isbn: '9781649374042' });

    expect(mockFetchKoboHtml).toHaveBeenCalledTimes(2);
    expect(result[0]?.providerId).toBe('direct-hit');
  });

  it('returns empty results when Kobo serves a challenge page', async () => {
    const challengeHtml = '<html><title>Challenged | Kobo.com</title><span id="challenge-error-text">Enable cookies</span></html>';
    mockFetchKoboHtml.mockResolvedValueOnce(
      makeCloudscraperResult(challengeHtml, 'https://www.kobo.com/us/en/search', 403, { 'cf-mitigated': 'challenge' }),
    );

    await expect(provider.search({ title: 'Fourth Wing' })).resolves.toEqual([]);
  });

  it('looks up books by Kobo slug using configured region', async () => {
    const bookHtml = `<h1 class="title product-field">Lookup Book</h1>`;
    mockFetchKoboHtml.mockResolvedValueOnce(makeCloudscraperResult(bookHtml, 'https://www.kobo.com/us/en/ebook/lookup-book'));

    const result = await provider.lookupById('lookup-book');

    expect(mockFetchKoboHtml).toHaveBeenCalledWith('https://www.kobo.com/us/en/ebook/lookup-book', expect.any(Object));
    expect(result?.providerId).toBe('lookup-book');
  });

  it('rethrows provider throttle errors', async () => {
    mockFetchKoboHtml.mockResolvedValue(makeCloudscraperResult('', 'https://www.kobo.com/us/en/search', 429, { 'retry-after': '120' }));

    await expect(provider.search({ title: 'Fourth Wing' })).rejects.toBeInstanceOf(ProviderThrottleError);
  });
});

function makeCloudscraperResult(html: string, url: string, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    url,
    headers,
    html,
    attempts: 1,
    challenge: headers['cf-mitigated'] === 'challenge',
  };
}
