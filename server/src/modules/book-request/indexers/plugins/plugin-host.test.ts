import type { IndexerPlugin, PluginHost } from '@bookorbit/plugin-api';

/**
 * A plugin's URLs are tracker-chosen, so the host pins the connection to the address that passed
 * policy - and that path goes through undici's fetch rather than the global one. The wrapper is
 * what is under test, so undici is pointed back at the stub each test installs; what the
 * dispatcher itself does is proven in `safe-fetch.test.ts`.
 */
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

/** Every name in these tests is a stand-in, so one public answer stands for all of them. */
vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

import type { IndexerCredentialStore } from '../indexer-credential-store';
import { IndexerSearchException, type ReleaseQuery, type ResolvedIndexerConfig } from '../indexer-adapter';
import { PluginIndexerAdapter } from './plugin-host';

function config(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
  return {
    id: 4,
    name: 'Example Tracker',
    adapterType: 'torznab',
    baseUrl: 'https://tracker.example.com',
    credential: 'a-key',
    allowPrivateAddress: false,
    categories: { ebook: [7020], audiobook: [3030], comic: [7030] },
    settings: null,
    ...overrides,
  };
}

function query(overrides: Partial<ReleaseQuery> = {}): ReleaseQuery {
  return { title: 'Dune', author: 'Frank Herbert', isbn13: null, isbn13s: [], mediaKind: 'ebook', language: null, limit: 20, ...overrides };
}

function plugin(overrides: Partial<IndexerPlugin> = {}): IndexerPlugin {
  return {
    apiVersion: 1,
    version: '1.2.3',
    type: 'example-tracker',
    label: 'Example Tracker',
    requiresCredential: true,
    credentialKind: 'apiKey',
    mediaKinds: ['ebook'],
    usesCategories: true,
    seedsBack: true,
    search: () => Promise.resolve([]),
    test: () => Promise.resolve({ success: true }),
    fetchTorrentFile: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<IndexerPlugin> = {}) {
  const credentials = { rotate: vi.fn().mockResolvedValue(true) } as unknown as IndexerCredentialStore;
  return { adapter: new PluginIndexerAdapter(plugin(overrides), credentials), credentials };
}

describe('PluginIndexerAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('presents a plugin as an ordinary adapter', () => {
    const { adapter } = makeAdapter();

    expect(adapter.type).toBe('example-tracker');
    expect(adapter.mediaKinds).toEqual(['ebook']);
    expect(adapter.requiresCredential).toBe(true);
  });

  /** The rest of the module keys releases by indexer, and a plugin has no business setting that. */
  it('stamps the indexer id on what a plugin returns', async () => {
    const { adapter } = makeAdapter({
      search: () => Promise.resolve([{ guid: 'g1', title: 'Dune', sizeBytes: null, seeders: null, leechers: null }]),
    });

    const [release] = await adapter.search(query(), config({ id: 11 }), AbortSignal.timeout(1000));

    expect(release.indexerId).toBe(11);
  });

  /**
   * A plugin is hand-written JavaScript with no compile-time contract, and the merge scores every
   * candidate outside the per-indexer failure accounting: one malformed row used to throw out of
   * the whole search and 500 the picker for every indexer that answered perfectly well.
   */
  describe('what a plugin says it found', () => {
    async function searched(releases: unknown) {
      const { adapter } = makeAdapter({ search: () => Promise.resolve(releases as never) });
      return adapter.search(query(), config(), AbortSignal.timeout(1000));
    }

    it('drops a row with no usable title or guid rather than failing the search', async () => {
      const releases = await searched([
        { guid: 'g1', title: { name: 'Dune' }, sizeBytes: null, seeders: null, leechers: null },
        { guid: null, title: 'Dune', sizeBytes: null, seeders: null, leechers: null },
        { guid: 'g3', title: '   ', sizeBytes: null, seeders: null, leechers: null },
        undefined,
        { guid: 'g5', title: 'Dune', sizeBytes: null, seeders: null, leechers: null },
      ]);

      expect(releases.map((r) => r.guid)).toEqual(['g5']);
    });

    /** "1984" and "2001" are books, and a source that states one as a number still means the title. */
    it('keeps a title or a guid a source stated as a number', async () => {
      const [release] = await searched([{ guid: 4471, title: 1984 }]);

      expect(release).toMatchObject({ guid: '4471', title: '1984' });
    });

    /**
     * `undefined` is the one that used to leak: the scorer reads "the indexer stated a count" as
     * anything that is not null, so an absent seeder count scored `NaN` and broke the sort, and an
     * absent size rendered as "NaN KB" with a penalty attached.
     */
    it('turns an unstated number into null rather than undefined', async () => {
      const [release] = await searched([{ guid: 'g1', title: 'Dune' }]);

      expect(release.seeders).toBeNull();
      expect(release.sizeBytes).toBeNull();
      expect(release.leechers).toBeNull();
    });

    it('coerces numeric strings and rejects values that are not non-negative finite numbers', async () => {
      const [release] = await searched([{ guid: 'g1', title: 'Dune', sizeBytes: '2000000', seeders: '0', leechers: -1 }]);

      expect(release.sizeBytes).toBe(2_000_000);
      expect(release.seeders).toBe(0);
      expect(release.leechers).toBeNull();
    });

    it('reads a flag as the boolean it is meant to be', async () => {
      const [release] = await searched([{ guid: 'g1', title: 'Dune', freeleech: 'yes', vipOnly: 1, alreadyGrabbed: null }]);

      expect(release.freeleech).toBe(false);
      expect(release.vipOnly).toBe(false);
      expect(release.alreadyGrabbed).toBe(false);
    });

    it('nulls an unreadable audio figure without losing the release', async () => {
      const [release] = await searched([{ guid: 'g1', title: 'Dune', audio: { bitrateKbps: 'lots', channels: 2 } }]);

      expect(release.audio).toEqual({
        bitrateKbps: null,
        bitrateMode: null,
        channels: 2,
        samplingRateHz: null,
        durationSeconds: null,
        chapterCount: null,
      });
    });

    it('caps how many releases one source can hand back', async () => {
      const releases = await searched(Array.from({ length: 500 }, (_, index) => ({ guid: `g${index}`, title: 'Dune' })));

      expect(releases).toHaveLength(200);
    });

    it('reports something that is not a list as an indexer failure', async () => {
      await expect(searched({ releases: [] })).rejects.toBeInstanceOf(IndexerSearchException);
    });
  });

  /** Only `fetchTorrentFile` or `resolveFile` is exposed, matching what the plugin declared. */
  it('exposes only the grab path the plugin declared', () => {
    expect(makeAdapter().resolveFile).toBeUndefined();
    expect(makeAdapter().adapter.fetchTorrentFile).toBeDefined();

    const direct = makeAdapter({
      fetchTorrentFile: undefined,
      resolveFile: () => Promise.resolve({ url: 'https://x/y.epub', fileName: 'y.epub', sizeBytes: 1, format: 'epub' }),
    });
    expect(direct.adapter.resolveFile).toBeDefined();
    expect(direct.adapter.fetchTorrentFile).toBeUndefined();
  });

  describe('containment', () => {
    /**
     * The reason the host lends a `fetch` rather than letting a plugin use the global one: this is
     * where the address policy is applied, and a plugin must not be able to opt out of it.
     */
    it('refuses a host fetch to a private address', async () => {
      let host!: PluginHost;
      const { adapter } = makeAdapter({
        search: (_q, _c, given) => {
          host = given;
          return Promise.resolve([]);
        },
      });
      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      await expect(host.fetch('http://127.0.0.1:8080/internal')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows a private address only where the row opted in', async () => {
      fetchMock.mockResolvedValue(new Response('ok'));
      let host!: PluginHost;
      const { adapter } = makeAdapter({
        search: (_q, _c, given) => {
          host = given;
          return Promise.resolve([]);
        },
      });
      await adapter.search(query(), config({ allowPrivateAddress: true }), AbortSignal.timeout(1000));

      await expect(host.fetch('http://127.0.0.1:8080/proxy')).resolves.toBeDefined();
    });

    /**
     * A plugin can only check its signal between requests, so the deadline has to reach the
     * request already in flight. Without this a source that stalls runs the full per-request
     * ceiling and the shorter per-indexer deadline passes unheard.
     */
    it('ends a plugin request when the search deadline expires, not only its own ceiling', async () => {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as RequestInit | undefined)?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason as Error));
          }),
      );
      const { adapter } = makeAdapter({
        search: (_q, _c, host) => host.fetch('http://127.0.0.1:8080/slow').then(() => []),
      });

      await expect(adapter.search(query(), config({ allowPrivateAddress: true }), AbortSignal.timeout(20))).rejects.toMatchObject({
        failure: 'timeout',
      });
    });

    /**
     * The deadline reaches a plugin's fetches and nothing else. One awaiting a promise of its own
     * that never settles used to hold a search slot for the life of the process, and the
     * `Promise.all` over the indexers never resolved: a picker spinning with no error on it.
     */
    it('ends a search a plugin never returns from', async () => {
      const { adapter } = makeAdapter({ search: () => new Promise(() => {}) });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(20))).rejects.toMatchObject({ failure: 'timeout' });
    });

    /** The one value a plugin produces that a download client then opens on its own. */
    it('checks the URL a plugin resolves before it reaches a download client', async () => {
      const { adapter } = makeAdapter({
        fetchTorrentFile: undefined,
        resolveFile: () => Promise.resolve({ url: 'http://169.254.169.254/latest/meta-data', fileName: 'x.epub', sizeBytes: 1, format: 'epub' }),
      });

      await expect(
        adapter.resolveFile!(
          { indexerId: 4, guid: 'g', title: 't', sizeBytes: null, seeders: null, leechers: null },
          config(),
          AbortSignal.timeout(1000),
        ),
      ).rejects.toThrow();
    });

    it('refuses a torrent file too large to be one', async () => {
      const { adapter } = makeAdapter({ fetchTorrentFile: () => Promise.resolve(new Uint8Array(4 * 1024 * 1024)) });

      await expect(
        adapter.fetchTorrentFile!({ indexerId: 4, guid: 'g', title: 't', sizeBytes: null, seeders: null, leechers: null }, config()),
      ).rejects.toThrow(/too large/);
    });

    /**
     * `redirect: 'follow'` checks the URL the plugin named and nothing after it, so the hops are
     * taken here instead: the guarantee the host makes is about every address, not the first one.
     */
    it('checks each hop of a redirect rather than only the URL a plugin named', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
      let failure: unknown;
      const { adapter } = makeAdapter({
        search: async (_q, _c, host) => {
          failure = await host.fetch('https://tracker.example.com/grab').catch((error: unknown) => error);
          return [];
        },
      });

      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/private or local/);
      // The metadata address was never opened: the refusal happened between the hops.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('follows a redirect to a public address and returns what it answered', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/page' } }))
        .mockResolvedValueOnce(new Response('the page'));
      let body!: string;
      const { adapter } = makeAdapter({
        search: async (_q, _c, host) => {
          body = await host.fetch('https://tracker.example.com/page').then((response) => response.text());
          return [];
        },
      });

      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      expect(body).toBe('the page');
      expect(new URL(fetchMock.mock.calls.at(-1)![0] as string).href).toBe('https://cdn.example.com/page');
    });

    /**
     * A redirect to the login page is how an expired session announces itself, so a plugin that
     * asked to see it still gets the 3xx rather than a body fetched from wherever it pointed.
     */
    it('hands a plugin the redirect itself where it asked for one', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: '/login.php' } }));
      let status!: number;
      const { adapter } = makeAdapter({
        search: async (_q, _c, host) => {
          status = await host.fetch('https://tracker.example.com/api', { redirect: 'manual' }).then((response) => response.status);
          return [];
        },
      });

      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      expect(status).toBe(302);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /**
     * A plugin posts a search and authenticates with a session cookie, so replaying the body or
     * carrying the cookie onward would send a tracker's credential wherever the redirect pointed.
     * `redirect: 'follow'` applied both rules for us; following by hand has to apply them too.
     */
    it('drops the body and the credential when a POST is redirected to another host', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/results' } }))
        .mockResolvedValueOnce(new Response('the results'));
      const { adapter } = makeAdapter({
        search: async (_q, _c, host) => {
          await host.fetch('https://tracker.example.com/search', {
            method: 'POST',
            body: 'q=dune',
            headers: { Cookie: 'session=secret', Accept: 'text/html' },
          });
          return [];
        },
      });

      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      const second = fetchMock.mock.calls[1][1] as RequestInit;
      expect(second.method).toBe('GET');
      expect(second.body).toBeUndefined();
      expect(second.headers).toEqual({ Accept: 'text/html' });
    });

    /** Same host, same request: the rules are about crossing an origin, not about redirecting. */
    it('keeps the credential on a redirect that stays on the same host', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/results' } }))
        .mockResolvedValueOnce(new Response('the results'));
      const { adapter } = makeAdapter({
        search: async (_q, _c, host) => {
          await host.fetch('https://tracker.example.com/search', { headers: { Cookie: 'session=secret' } });
          return [];
        },
      });

      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ Cookie: 'session=secret' });
    });

    /** 307 exists precisely to say "same request, new address", so the body survives. */
    it('replays the body on a 307 that stays on the same host', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/v2/search' } }))
        .mockResolvedValueOnce(new Response('the results'));
      const { adapter } = makeAdapter({
        search: async (_q, _c, host) => {
          await host.fetch('https://tracker.example.com/search', { method: 'POST', body: 'q=dune' });
          return [];
        },
      });

      await adapter.search(query(), config(), AbortSignal.timeout(1000));

      const second = fetchMock.mock.calls[1][1] as RequestInit;
      expect(second.method).toBe('POST');
      expect(second.body).toBe('q=dune');
    });

    it('gives up rather than following a redirect loop forever', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://tracker.example.com/again' } }));
      const { adapter } = makeAdapter({
        search: (_q, _c, host) => host.fetch('https://tracker.example.com/start').then(() => []),
      });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(1000))).rejects.toThrow(/redirected more than/);
    });

    /** What a plugin reads is a page or a feed, and how much of one it reads is not its choice. */
    it('stops a plugin reading past the response ceiling', async () => {
      let pulls = 0;
      const chunk = 256 * 1024;
      const endless = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(chunk));
          },
        },
        { highWaterMark: 0 },
      );
      fetchMock.mockResolvedValue(new Response(endless));
      const { adapter } = makeAdapter({
        search: (_q, _c, host) =>
          host
            .fetch('https://tracker.example.com/huge')
            .then((response) => response.text())
            .then(() => []),
      });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(5000))).rejects.toBeInstanceOf(IndexerSearchException);
      expect(pulls).toBe((16 * 1024 * 1024) / chunk + 1);
    });

    it('refuses a response that declares itself past the ceiling before it is read', async () => {
      fetchMock.mockResolvedValue(new Response('x', { headers: { 'content-length': String(64 * 1024 * 1024) } }));
      const { adapter } = makeAdapter({
        search: (_q, _c, host) => host.fetch('https://tracker.example.com/huge').then(() => []),
      });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(1000))).rejects.toThrow(/larger than/);
    });

    /** A plugin holding our own object could otherwise mutate the config every adapter shares. */
    it('hands the plugin a copy of the config rather than the original', async () => {
      const original = config();
      let seen!: { categories: { ebook: number[] } };
      const { adapter } = makeAdapter({
        search: (_q, given) => {
          seen = given;
          given.categories.ebook.push(9999);
          return Promise.resolve([]);
        },
      });

      await adapter.search(query(), original, AbortSignal.timeout(1000));

      expect(seen.categories.ebook).toContain(9999);
      expect(original.categories.ebook).toEqual([7020]);
    });
  });

  describe('failures', () => {
    /**
     * A plugin is imported at runtime and so holds its own copy of any class it imports. Its
     * errors are normalised here, or a bare throw would reach the picker as an empty result.
     */
    it('turns anything a plugin throws into a failure the picker can act on', async () => {
      const { adapter } = makeAdapter({
        search: () => {
          throw new TypeError('cannot read properties of undefined');
        },
      });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(1000))).rejects.toBeInstanceOf(IndexerSearchException);
      await expect(adapter.search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({ failure: 'error' });
    });

    it('keeps the failure code a plugin chose through host.fail', async () => {
      const { adapter } = makeAdapter({
        search: (_q, _c, host) => {
          throw host.fail('unauthorized', 'the key was rejected');
        },
      });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({ failure: 'unauthorized' });
    });

    it('reports a plugin that hangs as a timeout rather than an error', async () => {
      const { adapter } = makeAdapter({
        search: () => {
          const error = new Error('aborted');
          error.name = 'TimeoutError';
          throw error;
        },
      });

      await expect(adapter.search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({ failure: 'timeout' });
    });
  });

  it('writes a rotated credential through the store rather than the database', async () => {
    const { adapter, credentials } = makeAdapter({
      search: async (_q, _c, host) => {
        await host.saveCredential('a-rotated-session');
        return [];
      },
    });

    await adapter.search(query(), config({ id: 12 }), AbortSignal.timeout(1000));

    // The credential the search ran with travels with the rotation, so the store can refuse one
    // that follows on from a session an operator has since replaced.
    expect(credentials.rotate).toHaveBeenCalledWith(12, 'a-rotated-session', 'a-key');
  });

  it('chains multiple credential rotations from the last accepted session', async () => {
    const { adapter, credentials } = makeAdapter({
      search: vi.fn(async (_query, _config, host) => {
        await host.saveCredential('session-2');
        await host.saveCredential('session-3');
        return [];
      }),
    });

    await adapter.search(query(), config({ credential: 'session-1' }), AbortSignal.timeout(1_000));

    expect(credentials.rotate).toHaveBeenNthCalledWith(1, 4, 'session-2', 'session-1');
    expect(credentials.rotate).toHaveBeenNthCalledWith(2, 4, 'session-3', 'session-2');
  });
});
