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
  const handlers = new Map<string, () => Response>();
  const fetchMock = vi.fn((url: URL | string, init: RequestInit = {}) => {
    const href = url.toString();
    calls.push({ url: href, init });
    for (const [fragment, handler] of handlers) {
      if (href.includes(fragment)) return Promise.resolve(handler());
    }
    return Promise.resolve(response('Ok.'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, handlers, fetchMock };
}

describe('QbittorrentAdapter', () => {
  let adapter: QbittorrentAdapter;

  beforeEach(() => {
    adapter = new QbittorrentAdapter();
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

      expect(calls.at(-1)?.url).toBe(`http://127.0.0.1:8080/qbt/api/v2/torrents/info?hashes=${INFO_HASH}`);
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
      const { calls } = mockFetch();

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
