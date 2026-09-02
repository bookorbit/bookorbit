import { BadRequestException } from '@nestjs/common';

import type { ResolvedClientConfig } from '../download-client-adapter';
import { DelugeAdapter } from './deluge.adapter';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';
const SESSION_COOKIE = '_session_id=abc123';

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 1,
    name: 'local deluge',
    adapterType: 'deluge',
    // 127.0.0.1 needs the per-row private opt-in, which is exactly how a LAN client is configured.
    baseUrl: 'http://127.0.0.1:8112',
    username: null,
    password: 'deluge',
    category: 'bookorbit',
    allowPrivateAddress: true,
    settings: null,
    ...overrides,
  };
}

function result(value: unknown, init: { setCookie?: string } = {}): Response {
  const headers = new Headers();
  if (init.setCookie) headers.append('set-cookie', init.setCookie);
  return new Response(JSON.stringify({ id: 1, result: value, error: null }), { status: 200, headers });
}

function failure(message: string, code?: number): Response {
  return new Response(JSON.stringify({ id: 1, result: null, error: { message, code } }), { status: 200 });
}

interface RpcCall {
  url: string;
  method: string;
  params: unknown[];
  cookie: string | null;
}

/** Every call is a POST to the same endpoint, so the mock dispatches on the RPC method instead. */
function mockRpc() {
  const calls: RpcCall[] = [];
  const handlers = new Map<string, () => Response>([
    ['auth.login', () => result(true, { setCookie: `${SESSION_COOKIE}; Path=/; HttpOnly` })],
    ['web.connected', () => result(true)],
    ['core.get_enabled_plugins', () => result([])],
  ]);

  const fetchMock = vi.fn((url: URL | string, init: RequestInit = {}) => {
    const body = JSON.parse(init.body as string) as { method: string; params: unknown[] };
    const headers = new Headers(init.headers as HeadersInit);
    calls.push({ url: url.toString(), method: body.method, params: body.params, cookie: headers.get('cookie') });

    const handler = handlers.get(body.method);
    return Promise.resolve(handler ? handler() : result(null));
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, handlers };
}

describe('DelugeAdapter', () => {
  let adapter: DelugeAdapter;

  beforeEach(() => {
    adapter = new DelugeAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('base URL', () => {
    it('keeps a reverse-proxy path prefix on every call', async () => {
      const { calls } = mockRpc();
      await adapter.test(config({ baseUrl: 'http://127.0.0.1:8112/deluge' }));

      expect(calls.at(-1)?.url).toBe('http://127.0.0.1:8112/deluge/json');
    });

    /** Pasting the JSON endpoint itself is at least as likely as pasting the Web UI root. */
    it('does not append the JSON path twice when the base already carries it', async () => {
      const { calls } = mockRpc();
      await adapter.test(config({ id: 2, baseUrl: 'http://127.0.0.1:8112/json' }));

      expect(calls.at(-1)?.url).toBe('http://127.0.0.1:8112/json');
    });
  });

  describe('session', () => {
    /** The Web UI authenticates with a password alone; a username belongs to the daemon. */
    it('signs in with the password and reuses the session cookie', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('daemon.get_version', () => result('2.1.1'));

      await adapter.test(config({ username: 'admin' }));

      const login = calls.find((call) => call.method === 'auth.login');
      expect(login?.params).toEqual(['deluge']);
      expect(calls.find((call) => call.method === 'daemon.get_version')?.cookie).toBe(SESSION_COOKIE);
    });

    it('does not sign in again while the session holds', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () => result({}));

      await adapter.test(config());
      await adapter.status([INFO_HASH], config());

      expect(calls.filter((call) => call.method === 'auth.login')).toHaveLength(1);
    });

    it('signs in again after forget, so an edited password cannot reuse a stale session', async () => {
      const { calls } = mockRpc();
      await adapter.test(config());
      adapter.forget(1);
      await adapter.test(config());

      expect(calls.filter((call) => call.method === 'auth.login')).toHaveLength(2);
    });

    it('reports a rejected password as a failed test', async () => {
      const { handlers } = mockRpc();
      handlers.set('auth.login', () => result(false));

      await expect(adapter.test(config())).resolves.toEqual({ success: false, error: 'Deluge rejected that password' });
    });

    /**
     * The Web UI is a separate process from the daemon that holds the torrents, and a freshly
     * started one is attached to nothing. Every call then answers "not connected" while the
     * password was perfectly good.
     */
    it('attaches the Web UI to a daemon when it is not already connected', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('web.connected', () => result(false));
      handlers.set('web.get_hosts', () => result([['host-1', '127.0.0.1', 58846, 'localclient']]));

      await adapter.test(config());

      expect(calls.find((call) => call.method === 'web.connect')?.params).toEqual(['host-1']);
    });

    it('fails the test when no known host accepts a connection', async () => {
      const { handlers } = mockRpc();
      handlers.set('web.connected', () => result(false));
      handlers.set('web.get_hosts', () => result([['host-1', '127.0.0.1', 58846, 'localclient']]));
      handlers.set('web.connect', () => failure('Connection refused'));

      const outcome = await adapter.test(config());
      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('not connected to a daemon');
    });

    /** An expired session is reported as an ordinary error on whatever call hit it. */
    it('signs in again and retries when the session has lapsed', async () => {
      const { calls, handlers } = mockRpc();
      let asked = 0;
      handlers.set('core.get_torrents_status', () => {
        asked += 1;
        return asked === 1 ? failure('Not authenticated', 1) : result({});
      });

      await expect(adapter.status([INFO_HASH], config())).resolves.toEqual([]);
      expect(calls.filter((call) => call.method === 'auth.login')).toHaveLength(2);
    });
  });

  describe('add', () => {
    it('posts a magnet unpaused and returns the id the client answered with', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('core.add_torrent_magnet', () => result(INFO_HASH));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });

      const add = calls.find((call) => call.method === 'core.add_torrent_magnet');
      expect(add?.params[0]).toBe(`magnet:?xt=urn:btih:${INFO_HASH}`);
      expect(add?.params[1]).toEqual({ add_paused: false });
    });

    it('uploads a .torrent as base64 alongside its name', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('core.add_torrent_file', () => result(INFO_HASH));

      await adapter.add({ torrentFile: Buffer.from('d4:infod4:name4:duneee'), torrentFileName: 'dune.torrent', infoHash: INFO_HASH }, config());

      const add = calls.find((call) => call.method === 'core.add_torrent_file');
      expect(add?.params[0]).toBe('dune.torrent');
      expect(add?.params[1]).toBe(Buffer.from('d4:infod4:name4:duneee').toString('base64'));
    });

    it('sets the seed ratio goal so the client, not BookOrbit, enforces it', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('core.add_torrent_magnet', () => result(INFO_HASH));

      await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH, seedRatioGoal: 2 }, config());

      expect(calls.find((call) => call.method === 'core.add_torrent_magnet')?.params[1]).toEqual({
        add_paused: false,
        stop_at_ratio: true,
        stop_ratio: 2,
        remove_at_ratio: false,
      });
    });

    /**
     * An earlier attempt on this release leaves its torrent behind when the import fails. Deluge
     * refuses it outright rather than adopting it, so without this every retry of that release
     * would be refused forever.
     */
    it('adopts a torrent the client already holds', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.add_torrent_magnet', () => failure('Torrent already in session'));
      handlers.set('core.get_torrents_status', () => result({ [INFO_HASH]: { hash: INFO_HASH } }));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });
    });

    it('surfaces a refusal the client cannot account for with a held torrent', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.add_torrent_magnet', () => failure('Unable to add torrent'));
      handlers.set('core.get_torrents_status', () => result({}));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).rejects.toThrow(BadRequestException);
    });

    it('rejects a grab carrying neither a magnet nor a file', async () => {
      mockRpc();
      await expect(adapter.add({ infoHash: INFO_HASH }, config())).rejects.toThrow(BadRequestException);
    });

    describe('labels', () => {
      it('labels the torrent when the Label plugin is enabled', async () => {
        const { calls, handlers } = mockRpc();
        handlers.set('core.get_enabled_plugins', () => result(['Label']));
        handlers.set('core.add_torrent_magnet', () => result(INFO_HASH));

        await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config());

        expect(calls.find((call) => call.method === 'label.add')?.params).toEqual(['bookorbit']);
        expect(calls.find((call) => call.method === 'label.set_torrent')?.params).toEqual([INFO_HASH, 'bookorbit']);
      });

      /** The plugin accepts lowercase letters, digits, dashes and underscores only. */
      it('folds a category the plugin would refuse into a usable label', async () => {
        const { calls, handlers } = mockRpc();
        handlers.set('core.get_enabled_plugins', () => result(['Label']));
        handlers.set('core.add_torrent_magnet', () => result(INFO_HASH));

        await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config({ category: 'Book Orbit v2.0' }));

        expect(calls.find((call) => call.method === 'label.add')?.params).toEqual(['book-orbit-v2-0']);
      });

      it('skips labelling entirely when the plugin is not enabled', async () => {
        const { calls, handlers } = mockRpc();
        handlers.set('core.add_torrent_magnet', () => result(INFO_HASH));

        await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config());

        expect(calls.some((call) => call.method.startsWith('label.'))).toBe(false);
      });

      /**
       * The torrent is already downloading by the time a label is applied, and nothing in the poll
       * loop finds it by label, so a labelling failure must not lose the grab.
       */
      it('keeps the grab when the label cannot be applied', async () => {
        const { handlers } = mockRpc();
        handlers.set('core.get_enabled_plugins', () => result(['Label']));
        handlers.set('core.add_torrent_magnet', () => result(INFO_HASH));
        handlers.set('label.set_torrent', () => failure('Unknown label'));

        await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
          clientHash: INFO_HASH,
        });
      });
    });
  });

  describe('status', () => {
    /** An empty id filter means every torrent to Deluge, not none of them. */
    it('asks nothing when there is nothing in flight', async () => {
      const { calls } = mockRpc();
      await expect(adapter.status([], config())).resolves.toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('maps a downloading torrent onto progress and a content path', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({
          [INFO_HASH]: {
            hash: INFO_HASH,
            name: 'Dune',
            state: 'Downloading',
            progress: 50,
            total_done: 512,
            total_wanted: 1024,
            download_location: '/downloads',
          },
        }),
      );

      await expect(adapter.status([INFO_HASH], config())).resolves.toEqual([
        expect.objectContaining({
          infoHash: INFO_HASH,
          state: 'downloading',
          progressPercent: 50,
          downloadedBytes: 512,
          totalBytes: 1024,
          contentPath: '/downloads/Dune',
        }),
      ]);
    });

    /** 1.3 knows only `save_path`, which is the same folder under the older spelling. */
    it('falls back to the older save path spelling', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({ [INFO_HASH]: { hash: INFO_HASH, name: 'Dune', state: 'Downloading', save_path: '/data' } }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.contentPath).toBe('/data/Dune');
    });

    it('reports a seeding torrent as completed with its ratio goal', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({
          [INFO_HASH]: {
            hash: INFO_HASH,
            state: 'Seeding',
            progress: 100,
            ratio: 1.5,
            stop_at_ratio: true,
            stop_ratio: 2,
            seeding_time: 600,
            total_uploaded: 2048,
          },
        }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('completed');
      expect(status.seed).toEqual({
        seeding: true,
        ratio: 1.5,
        ratioGoal: 2,
        seedingTimeSeconds: 600,
        // Deluge enforces no seed-time goal, and claiming one it does not hold to would be worse
        // than reporting none.
        seedingTimeGoalMinutes: null,
        uploadedBytes: 2048,
      });
    });

    it('does not report a ratio the client is not holding the torrent to', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({ [INFO_HASH]: { hash: INFO_HASH, state: 'Seeding', stop_at_ratio: false, stop_ratio: 2 } }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.seed?.ratioGoal).toBeNull();
    });

    /** Paused covers a held download and a finished torrent alike. */
    it('tells a finished paused torrent from a held one', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({
          [INFO_HASH]: { hash: INFO_HASH, state: 'Paused', progress: 100, is_finished: true },
          ['b'.repeat(40)]: { hash: 'b'.repeat(40), state: 'Paused', progress: 30 },
        }),
      );

      const statuses = await adapter.status([INFO_HASH, 'b'.repeat(40)], config());
      expect(statuses.map((status) => status.state)).toEqual(['completed', 'queued']);
    });

    it('treats an error state as failed and carries its message', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({ [INFO_HASH]: { hash: INFO_HASH, state: 'Error', message: 'No space left on device' } }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('failed');
      expect(status.errorMessage).toBe('No space left on device');
    });

    /**
     * A refused announce leaves the torrent in an ordinary downloading state that will never find
     * a peer, so the tracker's own answer is the only thing that tells it apart.
     */
    it('reports a refused announce as a tracker error without failing the download', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({ [INFO_HASH]: { hash: INFO_HASH, state: 'Downloading', tracker_status: 'tracker.example.com: Error: unregistered torrent' } }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('downloading');
      expect(status.trackerError).toBe('tracker.example.com: Error: unregistered torrent');
    });

    it('says nothing about a tracker that is announcing normally', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () =>
        result({ [INFO_HASH]: { hash: INFO_HASH, state: 'Downloading', tracker_status: 'Announce OK' } }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.trackerError).toBeUndefined();
    });

    it('ignores a torrent the poll did not ask about', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.get_torrents_status', () => result({ ['f'.repeat(40)]: { hash: 'f'.repeat(40), state: 'Downloading' } }));

      await expect(adapter.status([INFO_HASH], config())).resolves.toEqual([]);
    });
  });

  describe('remove', () => {
    it('leaves the files alone unless deletion was asked for', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('core.remove_torrent', () => result(true));

      await adapter.remove(INFO_HASH.toUpperCase(), config(), { deleteFiles: false });

      expect(calls.find((call) => call.method === 'core.remove_torrent')?.params).toEqual([INFO_HASH, false]);
    });

    /** Deluge answers a torrent it does not hold with `false` rather than an error. */
    it('refuses to report a removal that did nothing as a success', async () => {
      const { handlers } = mockRpc();
      handlers.set('core.remove_torrent', () => result(false));

      await expect(adapter.remove(INFO_HASH, config(), { deleteFiles: true })).rejects.toThrow(BadRequestException);
    });
  });

  describe('test', () => {
    it('reports the version the daemon answers with', async () => {
      const { handlers } = mockRpc();
      handlers.set('daemon.get_version', () => result('2.1.1'));

      await expect(adapter.test(config())).resolves.toEqual({ success: true, version: '2.1.1' });
    });

    /** 1.3 answers only the older spelling, and a refusal there means nothing else. */
    it('falls back to the 1.3 spelling of the version call', async () => {
      const { handlers } = mockRpc();
      handlers.set('daemon.get_version', () => failure('Unknown method'));
      handlers.set('daemon.info', () => result('1.3.15'));

      await expect(adapter.test(config())).resolves.toEqual({ success: true, version: '1.3.15' });
    });
  });
});
