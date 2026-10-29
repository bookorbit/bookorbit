import type { ConfigType } from '@nestjs/config';
import type { ProviderConfigurations } from '@bookorbit/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderCallRecord, runWithProviderCallRecord } from '../../../common/provider-cache/provider-call-context';
import type { appConfig } from '../../../config/config';
import type { ProviderConfigService } from '../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../provider-throttle.error';
import { ProviderThrottleTracker } from '../provider-throttle.tracker';
import { AmazonProvider } from './amazon/amazon.provider';
import { ComicVineClient } from './comicvine/comicvine.client';
import { ComicVineProvider } from './comicvine/comicvine.provider';
import { GoodreadsProvider } from './goodreads/goodreads.provider';
import { GoogleProvider } from './google/google.provider';
import { HardcoverClient } from './hardcover/hardcover.client';
import { HardcoverProvider } from './hardcover/hardcover.provider';
import { ITunesProvider } from './itunes/itunes.provider';
import { fetchKoboHtmlWithCloudscraper } from './kobo/kobo-cloudscraper.fetcher';
import { KoboProvider } from './kobo/kobo.provider';
import { LibroFmProvider } from './librofm/librofm.provider';

vi.mock('./provider-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provider-utils')>()),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./kobo/kobo-cloudscraper.fetcher', () => ({ fetchKoboHtmlWithCloudscraper: vi.fn() }));

/**
 * Failures the egress wrapper cannot see, because the response arrived as a 200: a challenge page, a
 * page that does not parse, or a detail fetch that came back empty. Each must mark the call so a
 * short or empty answer is never stored as a complete one.
 */

const CONFIG: ProviderConfigurations = {
  google: { enabled: true, apiKey: 'google-key' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: true, apiKey: 'hardcover-key' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'high' },
  audible: { enabled: true, domain: 'com' },
  audnexus: { enabled: true },
  librofm: { enabled: true },
  comicvine: { enabled: true, apiKey: 'comicvine-key' },
  ranobedb: { enabled: true },
  kobo: { enabled: true, country: 'us', language: 'en' },
};

const providerConfig = { getConfig: () => Promise.resolve(CONFIG) } as unknown as ProviderConfigService;

type Handler = (url: URL) => Response | Promise<Response>;

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function routeEgress(handler: Handler): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => handler(new URL(input instanceof Request ? input.url : String(input))));
}

function routeKobo(handler: (url: string) => string): void {
  vi.mocked(fetchKoboHtmlWithCloudscraper).mockImplementation((url) =>
    Promise.resolve({ status: 200, url, headers: {}, html: handler(url), attempts: 1, challenge: false }),
  );
}

async function runRecorded(operation: () => Promise<unknown>): Promise<{ record: ProviderCallRecord; value: unknown; error: unknown }> {
  const record = new ProviderCallRecord();
  let value: unknown;
  let error: unknown;
  try {
    value = await runWithProviderCallRecord(record, operation);
  } catch (err) {
    error = err;
  }
  return { record, value, error };
}

const EMPTY_PAGE = '<html><head><title>Book</title></head><body><p>Nothing here</p></body></html>';

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fetchKoboHtmlWithCloudscraper).mockReset();
});

describe('kobo markers', () => {
  const kobo = () => new KoboProvider(providerConfig, { koboCloudscraperPython: undefined } as ConfigType<typeof appConfig>);
  const SEARCH_PAGE = '<div data-testid="search-result-widget"><a data-testid="title" href="/us/en/ebook/dune-1">Dune</a></div>';

  it('marks a challenge page as degraded', async () => {
    routeKobo(() => '<html><div id="challenge-form"></div></html>');

    const { record, value } = await runRecorded(() => kobo().search({ title: 'Dune' }));

    expect(value).toEqual([]);
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks a product page that does not parse as degraded, in search and lookup', async () => {
    routeKobo((url) => (url.includes('/search') ? SEARCH_PAGE : EMPTY_PAGE));

    const search = await runRecorded(() => kobo().search({ title: 'Dune' }));
    const lookup = await runRecorded(() => kobo().lookupById('dune-1'));

    expect(search.value).toEqual([]);
    expect(search.record.degradationReasons.length).toBeGreaterThan(0);
    expect(lookup.value).toBeNull();
    expect(lookup.record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks a cloudscraper failure as failed', async () => {
    vi.mocked(fetchKoboHtmlWithCloudscraper).mockRejectedValue(new Error('cloudscraper failed'));

    const { record, value } = await runRecorded(() => kobo().lookupById('dune-1'));

    expect(value).toBeNull();
    expect(record.failureReasons.length).toBeGreaterThan(0);
  });
});

describe('goodreads markers', () => {
  const AUTOCOMPLETE = [{ bookId: '1', title: 'Dune', bookTitleBare: 'Dune', author: { name: 'Frank Herbert' }, ratingsCount: 100 }];
  const WAF_PAGE = '<html><script>window.AwsWafIntegration = {};</script></html>';

  function routeGoodreads(detail: () => Response): void {
    routeEgress((url) => (url.pathname.startsWith('/book/auto_complete') ? json(AUTOCOMPLETE) : detail()));
  }

  it('marks a WAF challenge served as 200, and the autocomplete fallback, as degraded', async () => {
    routeGoodreads(() => html(WAF_PAGE));

    const { record, value } = await runRecorded(() => new GoodreadsProvider(providerConfig).search({ title: 'Dune', author: 'Frank Herbert' }));

    expect(value).toHaveLength(1);
    expect(record.unsuccessfulRequests()).toEqual([]);
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks a blocked lookup that falls back to autocomplete as degraded', async () => {
    routeGoodreads(() => html(WAF_PAGE));

    const { record, value } = await runRecorded(() => new GoodreadsProvider(providerConfig).lookupById('1', undefined, { title: 'Dune' }));

    expect(value).toMatchObject({ providerId: '1' });
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks a detail page that does not parse as degraded', async () => {
    routeGoodreads(() => html(EMPTY_PAGE));

    const search = await runRecorded(() => new GoodreadsProvider(providerConfig).search({ title: 'Dune' }));
    const lookup = await runRecorded(() => new GoodreadsProvider(providerConfig).lookupById('1'));

    expect(search.value).toHaveLength(1);
    expect(search.record.degradationReasons.length).toBeGreaterThan(0);
    expect(lookup.value).toBeNull();
    expect(lookup.record.degradationReasons.length).toBeGreaterThan(0);
  });
});

describe('amazon markers', () => {
  const SEARCH_PAGE = '<div data-component-type="s-search-result" data-asin="B000000001"><a href="/dp/B000000001">Kindle Edition</a></div>';

  it('marks a product page that does not parse as degraded, in search and lookup', async () => {
    routeEgress((url) => html(url.pathname.startsWith('/gp/aw/s') ? SEARCH_PAGE : EMPTY_PAGE));

    const search = await runRecorded(() => new AmazonProvider(providerConfig).search({ title: 'Dune' }));
    const lookup = await runRecorded(() => new AmazonProvider(providerConfig).lookupById('B000000001'));

    expect(search.value).toEqual([]);
    expect(search.record.unsuccessfulRequests()).toEqual([]);
    expect(search.record.degradationReasons.length).toBeGreaterThan(0);
    expect(lookup.value).toBeNull();
    expect(lookup.record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks a bot challenge as degraded', async () => {
    routeEgress(() => html('<form action="/errors/validateCaptcha"></form>'));

    const { record, error } = await runRecorded(() => new AmazonProvider(providerConfig).lookupById('B000000001'));

    expect(error).toBeInstanceOf(ProviderThrottleError);
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });
});

describe('librofm markers', () => {
  it('marks an audiobook whose details come back empty as degraded', async () => {
    routeEgress((url) =>
      url.pathname.endsWith('/search')
        ? json({ audiobook_collection: { audiobooks: [{ isbn: '9781111111111' }] } })
        : json({ data: { audiobook: null } }),
    );

    const { record, value } = await runRecorded(() => new LibroFmProvider(providerConfig).search({ title: 'Dune', isAudiobook: true }));

    expect(value).toEqual([]);
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks malformed details as failed', async () => {
    routeEgress(() => new Response('{"data":', { status: 200 }));

    const { record, value } = await runRecorded(() => new LibroFmProvider(providerConfig).lookupById('9781111111111'));

    expect(value).toBeNull();
    expect(record.failureReasons.length).toBeGreaterThan(0);
  });
});

describe('api provider markers', () => {
  it('marks a Google search body that does not say how many it found as failed', async () => {
    routeEgress(() => json({}));

    const { record, value } = await runRecorded(() => new GoogleProvider(providerConfig).search({ title: 'Dune' }));

    expect(value).toEqual([]);
    expect(record.failureReasons).toContain('google.search: response without totalItems');
  });

  it('accepts a Google answer of no results without marking it', async () => {
    routeEgress(() => json({ kind: 'books#volumes', totalItems: 0 }));

    const { record, value } = await runRecorded(() => new GoogleProvider(providerConfig).search({ title: 'Dune' }));

    expect(value).toEqual([]);
    expect(record.failureReasons).toEqual([]);
    expect(record.degradationReasons).toEqual([]);
  });

  it('marks a Google lookup body without a volume id as failed', async () => {
    routeEgress(() => json({}));

    const { record } = await runRecorded(() => new GoogleProvider(providerConfig).lookupById('abc'));

    expect(record.failureReasons.length).toBeGreaterThan(0);
  });

  it('marks a Google total without items as degraded', async () => {
    routeEgress(() => json({ kind: 'books#volumes', totalItems: 5 }));

    const { record, value } = await runRecorded(() => new GoogleProvider(providerConfig).search({ title: 'Dune' }));

    expect(value).toEqual([]);
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks an iTunes lookup with malformed JSON as failed', async () => {
    routeEgress(() => new Response('{"results":', { status: 200 }));

    const { record, value } = await runRecorded(() => new ITunesProvider(providerConfig).lookupById('1'));

    expect(value).toBeNull();
    expect(record.failureReasons.length).toBeGreaterThan(0);
  });

  it('marks a Hardcover hit without its document as degraded', async () => {
    routeEgress(() => json({ data: { search: { results: { hits: [{}], found: 1 } } } }));

    const { record, value } = await runRecorded(() => new HardcoverProvider(new HardcoverClient(), providerConfig).search({ title: 'Dune' }));

    expect(value).toEqual([]);
    expect(record.degradationReasons.length).toBeGreaterThan(0);
  });

  it('marks Hardcover GraphQL errors as failed even alongside data', async () => {
    routeEgress(() => json({ data: { books: [] }, errors: [{ message: 'permission denied' }] }));

    const { record } = await runRecorded(() => new HardcoverProvider(new HardcoverClient(), providerConfig).lookupById('dune'));

    expect(record.failureReasons.length).toBeGreaterThan(0);
  });

  it('marks a ComicVine status_code error as failed', async () => {
    routeEgress(() => json({ status_code: 107, error: 'Rate limit exceeded', results: [] }));

    const { record, value } = await runRecorded(() => new ComicVineClient().searchIssues('Saga', 'comicvine-key'));

    expect(value).toEqual([]);
    expect(record.failureReasons).toEqual(['comicvine: api status_code=107']);
  });

  it('marks a throttled ComicVine volume probe as degraded', async () => {
    const volume = {
      id: 5,
      name: 'Saga',
      start_year: '2012',
      count_of_issues: 60,
      description: null,
      deck: null,
      image: null,
      publisher: null,
      site_detail_url: null,
    };
    routeEgress((url) =>
      url.pathname.endsWith('/volumes/') ? json({ status_code: 1, error: 'OK', results: [volume] }) : new Response('', { status: 420 }),
    );
    const provider = new ComicVineProvider(new ComicVineClient(), providerConfig, new ProviderThrottleTracker());

    const { record, value } = await runRecorded(() => provider.search({ title: 'Saga #1' }));

    expect(value).toEqual([]);
    expect(record.degradationReasons).toContain('comicvine.search: volume probe failed');
  });
});
