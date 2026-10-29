import type { ProviderConfigurations } from '@bookorbit/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderCallRecord, runWithProviderCallRecord } from '../../../common/provider-cache/provider-call-context';
import type { ProviderConfigService } from '../../metadata-preferences/provider-config.service';
import { ProviderThrottleTracker } from '../provider-throttle.tracker';
import { AudibleProvider } from './audible/audible.provider';
import { AudnexusProvider } from './audnexus/audnexus.provider';
import { ComicVineClient } from './comicvine/comicvine.client';
import { ComicVineProvider } from './comicvine/comicvine.provider';
import { GoogleProvider } from './google/google.provider';
import { HardcoverClient } from './hardcover/hardcover.client';
import { HardcoverProvider } from './hardcover/hardcover.provider';
import { ITunesProvider } from './itunes/itunes.provider';
import { IdentifiableProvider, MetadataProvider } from './metadata-provider';
import { MetadataSearchParams } from './metadata-search-params';
import { OpenLibraryProvider } from './open-library/open-library.provider';
import { RanobeDbClient } from './ranobedb/ranobedb.client';
import { RanobeDbProvider } from './ranobedb/ranobedb.provider';

vi.mock('./provider-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provider-utils')>()),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

/**
 * A provider may keep an empty answer in the cache only when every way it can fail shows up in the
 * call record. Each suite drives one provider through the failures that would otherwise look like
 * "nothing found", then through a genuine empty answer that must stay cacheable.
 */

const CONFIG: ProviderConfigurations = {
  google: { enabled: true, apiKey: 'google-key' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: true, apiKey: 'hardcover-key' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'high' },
  audible: { enabled: true, domain: 'com' },
  audnexus: { enabled: true },
  librofm: { enabled: false },
  comicvine: { enabled: true, apiKey: 'comicvine-key' },
  ranobedb: { enabled: true },
  kobo: { enabled: false, country: 'us', language: 'en' },
};

const providerConfig = { getConfig: () => Promise.resolve(CONFIG) } as unknown as ProviderConfigService;

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function malformedJson(): Response {
  return new Response('{"results": [', { status: 200, headers: { 'content-type': 'application/json' } });
}

function status(code: number): Response {
  return new Response('', { status: code });
}

const transportFailure: Handler = () => Promise.reject(new TypeError('fetch failed'));

function routeEgress(handler: Handler): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
    handler(new URL(input instanceof Request ? input.url : String(input)), init),
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

/** Why the metadata cache would refuse to store this call, in the order it checks. */
function cacheBlockers(record: ProviderCallRecord, authoritativeStatuses: readonly number[] = []): string[] {
  const blockers: string[] = [];
  if (record.mainRequests === 0) blockers.push('no_upstream');
  if (record.unsuccessfulRequests(authoritativeStatuses).length > 0) blockers.push('request_failed');
  if (record.failureReasons.length > 0) blockers.push('provider_failed');
  if (record.degradationReasons.length > 0) blockers.push('degraded');
  if (record.truncated) blockers.push('truncated');
  return blockers;
}

function comicIssue(id: number, volumeId: number) {
  return {
    id,
    name: 'Saga #1',
    issue_number: '1',
    cover_date: '2012-03-14',
    store_date: null,
    description: null,
    deck: null,
    image: null,
    volume: { id: volumeId, name: 'Saga' },
    site_detail_url: null,
    person_credits: [{ id: 1, name: 'Brian K. Vaughan', role: 'writer' }],
  };
}

interface TrustSuite {
  name: string;
  build: () => MetadataProvider;
  params: MetadataSearchParams;
  /** A 200 whose body is the API's own way of saying the request failed. */
  apiErrorBody: Handler;
  /** One item, or one detail request behind it, fails while the rest of the answer arrives. */
  partialFailure: Handler;
  genuineEmpty: Handler;
}

const TITLE_AUTHOR: MetadataSearchParams = { title: 'Dune', author: 'Frank Herbert' };
const AUDIOBOOK: MetadataSearchParams = { ...TITLE_AUTHOR, isAudiobook: true };

const SUITES: TrustSuite[] = [
  {
    name: 'google',
    build: () => new GoogleProvider(providerConfig),
    params: TITLE_AUTHOR,
    apiErrorBody: () => json({ error: { code: 403, message: 'Daily Limit Exceeded' } }),
    partialFailure: () => json({ kind: 'books#volumes', totalItems: 1, items: [{ id: 'no-volume-info' }] }),
    genuineEmpty: () => json({ kind: 'books#volumes', totalItems: 0 }),
  },
  {
    name: 'open-library',
    build: () => new OpenLibraryProvider(providerConfig),
    params: TITLE_AUTHOR,
    apiErrorBody: () => json({ error: 'Invalid query' }),
    partialFailure: () => json({ numFound: 1, docs: [{ title: 'Dune' }] }),
    genuineEmpty: () => json({ numFound: 0, start: 0, docs: [] }),
  },
  {
    name: 'itunes',
    build: () => new ITunesProvider(providerConfig),
    params: TITLE_AUTHOR,
    apiErrorBody: () => json({ errorMessage: 'Invalid value(s) for key(s): [term]', queryParameters: {} }),
    partialFailure: () =>
      json({
        resultCount: 2,
        results: [
          { kind: 'ebook', trackName: 'Without an id' },
          { kind: 'ebook', trackId: 1, trackName: 'Dune' },
        ],
      }),
    genuineEmpty: () => json({ resultCount: 0, results: [] }),
  },
  {
    name: 'hardcover',
    build: () => new HardcoverProvider(new HardcoverClient(), providerConfig),
    params: TITLE_AUTHOR,
    apiErrorBody: () => json({ errors: [{ message: 'field "search" not found in type: query_root' }] }),
    partialFailure: () => json({ data: { search: { results: { hits: [{ document: { id: '1', slug: 'dune' } }], found: 1 } } } }),
    genuineEmpty: () => json({ data: { search: { results: { hits: [], found: 0 } } } }),
  },
  {
    name: 'comicvine',
    build: () => new ComicVineProvider(new ComicVineClient(), providerConfig, new ProviderThrottleTracker()),
    params: { title: 'Saga' },
    apiErrorBody: () => json({ status_code: 100, error: 'Invalid API Key', results: [] }),
    partialFailure: (url) => (url.pathname.endsWith('/search/') ? json({ status_code: 1, error: 'OK', results: [comicIssue(1, 5)] }) : status(500)),
    genuineEmpty: () => json({ status_code: 1, error: 'OK', results: [] }),
  },
  {
    name: 'audible',
    build: () => new AudibleProvider(providerConfig),
    params: AUDIOBOOK,
    apiErrorBody: () => json({ message: 'Invalid response group' }),
    partialFailure: () => json({ products: [null], total_results: 1 }),
    genuineEmpty: () => json({ products: [], total_results: 0 }),
  },
  {
    name: 'audnexus',
    build: () => new AudnexusProvider(providerConfig),
    params: AUDIOBOOK,
    apiErrorBody: () => json({ message: 'Forbidden' }),
    partialFailure: (url) => {
      if (url.hostname === 'api.audible.com') return json({ products: [{ asin: 'B0TEST0001' }] });
      if (url.pathname.endsWith('/chapters')) return status(500);
      return json({ asin: 'B0TEST0001', title: 'Dune' });
    },
    genuineEmpty: () => json({ products: [], total_results: 0 }),
  },
  {
    name: 'ranobedb',
    build: () => new RanobeDbProvider(new RanobeDbClient(), providerConfig),
    params: { title: 'Sword Art Online' },
    apiErrorBody: () => json({ message: 'Internal Error' }),
    partialFailure: (url) => (url.pathname.endsWith('/books') ? json({ books: [{ id: 1 }], count: 1, currentPage: 1, totalPages: 1 }) : status(500)),
    genuineEmpty: () => json({ books: [], count: 0, currentPage: 1, totalPages: 0 }),
  },
];

describe('trusting empty answers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(SUITES)('$name', (suite) => {
    async function searchWith(handler: Handler) {
      routeEgress(handler);
      const provider = suite.build();
      return runRecorded(() => provider.search(suite.params));
    }

    it('declares trustEmpty', () => {
      expect(suite.build().cache?.trustEmpty).toBe(true);
    });

    it('1. does not pass a transport failure off as an empty answer', async () => {
      const { record } = await searchWith(transportFailure);
      expect(cacheBlockers(record)).toContain('request_failed');
    });

    it('2. does not pass malformed JSON off as an answer', async () => {
      const { record } = await searchWith(malformedJson);
      expect(record.mainRequests).toBeGreaterThan(0);
      expect(record.unsuccessfulRequests()).toEqual([]);
      expect(cacheBlockers(record)).toContain('provider_failed');
    });

    it('3. does not pass an API error inside a 200 off as an answer', async () => {
      const { record } = await searchWith(suite.apiErrorBody);
      expect(record.unsuccessfulRequests()).toEqual([]);
      expect(cacheBlockers(record)).toContain('provider_failed');
    });

    it('4. does not pass a partly failed answer off as complete', async () => {
      const { record } = await searchWith(suite.partialFailure);
      expect(cacheBlockers(record).length).toBeGreaterThan(0);
    });

    it('5. keeps a genuine empty answer cacheable', async () => {
      const { record, value, error } = await searchWith(suite.genuineEmpty);
      expect(error).toBeUndefined();
      expect(value).toEqual([]);
      expect(record.mainRequests).toBeGreaterThan(0);
      expect(cacheBlockers(record)).toEqual([]);
    });
  });
});

describe('authoritative lookup statuses', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const NOT_FOUND_LOOKUPS: Array<{ name: string; build: () => IdentifiableProvider; id: string }> = [
    { name: 'google', build: () => new GoogleProvider(providerConfig), id: 'missing' },
    { name: 'open-library', build: () => new OpenLibraryProvider(providerConfig), id: 'OL0W' },
    { name: 'comicvine', build: () => new ComicVineProvider(new ComicVineClient(), providerConfig, new ProviderThrottleTracker()), id: '999' },
    { name: 'ranobedb', build: () => new RanobeDbProvider(new RanobeDbClient(), providerConfig), id: '999' },
  ];

  it.each(NOT_FOUND_LOOKUPS)('$name keeps a 404 lookup as a not-found answer', async ({ build, id }) => {
    routeEgress(() => json({ error: 'not found' }, 404));
    const provider = build();
    const authoritative = provider.cache?.authoritativeLookupStatuses ?? [];

    const { record, value, error } = await runRecorded(() => provider.lookupById(id));

    expect(authoritative).toEqual([404]);
    expect(error).toBeUndefined();
    expect(value).toBeNull();
    expect(cacheBlockers(record, authoritative)).toEqual([]);
    expect(cacheBlockers(record)).toContain('request_failed');
  });

  it('does not let a failed Open Library genre fallback pass under the 404 rule', async () => {
    routeEgress((url) => (url.pathname.startsWith('/works/') ? json({ key: '/works/OL1W', title: 'Dune' }) : status(404)));
    const provider = new OpenLibraryProvider(providerConfig);

    const { record, value } = await runRecorded(() => provider.lookupById('OL1W'));

    expect(value).toMatchObject({ providerId: 'OL1W' });
    expect(cacheBlockers(record, [404])).toContain('degraded');
  });

  it('does not let a ComicVine issue missing its volume pass under the 404 rule', async () => {
    routeEgress((url) => (url.pathname.includes('/issue/') ? json({ status_code: 1, error: 'OK', results: comicIssue(1, 5) }) : status(404)));
    const provider = new ComicVineProvider(new ComicVineClient(), providerConfig, new ProviderThrottleTracker());

    const { record, value } = await runRecorded(() => provider.lookupById('1'));

    expect(value).toMatchObject({ providerId: '1' });
    expect(cacheBlockers(record, [404])).toContain('degraded');
  });

  it.each([
    { name: 'itunes', build: () => new ITunesProvider(providerConfig) as IdentifiableProvider, body: { resultCount: 0, results: [] } },
    {
      name: 'hardcover',
      build: () => new HardcoverProvider(new HardcoverClient(), providerConfig) as IdentifiableProvider,
      body: { data: { books: [] } },
    },
  ])('$name keeps an empty lookup answer cacheable', async ({ build, body }) => {
    routeEgress(() => json(body));
    const provider = build();

    const { record, value } = await runRecorded(() => provider.lookupById('missing'));

    expect(value).toBeNull();
    expect(cacheBlockers(record)).toEqual([]);
  });

  it.each([
    { name: 'google', build: () => new GoogleProvider(providerConfig) as IdentifiableProvider },
    { name: 'itunes', build: () => new ITunesProvider(providerConfig) as IdentifiableProvider },
    { name: 'audible', build: () => new AudibleProvider(providerConfig) as IdentifiableProvider },
    { name: 'hardcover', build: () => new HardcoverProvider(new HardcoverClient(), providerConfig) as IdentifiableProvider },
    { name: 'ranobedb', build: () => new RanobeDbProvider(new RanobeDbClient(), providerConfig) as IdentifiableProvider },
  ])('$name does not pass a malformed lookup body off as an answer', async ({ build }) => {
    routeEgress(malformedJson);
    const provider = build();

    const { record } = await runRecorded(() => provider.lookupById('12345'));

    expect(cacheBlockers(record)).toContain('provider_failed');
  });

  it.each([
    { name: 'audible', build: () => new AudibleProvider(providerConfig) as IdentifiableProvider, body: { message: 'error' } },
    { name: 'hardcover', build: () => new HardcoverProvider(new HardcoverClient(), providerConfig) as IdentifiableProvider, body: { errors: [{}] } },
  ])('$name does not cache a lookup error body as not found', async ({ build, body }) => {
    routeEgress(() => json(body));
    const provider = build();

    const { record, value } = await runRecorded(() => provider.lookupById('12345'));

    expect(value).toBeNull();
    expect(cacheBlockers(record)).toContain('provider_failed');
  });

  it('audnexus keeps an answer without chapter data cacheable', async () => {
    routeEgress((url) => (url.pathname.endsWith('/chapters') ? status(404) : json({ asin: 'B0TEST0001', title: 'Dune' })));
    const provider = new AudnexusProvider(providerConfig);

    const { record, value } = await runRecorded(() => provider.search({ ...AUDIOBOOK, existingProviderIds: { audible: 'B0TEST0001' } }));

    expect(value).toEqual([expect.objectContaining({ title: 'Dune' })]);
    expect(cacheBlockers(record)).toEqual([]);
  });
});
