import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import type { ResolvedClientConfig } from '../download-client-adapter';
import { QbittorrentAdapter } from './qbittorrent.adapter';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 1,
    name: 'local qbit',
    adapterType: 'qbittorrent',
    // 127.0.0.1 needs the per-row private opt-in, which is exactly how a LAN client is configured.
    baseUrl: 'http://127.0.0.1:8080',
    username: 'admin',
    password: 'adminadmin',
    category: 'bookorbit',
    allowPrivateAddress: true,
    settings: null,
    ...overrides,
  };
}

function response(body: string | object, init: { status?: number; setCookie?: string } = {}): Response {
  const headers = new Headers();
  if (init.setCookie) headers.append('set-cookie', init.setCookie);
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, { status: init.status ?? 200, headers });
}

function mockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const handlers = new Map<string, (url: URL) => Response>();
  const fetchMock = vi.fn((url: URL | string, init: RequestInit = {}) => {
    const href = url.toString();
    calls.push({ url: href, init });
    for (const [fragment, handler] of handlers) {
      if (href.includes(fragment)) return Promise.resolve(handler(new URL(href)));
    }
    return Promise.resolve(response('Ok.'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, handlers, fetchMock };
}

describe('QbittorrentAdapter', () => {
  let adapter: QbittorrentAdapter;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [QbittorrentAdapter] }).compile();
    adapter = module.get(QbittorrentAdapter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A reverse proxy at a subpath is an ordinary way to expose qBittorrent, and `new URL(path,
   * base)` throws the prefix away without complaining: every call would quietly hit the wrong
   * endpoint on the right host.
   */
  describe('base URL', () => {
    it('keeps a reverse-proxy path prefix on every call', async () => {
      const { calls } = mockFetch();
      await adapter.test(config({ baseUrl: 'http://127.0.0.1:8080/qbt' }));

      expect(calls.map((call) => call.url)).toEqual(['http://127.0.0.1:8080/qbt/api/v2/auth/login', 'http://127.0.0.1:8080/qbt/api/v2/app/version']);
    });

    it('tolerates a trailing slash without doubling it', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('torrents/info', () => response([]));
      await adapter.status([INFO_HASH], config({ id: 2, baseUrl: 'http://127.0.0.1:8080/qbt/' }));

      expect(calls[1]?.url).toBe(`http://127.0.0.1:8080/qbt/api/v2/torrents/info?hashes=${INFO_HASH}`);
      expect(calls.at(-1)?.url).toBe('http://127.0.0.1:8080/qbt/api/v2/torrents/info?sort=hash&limit=1000&offset=0');
    });

    it('is unchanged for a client mounted at the root', async () => {
      const { calls } = mockFetch();
      await adapter.test(config({ id: 3 }));
      expect(calls.at(-1)?.url).toBe('http://127.0.0.1:8080/api/v2/app/version');
    });
  });

  describe('add', () => {
    it('posts a magnet with the configured category and returns the caller-derived hash', async () => {
      const { calls } = mockFetch();

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });

      const add = calls.find((call) => call.url.includes('/api/v2/torrents/add'));
      const form = add?.init.body as FormData;
      expect(form.get('urls')).toBe(`magnet:?xt=urn:btih:${INFO_HASH}`);
      expect(form.get('category')).toBe('bookorbit');
    });

    it('passes seed goals through so the client, not BookOrbit, enforces them', async () => {
      const { calls } = mockFetch();

      await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH, seedRatioGoal: 2, seedTimeMinutes: 4320 }, config());

      const form = calls.find((call) => call.url.includes('/torrents/add'))?.init.body as FormData;
      expect(form.get('ratioLimit')).toBe('2');
      expect(form.get('seedingTimeLimit')).toBe('4320');
    });

    it('uploads a .torrent as a file part', async () => {
      const { calls } = mockFetch();

      await adapter.add({ torrentFile: Buffer.from('d4:infod4:name4:duneee'), torrentFileName: 'dune.torrent', infoHash: INFO_HASH }, config());

      const form = calls.find((call) => call.url.includes('/torrents/add'))?.init.body as FormData;
      expect(form.get('torrents')).toBeInstanceOf(Blob);
      expect(form.get('urls')).toBeNull();
    });

    /** qBittorrent answers "Fails." with a 200, which is the one 200 that is not success. */
    it('treats a "Fails." body as a rejection despite the 200', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/add', () => response('Fails.'));
      handlers.set('/torrents/info', () => response([]));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).rejects.toThrow(
        /could not read that torrent/,
      );
    });

    /**
     * A failed import leaves its torrent in the client, so every later attempt at that release is
     * answered with "Fails." forever. The torrent we asked for being present is the outcome we
     * wanted, and reporting it as a rejection is what stranded the request in the first place.
     */
    it('adopts a torrent the client is already holding instead of failing the grab', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/add', () => response('Fails.'));
      handlers.set('/torrents/info', () => response([{ hash: INFO_HASH, state: 'stalledUP', progress: 1 }]));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });
    });

    it('reports the rejection rather than a false success when it cannot ask the client', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/add', () => response('Fails.'));
      handlers.set('/torrents/info', () => response('Forbidden', { status: 403 }));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).rejects.toThrow(BadRequestException);
    });

    it('refuses a payload with neither a magnet nor a file', async () => {
      mockFetch();
      await expect(adapter.add({ infoHash: INFO_HASH }, config())).rejects.toThrow(BadRequestException);
    });
  });

  describe('status', () => {
    it('asks for every hash in one call and maps qBittorrent states', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () =>
        response([
          { hash: INFO_HASH, state: 'downloading', progress: 0.42, downloaded: 420, total_size: 1000, content_path: '/downloads/dune.epub' },
          { hash: 'b'.repeat(40), state: 'stalledUP', progress: 1, downloaded: 900, total_size: 900, content_path: '/downloads/other.epub' },
          { hash: 'c'.repeat(40), state: 'error', progress: 0.1, downloaded: 10, total_size: 100 },
        ]),
      );

      const statuses = await adapter.status([INFO_HASH, 'B'.repeat(40), 'c'.repeat(40)], config());

      expect(calls.filter((call) => call.url.includes('/torrents/info'))).toHaveLength(1);
      expect(statuses).toEqual([
        {
          infoHash: INFO_HASH,
          state: 'downloading',
          progressPercent: 42,
          downloadedBytes: 420,
          totalBytes: 1000,
          contentPath: '/downloads/dune.epub',
          seed: { seeding: false, ratio: null, ratioGoal: null, seedingTimeSeconds: null, seedingTimeGoalMinutes: null, uploadedBytes: null },
          errorMessage: undefined,
        },
        expect.objectContaining({ state: 'completed', progressPercent: 100 }),
        expect.objectContaining({ state: 'failed', errorMessage: expect.stringContaining('error') }),
      ]);
    });

    it('reports what a finished torrent is doing in the swarm, and the goals it was given', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () =>
        response([
          {
            hash: INFO_HASH,
            state: 'uploading',
            progress: 1,
            downloaded: 1000,
            total_size: 1000,
            ratio: 1.75,
            ratio_limit: 2,
            seeding_time: 7200,
            seeding_time_limit: 4320,
            uploaded: 1750,
          },
        ]),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.seed).toEqual({
        seeding: true,
        ratio: 1.75,
        ratioGoal: 2,
        seedingTimeSeconds: 7200,
        seedingTimeGoalMinutes: 4320,
        uploadedBytes: 1750,
      });
    });

    it('reads a negative goal as no goal of its own rather than a goal of minus one', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () =>
        response([{ hash: INFO_HASH, state: 'stoppedUP', progress: 1, ratio: 0.4, ratio_limit: -2, seeding_time_limit: -1 }]),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      // Stopped is finished and idle, not seeding, whatever the ratio says.
      expect(status.seed).toMatchObject({ seeding: false, ratio: 0.4, ratioGoal: null, seedingTimeGoalMinutes: null });
    });

    it('leaves a hash the client does not know about out of the result', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([]));

      await expect(adapter.status([INFO_HASH], config())).resolves.toEqual([]);
    });

    it('treats checking states as still in progress rather than finished', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([{ hash: INFO_HASH, state: 'checkingDL', progress: 0.99, downloaded: 990, total_size: 1000 }]));

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('queued');
    });
  });

  describe('hybrid hash resolution', () => {
    const V2 = 'fcaca6db3eab479062f70e78a27f51164760108979eb66c91e05b55d3720e49c';
    const PRIMARY = V2.slice(0, 40);
    const hybrid = { hash: PRIMARY, infohash_v1: INFO_HASH, infohash_v2: V2, state: 'stalledUP', progress: 1 };

    function hybridClient() {
      const mock = mockFetch();
      mock.handlers.set('/torrents/info', (url) => {
        const hashes = url.searchParams.get('hashes');
        return response(hashes === null || hashes.split('|').includes(PRIMARY) ? [hybrid] : []);
      });
      return mock;
    }

    it.each([INFO_HASH, V2, PRIMARY])('reports completion under the requested identity %s', async (hash) => {
      hybridClient();
      await expect(adapter.status([hash.toUpperCase()], config())).resolves.toEqual([
        expect.objectContaining({ infoHash: hash, state: 'completed', progressPercent: 100 }),
      ]);
    });

    it('matches aliases even when a client returns them in the filtered response', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([{ ...hybrid, hash: PRIMARY.toUpperCase(), infohash_v1: INFO_HASH.toUpperCase() }]));
      expect(await adapter.status([INFO_HASH], config())).toEqual([expect.objectContaining({ infoHash: INFO_HASH })]);
      expect(calls.filter((call) => call.url.includes('/torrents/info'))).toHaveLength(1);
    });

    it('does not duplicate results when aliases, duplicate requests, or repeated rows overlap', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([hybrid, hybrid]));
      const statuses = await adapter.status([INFO_HASH, INFO_HASH.toUpperCase(), PRIMARY, V2], config());
      expect(statuses.map((status) => status.infoHash).sort()).toEqual([INFO_HASH, PRIMARY, V2].sort());
    });

    it.each([V2.slice(0, 12), V2.slice(0, 39), V2.slice(0, 41), '0'.repeat(40)])(
      'never matches an arbitrary prefix or absent hash %s',
      async (hash) => {
        const { handlers } = mockFetch();
        handlers.set('/torrents/info', () => response([{ ...hybrid, infohash_v1: '0'.repeat(40) }]));
        expect(await adapter.status([hash], config())).toEqual([]);
      },
    );

    it('ignores malformed alias fields without discarding the valid primary identity', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([{ ...hybrid, infohash_v1: 123, infohash_v2: { hash: V2 } }]));
      expect(await adapter.status([PRIMARY, INFO_HASH], config())).toEqual([expect.objectContaining({ infoHash: PRIMARY })]);
    });

    it('pages the fallback once for the batch and caches only verified primary mappings', async () => {
      const { calls, handlers } = mockFetch();
      const other = { hash: 'f'.repeat(40) };
      handlers.set('/torrents/info', (url) => {
        const hashes = url.searchParams.get('hashes');
        if (hashes !== null) return response(hashes === PRIMARY ? [hybrid] : []);
        expect(url.searchParams.get('category')).toBeNull();
        expect(url.searchParams.get('limit')).toBe('1000');
        return response(url.searchParams.get('offset') === '0' ? Array.from({ length: 1000 }, () => other) : [hybrid]);
      });
      expect(await adapter.status([INFO_HASH, V2], config())).toHaveLength(2);
      expect(calls.filter((call) => call.url.includes('/torrents/info'))).toHaveLength(3);
      calls.length = 0;
      expect(await adapter.status([INFO_HASH, V2], config())).toHaveLength(2);
      expect(calls.map((call) => call.url)).toEqual([`http://127.0.0.1:8080/api/v2/torrents/info?hashes=${PRIMARY}`]);
    });

    it('keeps aliases scoped to a client and drops them when configuration changes', async () => {
      const { calls } = hybridClient();
      await adapter.status([INFO_HASH], config());
      calls.length = 0;
      await adapter.status([INFO_HASH], config({ id: 2 }));
      expect(calls.find((call) => call.url.includes('/torrents/info'))?.url).toContain(`hashes=${INFO_HASH}`);
      adapter.forget(1);
      calls.length = 0;
      await adapter.status([INFO_HASH], config());
      expect(calls.find((call) => call.url.includes('/torrents/info'))?.url).toContain(`hashes=${INFO_HASH}`);
    });

    it('expires idle aliases and revalidates them', async () => {
      const { calls } = hybridClient();
      const now = vi.spyOn(Date, 'now');
      try {
        now.mockReturnValue(1_000_000);
        await adapter.status([INFO_HASH], config());
        now.mockReturnValue(1_000_000 + 30 * 60 * 1000);
        calls.length = 0;
        await adapter.status([INFO_HASH], config());
        expect(calls.find((call) => call.url.includes('/torrents/info'))?.url).toContain(`hashes=${INFO_HASH}`);
      } finally {
        now.mockRestore();
      }
    });

    it('does not trust a cached mapping if the response no longer contains the requested alias', async () => {
      const { handlers } = hybridClient();
      await adapter.status([INFO_HASH], config());
      handlers.set('/torrents/info', () => response([{ hash: PRIMARY, infohash_v1: 'f'.repeat(40) }]));
      expect(await adapter.status([INFO_HASH], config())).toEqual([]);
    });

    it('rediscovers an alias when the primary changes', async () => {
      const { calls, handlers } = hybridClient();
      await adapter.status([INFO_HASH], config());
      handlers.set('/torrents/info', (url) => response(url.searchParams.has('hashes') ? [] : [{ ...hybrid, hash: INFO_HASH }]));
      expect(await adapter.status([INFO_HASH], config())).toEqual([expect.objectContaining({ infoHash: INFO_HASH, state: 'completed' })]);
      calls.length = 0;
      await adapter.status([INFO_HASH], config());
      expect(calls[0].url).toContain(`hashes=${INFO_HASH}`);
    });

    it('propagates an incomplete lookup instead of declaring the torrent missing', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', (url) =>
        response(url.searchParams.has('hashes') ? [] : 'Unavailable', { status: url.searchParams.has('hashes') ? 200 : 503 }),
      );
      await expect(adapter.status([INFO_HASH], config())).rejects.toThrow('qBittorrent answered 503');
    });

    it.each([{}, [null], 'not json'])('rejects malformed listings instead of declaring torrents missing: %j', async (payload) => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(payload));
      await expect(adapter.status([INFO_HASH], config())).rejects.toThrow(BadRequestException);
    });

    it('bounds an endless fallback and refuses to infer absence from a truncated search', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', (url) =>
        response(url.searchParams.has('hashes') ? [] : Array.from({ length: 1000 }, () => ({ hash: 'f'.repeat(40) }))),
      );
      await expect(adapter.status([INFO_HASH], config())).rejects.toThrow('hash lookup exceeded its scan limit');
      expect(calls.filter((call) => call.url.includes('sort=hash'))).toHaveLength(100);
    });

    it('keeps ordinary polling batched without an inventory lookup', async () => {
      const { calls, handlers } = mockFetch();
      const hashes = Array.from({ length: 205 }, (_, index) => (index + 1).toString(16).padStart(40, '0'));
      handlers.set('/torrents/info', (url) =>
        response(
          url.searchParams
            .get('hashes')!
            .split('|')
            .map((hash) => ({ hash })),
        ),
      );
      expect(await adapter.status(hashes, config())).toHaveLength(205);
      const queries = calls.filter((call) => call.url.includes('/torrents/info')).map((call) => new URL(call.url));
      expect(queries.map((url) => url.searchParams.get('hashes')!.split('|').length)).toEqual([100, 100, 5]);
    });

    it('makes no HTTP calls for an empty batch', async () => {
      const { calls } = mockFetch();
      expect(await adapter.status([], config())).toEqual([]);
      expect(calls).toEqual([]);
    });

    it.each([200, 409])('adopts an existing hybrid on an add rejection with HTTP %i', async (status) => {
      const { handlers } = hybridClient();
      handlers.set('/torrents/add', () => response(status === 409 ? 'Conflict' : 'Fails.', { status }));
      expect(await adapter.add({ infoHash: INFO_HASH, magnet: `magnet:?xt=urn:btih:${INFO_HASH}&xt=urn:btmh:1220${V2}` }, config())).toEqual({
        clientHash: INFO_HASH,
      });
    });

    it.each([200, 503])('preserves a 409 rejection when presence cannot be confirmed (lookup HTTP %i)', async (status) => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/add', () => response('Conflict', { status: 409 }));
      handlers.set('/torrents/info', () => response([], { status }));
      await expect(adapter.add({ infoHash: INFO_HASH, magnet: `magnet:?xt=urn:btih:${INFO_HASH}` }, config())).rejects.toThrow(
        'qBittorrent answered 409 for /api/v2/torrents/add',
      );
    });

    it('does not adopt after an unrelated server failure', async () => {
      const { calls, handlers } = hybridClient();
      handlers.set('/torrents/add', () => response('Unavailable', { status: 503 }));
      await expect(adapter.add({ infoHash: INFO_HASH, magnet: `magnet:?xt=urn:btih:${INFO_HASH}` }, config())).rejects.toThrow(
        'qBittorrent answered 503',
      );
      expect(calls.some((call) => call.url.includes('/torrents/info'))).toBe(false);
    });

    it('uses the primary hash to query trackers while keeping the stored identity in status', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([{ ...hybrid, state: 'metaDL', downloaded: 0, progress: 0 }]));
      handlers.set('/torrents/trackers', () => response([{ url: 'https://tracker.example/announce', status: 4, msg: 'Denied' }]));
      expect(await adapter.status([INFO_HASH], config())).toEqual([expect.objectContaining({ infoHash: INFO_HASH, trackerError: 'Denied' })]);
      expect(calls.find((call) => call.url.includes('/torrents/trackers'))?.url).toContain(`hash=${PRIMARY}`);
    });

    it.each([false, true])('removes by primary hash with deleteFiles=%s', async (deleteFiles) => {
      const { calls } = hybridClient();
      await adapter.remove(INFO_HASH.toUpperCase(), config(), { deleteFiles });
      const body = calls.find((call) => call.url.includes('/torrents/delete'))?.init.body as URLSearchParams;
      expect(body.get('hashes')).toBe(PRIMARY);
      expect(body.get('deleteFiles')).toBe(String(deleteFiles));
    });

    it('does not delete anything when the requested torrent is absent', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([]));
      await adapter.remove(INFO_HASH, config(), { deleteFiles: true });
      expect(calls.some((call) => call.url.includes('/torrents/delete'))).toBe(false);
    });

    it('does not delete anything when alias lookup fails', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response('Unavailable', { status: 503 }));
      await expect(adapter.remove(INFO_HASH, config(), { deleteFiles: true })).rejects.toThrow('qBittorrent answered 503');
      expect(calls.some((call) => call.url.includes('/torrents/delete'))).toBe(false);
    });

    it('does not swallow a 409 from a different endpoint', async () => {
      const { handlers } = hybridClient();
      handlers.set('/torrents/delete', () => response('Conflict', { status: 409 }));
      await expect(adapter.remove(INFO_HASH, config(), { deleteFiles: false })).rejects.toThrow(
        'qBittorrent answered 409 for /api/v2/torrents/delete',
      );
    });

    it('resolves full and truncated v2 aliases even when v1 is primary', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([{ ...hybrid, hash: INFO_HASH, infohash_v2: V2.toUpperCase() }]));
      expect((await adapter.status([V2, PRIMARY], config())).map((status) => status.infoHash).sort()).toEqual([V2, PRIMARY].sort());
    });

    it('evicts old aliases when the bounded cache fills without losing the ability to rediscover them', async () => {
      const { calls, handlers } = mockFetch();
      const entries = Array.from({ length: 10_001 }, (_, index) => ({
        hash: (index + 20_000).toString(16).padStart(40, '0'),
        infohash_v1: (index + 1).toString(16).padStart(40, '0'),
      }));
      const byHash = new Map(
        entries.flatMap(
          (entry) =>
            [
              [entry.hash, entry],
              [entry.infohash_v1, entry],
            ] as const,
        ),
      );
      handlers.set('/torrents/info', (url) =>
        response(
          url.searchParams
            .get('hashes')!
            .split('|')
            .map((hash) => byHash.get(hash)),
        ),
      );
      expect(
        await adapter.status(
          entries.map((entry) => entry.infohash_v1),
          config(),
        ),
      ).toHaveLength(entries.length);
      calls.length = 0;
      await adapter.status([entries[0].infohash_v1, entries.at(-1)!.infohash_v1], config());
      const query = new URL(calls.at(-1)!.url).searchParams.get('hashes');
      expect(query).toBe(`${entries[0].infohash_v1}|${entries.at(-1)!.hash}`);
    });

    it('marks owned inventory as truncated without returning more than the reconciliation limit', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(Array.from({ length: 1001 }, () => hybrid)));
      const inventory = await adapter.listOwned(config());
      expect(inventory.truncated).toBe(true);
      expect(inventory.items).toHaveLength(1000);
    });

    it('reports owned hybrids under v1 so tracked downloads cannot appear orphaned', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([hybrid, { hash: 'f'.repeat(40), infohash_v1: '0'.repeat(40) }]));
      const inventory = await adapter.listOwned(config());
      expect(inventory.items.map((item) => item.infoHash)).toEqual([INFO_HASH, 'f'.repeat(40)]);
      expect(new URL(calls.at(-1)!.url).searchParams.get('limit')).toBe('1001');
    });
  });

  describe('session handling', () => {
    it('reuses the session cookie across calls', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/auth/login', () => response('Ok.', { setCookie: 'SID=abc123; HttpOnly; path=/' }));
      handlers.set('/torrents/info', () => response([]));

      await adapter.status([INFO_HASH], config());
      await adapter.status([INFO_HASH], config());

      expect(calls.filter((call) => call.url.includes('/auth/login'))).toHaveLength(1);
      const infoCall = calls.find((call) => call.url.includes('/torrents/info'));
      expect((infoCall?.init.headers as Record<string, string>).Cookie).toBe('SID=abc123');
    });

    /** An expired SID answers 403 on every endpoint and looks exactly like a permission problem. */
    it('re-authenticates once on a 403 and then gives up', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/auth/login', () => response('Ok.', { setCookie: 'SID=abc123' }));
      handlers.set('/torrents/info', () => response('Forbidden', { status: 403 }));

      await expect(adapter.status([INFO_HASH], config())).rejects.toThrow(BadRequestException);
      expect(calls.filter((call) => call.url.includes('/auth/login'))).toHaveLength(2);
    });

    it('reports rejected credentials rather than retrying forever', async () => {
      const { handlers } = mockFetch();
      handlers.set('/auth/login', () => response('Fails.'));

      await expect(adapter.test(config())).resolves.toMatchObject({ success: false });
    });
  });

  describe('test', () => {
    it('reports the client version on success', async () => {
      const { handlers } = mockFetch();
      handlers.set('/app/version', () => response('v5.0.3'));

      await expect(adapter.test(config())).resolves.toEqual({ success: true, version: 'v5.0.3' });
    });

    it('turns an unreachable client into a failure result rather than an exception', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
      );

      await expect(adapter.test(config())).resolves.toMatchObject({ success: false, error: expect.stringContaining('ECONNREFUSED') });
    });

    it('refuses a private address when the row has not opted in', async () => {
      mockFetch();
      await expect(adapter.test(config({ allowPrivateAddress: false }))).resolves.toMatchObject({ success: false });
    });
  });

  describe('remove', () => {
    it('deletes by hash without touching the files on disk', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response([{ hash: INFO_HASH }]));

      await adapter.remove(INFO_HASH, config(), { deleteFiles: false });

      const call = calls.find((entry) => entry.url.includes('/torrents/delete'));
      expect((call?.init.body as URLSearchParams).get('hashes')).toBe(INFO_HASH);
      expect((call?.init.body as URLSearchParams).get('deleteFiles')).toBe('false');
    });
  });
  /**
   * A tracker refusing the announce is not an error state as far as qBittorrent is concerned: the
   * torrent sits in `stalledDL` looking exactly like one that simply has no peers yet, and the
   * request would occupy the queue until the watchdog gave up on it half a day later.
   */
  describe('tracker errors', () => {
    const REFUSED = 'Unrecognized host/PassKey. (97.117.96.134)';

    function stalled(overrides: object = {}) {
      return [{ hash: INFO_HASH, state: 'stalledDL', progress: 0, downloaded: 0, total_size: 1000, ...overrides }];
    }

    it("reports the tracker's own message for a torrent that is getting nowhere", async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(stalled()));
      handlers.set('/torrents/trackers', () => response([{ url: 'https://t.myanonamouse.net/tracker.php/abc', status: 4, msg: REFUSED }]));

      const [status] = await adapter.status([INFO_HASH], config());

      expect(status.trackerError).toBe(REFUSED);
      // The state itself is untouched: only the monitor decides what a refused announce costs.
      expect(status.state).toBe('downloading');
    });

    /** Disabled for a private torrent and reporting so is not a tracker failure. */
    it('ignores the DHT, PeX and LSD pseudo-entries when judging whether anything works', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(stalled()));
      handlers.set('/torrents/trackers', () =>
        response([
          { url: '** [DHT] **', status: 0, msg: 'This torrent is private' },
          { url: '** [PeX] **', status: 0, msg: 'This torrent is private' },
          { url: '** [LSD] **', status: 0, msg: 'This torrent is private' },
          { url: 'https://t.myanonamouse.net/tracker.php/abc', status: 4, msg: REFUSED },
        ]),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.trackerError).toBe(REFUSED);
    });

    it('stays quiet while any real tracker is still working', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(stalled()));
      handlers.set('/torrents/trackers', () =>
        response([
          { url: 'https://dead.example/announce', status: 4, msg: 'Connection failed' },
          { url: 'https://live.example/announce', status: 2, msg: '' },
        ]),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.trackerError).toBeUndefined();
    });

    it('does not ask about a torrent that is actually moving', async () => {
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(stalled({ state: 'downloading', downloaded: 4096 })));

      await adapter.status([INFO_HASH], config());

      expect(calls.filter((call) => call.url.includes('/torrents/trackers'))).toHaveLength(0);
    });

    it('keeps the poll alive when the client will not answer the trackers endpoint', async () => {
      const { handlers } = mockFetch();
      handlers.set('/torrents/info', () => response(stalled()));
      handlers.set('/torrents/trackers', () => response('Not Found', { status: 404 }));

      const [status] = await adapter.status([INFO_HASH], config());

      expect(status.trackerError).toBeUndefined();
      expect(status.state).toBe('downloading');
    });

    /** A queue where everything is stalled is a client-wide fault, not 200 separate diagnoses. */
    it('caps how many stuck torrents it asks about in one tick', async () => {
      const hashes = Array.from({ length: 30 }, (_, index) => index.toString(16).padStart(40, '0'));
      const { calls, handlers } = mockFetch();
      handlers.set('/torrents/info', () =>
        response(hashes.map((hash) => ({ hash, state: 'stalledDL', progress: 0, downloaded: 0, total_size: 1000 }))),
      );
      handlers.set('/torrents/trackers', () => response([{ url: 'https://t.example/announce', status: 4, msg: REFUSED }]));

      await adapter.status(hashes, config());

      expect(calls.filter((call) => call.url.includes('/torrents/trackers'))).toHaveLength(20);
    });
  });
});
