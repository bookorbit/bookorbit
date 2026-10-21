import type { ConfigType } from '@nestjs/config';
import { MetadataProviderKey, type ProviderConfigurations } from '@bookorbit/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '../../../common/provider-cache/canonicalize';
import { providerRequestKey } from '../../../common/provider-cache/provider-call-context';
import type { CacheKeyDescriptor } from '../../../common/provider-cache/provider-cache-spec';
import type { appConfig } from '../../../config/config';
import type { ProviderConfigService } from '../../metadata-preferences/provider-config.service';
import { ProviderThrottleTracker } from '../provider-throttle.tracker';
import { AladinProvider } from './aladin/aladin.provider';
import { AmazonProvider } from './amazon/amazon.provider';
import { AudibleProvider } from './audible/audible.provider';
import { AudnexusProvider } from './audnexus/audnexus.provider';
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
import { LubimyczytacProvider } from './lubimyczytac/lubimyczytac.provider';
import { isIdentifiable, MetadataProvider } from './metadata-provider';
import { MetadataSearchParams } from './metadata-search-params';
import { OpenLibraryProvider } from './open-library/open-library.provider';
import { RanobeDbClient } from './ranobedb/ranobedb.client';
import { RanobeDbProvider } from './ranobedb/ranobedb.provider';

vi.mock('./provider-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provider-utils')>()),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./kobo/kobo-cloudscraper.fetcher', () => ({ fetchKoboHtmlWithCloudscraper: vi.fn() }));

const CONFIG: ProviderConfigurations = {
  google: { enabled: true, apiKey: 'google-secret' },
  amazon: { enabled: true, domain: 'amazon.de', cookie: 'session-token=amazon-secret; lc-main=de_DE; i18n-prefs=EUR; lc-acbde=de_DE' },
  goodreads: { enabled: true },
  hardcover: { enabled: true, apiKey: 'hardcover-secret' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'standard' },
  audible: { enabled: true, domain: 'co.uk' },
  audnexus: { enabled: true },
  librofm: { enabled: true },
  comicvine: { enabled: true, apiKey: 'comicvine-secret' },
  ranobedb: { enabled: true },
  kobo: { enabled: true, country: 'ca', language: 'fr' },
  lubimyczytac: { enabled: true },
  aladin: { enabled: true, ttbKey: 'aladin-secret' },
};

const SECRETS = ['google-secret', 'amazon-secret', 'hardcover-secret', 'comicvine-secret', 'aladin-secret'];

function buildProvider(key: MetadataProviderKey, config: ProviderConfigurations = CONFIG): MetadataProvider {
  const providerConfig = { getConfig: () => Promise.resolve(config) } as unknown as ProviderConfigService;
  switch (key) {
    case MetadataProviderKey.GOOGLE:
      return new GoogleProvider(providerConfig);
    case MetadataProviderKey.ITUNES:
      return new ITunesProvider(providerConfig);
    case MetadataProviderKey.AMAZON:
      return new AmazonProvider(providerConfig);
    case MetadataProviderKey.KOBO:
      return new KoboProvider(providerConfig, { koboCloudscraperPython: undefined } as ConfigType<typeof appConfig>);
    case MetadataProviderKey.GOODREADS:
      return new GoodreadsProvider(providerConfig);
    case MetadataProviderKey.LIBROFM:
      return new LibroFmProvider(providerConfig);
    case MetadataProviderKey.AUDNEXUS:
      return new AudnexusProvider(providerConfig);
    case MetadataProviderKey.AUDIBLE:
      return new AudibleProvider(providerConfig);
    case MetadataProviderKey.LUBIMYCZYTAC:
      return new LubimyczytacProvider(providerConfig);
    case MetadataProviderKey.HARDCOVER:
      return new HardcoverProvider(new HardcoverClient(), providerConfig);
    case MetadataProviderKey.COMICVINE:
      return new ComicVineProvider(new ComicVineClient(), providerConfig, new ProviderThrottleTracker());
    case MetadataProviderKey.OPEN_LIBRARY:
      return new OpenLibraryProvider(providerConfig);
    case MetadataProviderKey.ALADIN:
      return new AladinProvider(providerConfig);
    case MetadataProviderKey.RANOBEDB:
      return new RanobeDbProvider(new RanobeDbClient(), providerConfig);
    default:
      throw new Error(`no test factory for ${String(key)}`);
  }
}

const BASE: MetadataSearchParams = {
  title: 'Dune',
  author: 'Frank Herbert',
  isbn: '9780441172719',
  seriesName: 'Dune Chronicles',
  seriesIndex: '1',
  titleIsExplicitQuery: false,
  existingProviderIds: {},
  existingProviderIdsOnly: false,
  hardcoverEditionId: '42',
  isAudiobook: true,
  includeAudiobookProviders: true,
  maxCandidatesPerProvider: 2,
  requireUnambiguousMatch: false,
  validateCoverPlaceholders: true,
};
const WITHOUT_ISBN: MetadataSearchParams = { ...BASE, isbn: undefined };

type Mutation =
  | 'signal'
  | 'existingProviderIdsOnly'
  | 'includeAudiobookProviders'
  | 'seriesName'
  | 'seriesIndex'
  | 'titleIsExplicitQuery'
  | 'validateCoverPlaceholders'
  | 'maxCandidatesPerProvider'
  | 'resultsPerProvider'
  | 'requireUnambiguousMatch'
  | 'hardcoverEditionId'
  | 'isAudiobook'
  | 'existingProviderIds';

const MUTATIONS: Record<Mutation, (params: MetadataSearchParams) => MetadataSearchParams> = {
  signal: (params) => ({ ...params, signal: new AbortController().signal }),
  existingProviderIdsOnly: (params) => ({ ...params, existingProviderIdsOnly: true }),
  // Turns the audiobook gate off: isAudiobook only applies when this is absent.
  includeAudiobookProviders: (params) => ({ ...params, includeAudiobookProviders: false }),
  seriesName: (params) => ({ ...params, seriesName: 'Other Series' }),
  seriesIndex: (params) => ({ ...params, seriesIndex: '7' }),
  titleIsExplicitQuery: (params) => ({ ...params, titleIsExplicitQuery: true }),
  validateCoverPlaceholders: (params) => ({ ...params, validateCoverPlaceholders: false }),
  maxCandidatesPerProvider: (params) => ({ ...params, maxCandidatesPerProvider: 1 }),
  resultsPerProvider: (params) => ({ ...params, resultsPerProvider: 20 }),
  requireUnambiguousMatch: (params) => ({ ...params, requireUnambiguousMatch: true }),
  hardcoverEditionId: (params) => ({ ...params, hardcoverEditionId: '99' }),
  // Leaves the audiobook gate on, since includeAudiobookProviders is set.
  isAudiobook: (params) => ({ ...params, isAudiobook: false }),
  existingProviderIds: (params) => ({
    ...params,
    existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0OTHER000', [MetadataProviderKey.LIBROFM]: '9780000000000' },
  }),
};

const ALL_MUTATIONS = Object.keys(MUTATIONS) as Mutation[];

interface DeclarationCase {
  key: MetadataProviderKey;
  withIsbn: Record<string, unknown>;
  withoutIsbn: Record<string, unknown>;
  /** Mutations the search key may legitimately change for. Every other one must leave it alone. */
  searchReads: Mutation[];
  honoursMax: boolean;
  /** Undefined when the provider is not identifiable. */
  lookup?: { inputs: Record<string, unknown>; reads: Mutation[] };
  fingerprint: Record<string, unknown>;
}

const TITLE_AUTHOR = { title: 'Dune', author: 'Frank Herbert' };
const ISBN_ONLY = { isbn: '9780441172719' };
const LOOKUP_ID = { inputs: { id: 'provider-id' }, reads: [] as Mutation[] };

const CASES: DeclarationCase[] = [
  {
    key: MetadataProviderKey.GOOGLE,
    withIsbn: ISBN_ONLY,
    withoutIsbn: TITLE_AUTHOR,
    searchReads: ['validateCoverPlaceholders', 'resultsPerProvider'],
    honoursMax: false,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.ITUNES,
    withIsbn: { ...ISBN_ONLY, isAudiobook: true },
    withoutIsbn: { ...TITLE_AUTHOR, isAudiobook: true },
    searchReads: ['isAudiobook'],
    honoursMax: false,
    lookup: { inputs: { id: 'provider-id', isAudiobook: true }, reads: ['isAudiobook'] },
    fingerprint: { coverResolution: 'standard' },
  },
  {
    key: MetadataProviderKey.AMAZON,
    withIsbn: ISBN_ONLY,
    withoutIsbn: TITLE_AUTHOR,
    searchReads: ['maxCandidatesPerProvider'],
    honoursMax: true,
    lookup: LOOKUP_ID,
    fingerprint: { domain: 'amazon.de', hasCookie: true, localeCookies: { 'i18n-prefs': 'EUR', 'lc-acbde': 'de_DE', 'lc-main': 'de_DE' } },
  },
  {
    key: MetadataProviderKey.KOBO,
    withIsbn: ISBN_ONLY,
    withoutIsbn: TITLE_AUTHOR,
    searchReads: ['maxCandidatesPerProvider'],
    honoursMax: true,
    lookup: LOOKUP_ID,
    fingerprint: { country: 'ca', language: 'fr' },
  },
  {
    key: MetadataProviderKey.GOODREADS,
    withIsbn: { ...TITLE_AUTHOR, ...ISBN_ONLY },
    withoutIsbn: TITLE_AUTHOR,
    searchReads: [],
    honoursMax: false,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.LIBROFM,
    withIsbn: { directId: '9780441172719', audiobook: true },
    withoutIsbn: { ...TITLE_AUTHOR, audiobook: true },
    searchReads: ['includeAudiobookProviders', 'existingProviderIds', 'maxCandidatesPerProvider'],
    honoursMax: true,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.AUDNEXUS,
    withIsbn: { ...TITLE_AUTHOR, audiobook: true },
    withoutIsbn: { ...TITLE_AUTHOR, audiobook: true },
    searchReads: ['includeAudiobookProviders', 'existingProviderIds'],
    honoursMax: false,
    fingerprint: { domain: 'co.uk' },
  },
  {
    key: MetadataProviderKey.AUDIBLE,
    withIsbn: { ...TITLE_AUTHOR, audiobook: true },
    withoutIsbn: { ...TITLE_AUTHOR, audiobook: true },
    searchReads: ['includeAudiobookProviders'],
    honoursMax: false,
    lookup: LOOKUP_ID,
    fingerprint: { domain: 'co.uk' },
  },
  {
    key: MetadataProviderKey.LUBIMYCZYTAC,
    withIsbn: { query: 'Dune', author: 'Frank Herbert' },
    withoutIsbn: { query: 'Dune', author: 'Frank Herbert' },
    searchReads: ['maxCandidatesPerProvider'],
    honoursMax: true,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.HARDCOVER,
    withIsbn: { ...TITLE_AUTHOR, ...ISBN_ONLY, isAudiobook: true, hardcoverEditionId: '42' },
    withoutIsbn: { ...TITLE_AUTHOR, isAudiobook: true, hardcoverEditionId: '42' },
    searchReads: ['isAudiobook', 'hardcoverEditionId', 'resultsPerProvider'],
    honoursMax: false,
    lookup: {
      inputs: { id: 'provider-id', isAudiobook: true, hardcoverEditionId: '42', isbn: '9780441172719' },
      reads: ['isAudiobook', 'hardcoverEditionId'],
    },
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.COMICVINE,
    withIsbn: { title: 'Dune', seriesName: 'Dune Chronicles', seriesIndex: '1', titleIsExplicitQuery: false, requireUnambiguousMatch: false },
    withoutIsbn: { title: 'Dune', seriesName: 'Dune Chronicles', seriesIndex: '1', titleIsExplicitQuery: false, requireUnambiguousMatch: false },
    searchReads: ['seriesName', 'seriesIndex', 'titleIsExplicitQuery', 'maxCandidatesPerProvider', 'requireUnambiguousMatch'],
    honoursMax: true,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.OPEN_LIBRARY,
    withIsbn: ISBN_ONLY,
    withoutIsbn: TITLE_AUTHOR,
    searchReads: ['resultsPerProvider'],
    honoursMax: false,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.ALADIN,
    withIsbn: ISBN_ONLY,
    withoutIsbn: TITLE_AUTHOR,
    searchReads: [],
    honoursMax: false,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
  {
    key: MetadataProviderKey.RANOBEDB,
    withIsbn: TITLE_AUTHOR,
    withoutIsbn: TITLE_AUTHOR,
    searchReads: [],
    honoursMax: false,
    lookup: LOOKUP_ID,
    fingerprint: {},
  },
];

function descriptorKey(descriptor: CacheKeyDescriptor | null): string {
  return canonicalJson(descriptor);
}

function specOf(key: MetadataProviderKey, config?: ProviderConfigurations) {
  const spec = buildProvider(key, config).cache;
  if (!spec) throw new Error(`${key} declares no cache`);
  return spec;
}

describe('provider cache declarations', () => {
  it('covers every book provider', () => {
    expect(CASES.map((c) => c.key).sort()).toEqual(
      [
        MetadataProviderKey.GOOGLE,
        MetadataProviderKey.ITUNES,
        MetadataProviderKey.AMAZON,
        MetadataProviderKey.KOBO,
        MetadataProviderKey.GOODREADS,
        MetadataProviderKey.LIBROFM,
        MetadataProviderKey.AUDNEXUS,
        MetadataProviderKey.AUDIBLE,
        MetadataProviderKey.LUBIMYCZYTAC,
        MetadataProviderKey.HARDCOVER,
        MetadataProviderKey.COMICVINE,
        MetadataProviderKey.OPEN_LIBRARY,
        MetadataProviderKey.ALADIN,
        MetadataProviderKey.RANOBEDB,
      ].sort(),
    );
  });

  describe.each(CASES)('$key', (testCase) => {
    it('declares the current mapping version', () => {
      const bumped: Partial<Record<MetadataProviderKey, number>> = {
        [MetadataProviderKey.COMICVINE]: 2,
        [MetadataProviderKey.HARDCOVER]: 2,
      };
      expect(specOf(testCase.key).version).toBe(bumped[testCase.key] ?? 1);
    });

    it('keys a search on the fields it reads', () => {
      const spec = specOf(testCase.key);
      expect(spec.describeSearch(BASE)?.inputs).toEqual(testCase.withIsbn);
      expect(spec.describeSearch(WITHOUT_ISBN)?.inputs).toEqual(testCase.withoutIsbn);
    });

    it('declares a result cap only when it honours one, and cover validation only for Google', () => {
      const descriptor = specOf(testCase.key).describeSearch(WITHOUT_ISBN);
      if (testCase.honoursMax) expect(descriptor?.maxCandidates).toBe(2);
      else expect(descriptor).not.toHaveProperty('maxCandidates');
      if (testCase.key === MetadataProviderKey.GOOGLE) expect(descriptor?.coverValidation).toBe(true);
      else expect(descriptor).not.toHaveProperty('coverValidation');
    });

    const ignored = ALL_MUTATIONS.filter((mutation) => !testCase.searchReads.includes(mutation));
    it.each(ignored)('leaves the search key alone when %s changes', (mutation) => {
      const spec = specOf(testCase.key);
      for (const base of [BASE, WITHOUT_ISBN]) {
        expect(descriptorKey(spec.describeSearch(MUTATIONS[mutation](base)))).toBe(descriptorKey(spec.describeSearch(base)));
      }
    });

    it('keys a lookup on the id and only the fields it reads', () => {
      const spec = specOf(testCase.key);
      if (!testCase.lookup) {
        expect(spec.describeLookup('provider-id', BASE)).toBeNull();
        return;
      }
      expect(spec.describeLookup('provider-id', BASE)?.inputs).toEqual(testCase.lookup.inputs);
      for (const mutation of ALL_MUTATIONS.filter((m) => !testCase.lookup!.reads.includes(m))) {
        expect(descriptorKey(spec.describeLookup('provider-id', MUTATIONS[mutation](BASE)))).toBe(
          descriptorKey(spec.describeLookup('provider-id', BASE)),
        );
      }
    });

    it('fingerprints result-affecting configuration and never a secret', async () => {
      const context = await specOf(testCase.key).context();
      expect(context.available).toBe(true);
      expect(JSON.parse(context.fingerprint)).toEqual(testCase.fingerprint);
      for (const secret of SECRETS) expect(context.fingerprint).not.toContain(secret);
    });
  });

  describe('availability', () => {
    const disabled = (config: ProviderConfigurations): ProviderConfigurations =>
      Object.fromEntries(Object.entries(config).map(([key, value]) => [key, { ...value, enabled: false }])) as unknown as ProviderConfigurations;

    it.each(CASES.map((c) => c.key))('%s is unavailable when disabled', async (key) => {
      expect((await specOf(key, disabled(CONFIG)).context()).available).toBe(false);
    });

    it.each([
      [MetadataProviderKey.GOOGLE, { ...CONFIG, google: { enabled: true, apiKey: '   ' } }],
      [MetadataProviderKey.HARDCOVER, { ...CONFIG, hardcover: { enabled: true, apiKey: '' } }],
      [MetadataProviderKey.COMICVINE, { ...CONFIG, comicvine: { enabled: true, apiKey: '' } }],
      [MetadataProviderKey.ALADIN, { ...CONFIG, aladin: { enabled: true, ttbKey: ' ' } }],
    ])('%s is unavailable without its credential', async (key, config) => {
      expect((await specOf(key, config).context()).available).toBe(false);
    });

    it('fingerprints an Amazon cookie by presence and locale only', async () => {
      const withoutLocale = await specOf(MetadataProviderKey.AMAZON, {
        ...CONFIG,
        amazon: { enabled: true, domain: 'amazon.com', cookie: 'session-id=1' },
      }).context();
      const withoutCookie = await specOf(MetadataProviderKey.AMAZON, {
        ...CONFIG,
        amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      }).context();
      expect(JSON.parse(withoutLocale.fingerprint)).toEqual({ domain: 'amazon.com', hasCookie: true, localeCookies: {} });
      expect(JSON.parse(withoutCookie.fingerprint)).toEqual({ domain: 'amazon.com', hasCookie: false, localeCookies: {} });
    });
  });

  describe('special cases', () => {
    it.each([MetadataProviderKey.GOOGLE, MetadataProviderKey.HARDCOVER, MetadataProviderKey.OPEN_LIBRARY])(
      'keys %s on a widened page only, so a default-sized answer keeps its key',
      (key) => {
        const spec = specOf(key);
        const pageSize = (resultsPerProvider: number | undefined) => spec.describeSearch({ ...WITHOUT_ISBN, resultsPerProvider })?.inputs.pageSize;
        expect(pageSize(undefined)).toBeUndefined();
        expect(pageSize(5)).toBeUndefined();
        expect(pageSize(10)).toBeUndefined();
        expect(pageSize(20)).toBe(20);
      },
    );

    it('keys iTunes searches on an absent medium as an ebook, but keeps lookups tri-state', () => {
      const spec = specOf(MetadataProviderKey.ITUNES);
      const absent = { ...WITHOUT_ISBN, isAudiobook: undefined };
      expect(descriptorKey(spec.describeSearch(absent))).toBe(descriptorKey(spec.describeSearch({ ...WITHOUT_ISBN, isAudiobook: false })));
      expect(spec.describeLookup('1', undefined)?.inputs).toEqual({ id: '1' });
      expect(descriptorKey(spec.describeLookup('1', absent))).not.toBe(descriptorKey(spec.describeLookup('1', { ...absent, isAudiobook: false })));
    });

    it('keys Libro.fm on a stored id ahead of the ISBN', () => {
      const spec = specOf(MetadataProviderKey.LIBROFM);
      const params = { ...BASE, existingProviderIds: { [MetadataProviderKey.LIBROFM]: 'stored-id' } };
      expect(spec.describeSearch(params)).toEqual({ inputs: { directId: 'stored-id', audiobook: true } });
    });

    it('keys AudNexus on a stored Audible id instead of title and author', () => {
      const spec = specOf(MetadataProviderKey.AUDNEXUS);
      const params = { ...BASE, existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0STORED00' } };
      expect(spec.describeSearch(params)?.inputs).toEqual({ audibleId: 'B0STORED00', audiobook: true });
      expect(descriptorKey(spec.describeSearch({ ...params, title: 'Other' }))).toBe(descriptorKey(spec.describeSearch(params)));
    });

    it('keys LubimyCzytac on the ISBN when no title is given', () => {
      const spec = specOf(MetadataProviderKey.LUBIMYCZYTAC);
      expect(spec.describeSearch({ ...BASE, title: undefined })?.inputs).toEqual({ query: '9780441172719', author: 'Frank Herbert' });
    });

    it('keys the audiobook gate for audiobook-only providers', () => {
      for (const key of [MetadataProviderKey.AUDIBLE, MetadataProviderKey.AUDNEXUS, MetadataProviderKey.LIBROFM]) {
        const spec = specOf(key);
        expect(spec.describeSearch({ ...WITHOUT_ISBN, includeAudiobookProviders: undefined, isAudiobook: false })?.inputs).toMatchObject({
          audiobook: false,
        });
      }
    });

    it('declares trustEmpty only for API providers', () => {
      const trusting = CASES.filter((c) => specOf(c.key).trustEmpty).map((c) => c.key);
      for (const scraper of [
        MetadataProviderKey.AMAZON,
        MetadataProviderKey.GOODREADS,
        MetadataProviderKey.KOBO,
        MetadataProviderKey.LUBIMYCZYTAC,
        MetadataProviderKey.LIBROFM,
      ]) {
        expect(trusting).not.toContain(scraper);
      }
    });
  });
});

describe('provider egress ignores fields outside the cache key', () => {
  const requestKeys: string[] = [];

  beforeEach(() => {
    requestKeys.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      requestKeys.push(providerRequestKey(url, init));
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    vi.mocked(fetchKoboHtmlWithCloudscraper).mockImplementation((url) => {
      requestKeys.push(providerRequestKey(url));
      return Promise.resolve({ status: 200, url, headers: {}, html: '', attempts: 1, challenge: false });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function outgoing(key: MetadataProviderKey, params: MetadataSearchParams, op: 'search' | 'lookup'): Promise<string[]> {
    requestKeys.length = 0;
    const provider = buildProvider(key);
    try {
      if (op === 'search') await provider.search(params);
      // Numeric, so providers that validate the id shape still send their request.
      else if (isIdentifiable(provider)) await provider.lookupById('12345', params.signal, params);
    } catch {
      // Minimal stub bodies make some providers throw after they have sent their requests.
    }
    return [...requestKeys];
  }

  describe.each(CASES)('$key', (testCase) => {
    const ignored = ALL_MUTATIONS.filter((mutation) => !testCase.searchReads.includes(mutation));

    it.each(ignored)('sends the same search requests when %s changes', async (mutation) => {
      for (const base of [BASE, WITHOUT_ISBN]) {
        const expected = await outgoing(testCase.key, base, 'search');
        expect(expected.length).toBeGreaterThan(0);
        expect(await outgoing(testCase.key, MUTATIONS[mutation](base), 'search')).toEqual(expected);
      }
    });

    if (testCase.lookup) {
      const lookupIgnored = ALL_MUTATIONS.filter((mutation) => !testCase.lookup!.reads.includes(mutation));
      it.each(lookupIgnored)('sends the same lookup requests when %s changes', async (mutation) => {
        const expected = await outgoing(testCase.key, BASE, 'lookup');
        expect(expected.length).toBeGreaterThan(0);
        expect(await outgoing(testCase.key, MUTATIONS[mutation](BASE), 'lookup')).toEqual(expected);
      });
    }
  });
});
