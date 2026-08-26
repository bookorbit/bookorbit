import { BadRequestException } from '@nestjs/common';

import type { ResolvedClientConfig } from '../download-client-adapter';
import { TransmissionAdapter } from './transmission.adapter';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 1,
    name: 'local transmission',
    adapterType: 'transmission',
    // 127.0.0.1 needs the per-row private opt-in, which is exactly how a LAN client is configured.
    baseUrl: 'http://127.0.0.1:9091',
    username: 'admin',
    password: 'adminadmin',
    category: 'bookorbit',
    allowPrivateAddress: true,
    settings: null,
    ...overrides,
  };
}

function success(args: object): Response {
  return new Response(JSON.stringify({ result: 'success', arguments: args }), { status: 200 });
}

interface RpcCall {
  url: string;
  method: string;
  args: Record<string, unknown>;
  sessionId: string | null;
  authorization: string | null;
}

/** Every call is a POST to the same endpoint, so the mock dispatches on the RPC method instead. */
function mockRpc() {
  const calls: RpcCall[] = [];
  const handlers = new Map<string, () => Response>();
  let demanded: string | null = null;

  const fetchMock = vi.fn((url: URL | string, init: RequestInit = {}) => {
    const body = JSON.parse(init.body as string) as { method: string; arguments: Record<string, unknown> };
    const headers = new Headers(init.headers as HeadersInit);
    calls.push({
      url: url.toString(),
      method: body.method,
      args: body.arguments,
      sessionId: headers.get('x-transmission-session-id'),
      authorization: headers.get('authorization'),
    });

    if (demanded !== null && headers.get('x-transmission-session-id') !== demanded) {
      return Promise.resolve(new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': demanded } }));
    }
    const handler = handlers.get(body.method);
    return Promise.resolve(handler ? handler() : success({}));
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, handlers, demandSession: (token: string) => (demanded = token) };
}

describe('TransmissionAdapter', () => {
  let adapter: TransmissionAdapter;

  beforeEach(() => {
    adapter = new TransmissionAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('base URL', () => {
    it('keeps a reverse-proxy path prefix on every call', async () => {
      const { calls } = mockRpc();
      await adapter.test(config({ baseUrl: 'http://127.0.0.1:9091/tr' }));

      expect(calls.at(-1)?.url).toBe('http://127.0.0.1:9091/tr/transmission/rpc');
    });

    /** Pasting the RPC endpoint itself is at least as likely as pasting the root. */
    it('does not append the RPC path twice when the base already carries it', async () => {
      const { calls } = mockRpc();
      await adapter.test(config({ id: 2, baseUrl: 'http://127.0.0.1:9091/transmission/rpc' }));

      expect(calls.at(-1)?.url).toBe('http://127.0.0.1:9091/transmission/rpc');
    });

    it('sends the credentials as Basic auth', async () => {
      const { calls } = mockRpc();
      await adapter.test(config({ id: 3 }));

      expect(calls.at(-1)?.authorization).toBe(`Basic ${Buffer.from('admin:adminadmin').toString('base64')}`);
    });
  });

  /**
   * Transmission refuses every call that arrives without the current CSRF token and hands out the
   * one to use in the same 409. It is the handshake rather than a failure, and it recurs on every
   * daemon restart, so it cannot be done once at startup.
   */
  describe('session handshake', () => {
    it('retries the call with the token the 409 issued', async () => {
      const { calls, handlers, demandSession } = mockRpc();
      demandSession('token-abc');
      handlers.set('session-get', () => success({ version: '4.0.5' }));

      await expect(adapter.test(config())).resolves.toEqual({ success: true, version: '4.0.5' });
      expect(calls.map((call) => call.sessionId)).toEqual([null, 'token-abc']);
    });

    it('reuses the token on later calls rather than handshaking every time', async () => {
      const { calls, handlers, demandSession } = mockRpc();
      demandSession('token-abc');
      handlers.set('torrent-get', () => success({ torrents: [] }));

      await adapter.test(config());
      await adapter.status([INFO_HASH], config());

      expect(calls.filter((call) => call.sessionId === null)).toHaveLength(1);
    });

    it('re-handshakes after forget, so an edited address cannot reuse a stale token', async () => {
      const { calls, handlers, demandSession } = mockRpc();
      demandSession('token-abc');
      handlers.set('session-get', () => success({ version: '4.0.5' }));

      await adapter.test(config());
      adapter.forget(1);
      await adapter.test(config());

      expect(calls.filter((call) => call.sessionId === null)).toHaveLength(2);
    });
  });

  describe('add', () => {
    it('posts a magnet under the category subfolder of the download directory', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('session-get', () => success({ 'download-dir': '/downloads' }));
      handlers.set('torrent-add', () => success({ 'torrent-added': { hashString: INFO_HASH } }));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });

      const add = calls.find((call) => call.method === 'torrent-add');
      expect(add?.args.filename).toBe(`magnet:?xt=urn:btih:${INFO_HASH}`);
      expect(add?.args['download-dir']).toBe('/downloads/bookorbit');
      expect(add?.args.paused).toBe(false);
    });

    it('uploads a .torrent as base64 metainfo', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('torrent-add', () => success({ 'torrent-added': { hashString: INFO_HASH } }));

      await adapter.add({ torrentFile: Buffer.from('d4:infod4:name4:duneee'), torrentFileName: 'dune.torrent', infoHash: INFO_HASH }, config());

      const add = calls.find((call) => call.method === 'torrent-add');
      expect(add?.args.metainfo).toBe(Buffer.from('d4:infod4:name4:duneee').toString('base64'));
      expect(add?.args.filename).toBeUndefined();
    });

    /**
     * An earlier attempt on this release leaves its torrent behind when the import fails. Without
     * adopting it, every retry of that release would be refused by the client forever.
     */
    it('adopts a torrent the client already holds', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-add', () => success({ 'torrent-duplicate': { hashString: INFO_HASH } }));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });
    });

    it('sets the seed ratio goal so the client, not BookOrbit, enforces it', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('torrent-add', () => success({ 'torrent-added': { hashString: INFO_HASH } }));

      await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH, seedRatioGoal: 2 }, config());

      const set = calls.find((call) => call.method === 'torrent-set');
      expect(set?.args).toEqual({ ids: [INFO_HASH], seedRatioLimit: 2, seedRatioMode: 1 });
    });

    /**
     * The torrent is already running by the time the goal is set, so throwing here failed a grab
     * whose download had started: automation moved to the next release while the orphan carried on
     * with nothing in BookOrbit pointing at it. Best-effort, like Deluge's labelling.
     */
    it('keeps the grab when the client refuses the seed ratio goal', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-add', () => success({ 'torrent-added': { hashString: INFO_HASH } }));
      handlers.set('torrent-set', () => new Response('', { status: 500 }));

      await expect(adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH, seedRatioGoal: 2 }, config())).resolves.toEqual({
        clientHash: INFO_HASH,
      });
    });

    /**
     * Transmission's only time limit stops a torrent after it goes quiet, which would cut a seed
     * short of a tracker's minimum rather than hold it there. Silently mapping the goal onto it
     * would under-seed exactly the private trackers the goal exists to satisfy.
     */
    it('does not turn a seed-time goal into an idle limit', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('torrent-add', () => success({ 'torrent-added': { hashString: INFO_HASH } }));

      await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH, seedTimeMinutes: 4320 }, config());

      expect(calls.find((call) => call.method === 'torrent-set')).toBeUndefined();
    });

    it('rejects a grab carrying neither a magnet nor a file', async () => {
      mockRpc();
      await expect(adapter.add({ infoHash: INFO_HASH }, config())).rejects.toThrow(BadRequestException);
    });

    /** `..` is inside the category's permitted character set and would escape the download root. */
    it('ignores a category that is only dots rather than building a path out of it', async () => {
      const { calls, handlers } = mockRpc();
      handlers.set('session-get', () => success({ 'download-dir': '/downloads' }));
      handlers.set('torrent-add', () => success({ 'torrent-added': { hashString: INFO_HASH } }));

      await adapter.add({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, infoHash: INFO_HASH }, config({ category: '..' }));

      expect(calls.find((call) => call.method === 'torrent-add')?.args['download-dir']).toBeUndefined();
    });
  });

  describe('status', () => {
    /** An empty `ids` is not reliably "no torrents" to Transmission, and may mean all of them. */
    it('asks nothing when there is nothing in flight', async () => {
      const { calls } = mockRpc();
      await expect(adapter.status([], config())).resolves.toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('maps a downloading torrent onto progress and a content path', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () =>
        success({
          torrents: [
            {
              hashString: INFO_HASH.toUpperCase(),
              name: 'Dune',
              status: 4,
              percentDone: 0.5,
              downloadedEver: 512,
              sizeWhenDone: 1024,
              downloadDir: '/downloads/bookorbit',
              error: 0,
            },
          ],
        }),
      );

      await expect(adapter.status([INFO_HASH], config())).resolves.toEqual([
        expect.objectContaining({
          infoHash: INFO_HASH,
          state: 'downloading',
          progressPercent: 50,
          downloadedBytes: 512,
          totalBytes: 1024,
          contentPath: '/downloads/bookorbit/Dune',
        }),
      ]);
    });

    it('reports a seeding torrent as completed with its ratio goal', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () =>
        success({
          torrents: [
            {
              hashString: INFO_HASH,
              status: 6,
              percentDone: 1,
              uploadRatio: 1.5,
              seedRatioLimit: 2,
              seedRatioMode: 1,
              secondsSeeding: 600,
              uploadedEver: 2048,
            },
          ],
        }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('completed');
      expect(status.seed).toEqual({
        seeding: true,
        ratio: 1.5,
        ratioGoal: 2,
        seedingTimeSeconds: 600,
        seedingTimeGoalMinutes: null,
        uploadedBytes: 2048,
      });
    });

    /** Mode 0 defers to the global limit, so the number beside it is a leftover, not a goal. */
    it('does not report a global ratio limit as this torrent goal', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () => success({ torrents: [{ hashString: INFO_HASH, status: 6, seedRatioLimit: 2, seedRatioMode: 0 }] }));

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.seed?.ratioGoal).toBeNull();
    });

    /** Stopped covers a paused download and a finished torrent alike. */
    it('tells a finished stopped torrent from a paused one', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () =>
        success({
          torrents: [
            { hashString: INFO_HASH, status: 0, percentDone: 1, isFinished: true },
            { hashString: 'b'.repeat(40), status: 0, percentDone: 0.3 },
          ],
        }),
      );

      const statuses = await adapter.status([INFO_HASH, 'b'.repeat(40)], config());
      expect(statuses.map((status) => status.state)).toEqual(['completed', 'queued']);
    });

    it('treats a local error as failed and carries its message', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () => success({ torrents: [{ hashString: INFO_HASH, status: 0, error: 3, errorString: 'No data found!' }] }));

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('failed');
      expect(status.errorMessage).toBe('No data found!');
    });

    /**
     * A refused announce leaves an ordinary-looking torrent that will never find a peer, so it has
     * to reach the poll loop as a tracker problem rather than as a healthy download.
     */
    it('reports a refused announce as a tracker error without failing the download', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () =>
        success({ torrents: [{ hashString: INFO_HASH, status: 4, error: 2, errorString: 'Tracker gave HTTP response code 403' }] }),
      );

      const [status] = await adapter.status([INFO_HASH], config());
      expect(status.state).toBe('downloading');
      expect(status.trackerError).toBe('Tracker gave HTTP response code 403');
    });

    it('ignores a torrent the poll did not ask about', async () => {
      const { handlers } = mockRpc();
      handlers.set('torrent-get', () => success({ torrents: [{ hashString: 'f'.repeat(40), status: 4 }] }));

      await expect(adapter.status([INFO_HASH], config())).resolves.toEqual([]);
    });
  });

  describe('remove', () => {
    it('leaves the files alone unless deletion was asked for', async () => {
      const { calls } = mockRpc();
      await adapter.remove(INFO_HASH.toUpperCase(), config(), { deleteFiles: false });

      const remove = calls.find((call) => call.method === 'torrent-remove');
      expect(remove?.args).toEqual({ ids: [INFO_HASH], 'delete-local-data': false });
    });

    it('deletes the data when asked', async () => {
      const { calls } = mockRpc();
      await adapter.remove(INFO_HASH, config(), { deleteFiles: true });

      expect(calls.find((call) => call.method === 'torrent-remove')?.args['delete-local-data']).toBe(true);
    });
  });

  describe('test', () => {
    it('reports the version the daemon answers with', async () => {
      const { handlers } = mockRpc();
      handlers.set('session-get', () => success({ version: '4.0.5' }));

      await expect(adapter.test(config())).resolves.toEqual({ success: true, version: '4.0.5' });
    });

    it('turns a rejected login into a failed test rather than throwing', async () => {
      const { handlers } = mockRpc();
      handlers.set('session-get', () => new Response('', { status: 401 }));

      await expect(adapter.test(config())).resolves.toEqual({ success: false, error: 'Transmission rejected those credentials' });
    });

    /** A body-level refusal arrives with a 200, which is the one 200 that is not success. */
    it('treats a non-success result as a refusal despite the 200', async () => {
      const { handlers } = mockRpc();
      handlers.set('session-get', () => new Response(JSON.stringify({ result: 'method name not recognized' }), { status: 200 }));

      const result = await adapter.test(config());
      expect(result.success).toBe(false);
      expect(result.error).toContain('method name not recognized');
    });
  });
});
