import { BadRequestException } from '@nestjs/common';

import type { KoboProxyRequestOptions } from './kobo-proxy.service';
import { KoboProxyService } from './kobo-proxy.service';

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('KoboProxyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards request to Kobo API, remaps path, and relays response body and safe headers', async () => {
    const service = new KoboProxyService();
    const upstreamHeaders = new Headers({
      'content-type': 'application/json',
      'x-custom': 'ok',
      connection: 'close',
      'content-length': '123',
    });
    const upstream = {
      status: 200,
      headers: upstreamHeaders,
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{"ok":true}').buffer),
    };
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      url: '/api/v1/kobo/device-1/v1/library/sync?since=1',
      headers: {
        accept: 'application/json',
        host: 'localhost:3000',
        'x-kobo-deviceid': 'dev123',
        'x-kobo-userkey': 'user-secret',
        'x-kobo-synctoken': 'raw-kobo-token',
        'content-length': '17',
      },
      body: { hello: 'world' },
    };
    const reply = makeReply();

    await service.forward(req as never, reply as never, 'device-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://storeapi.kobo.com/v1/library/sync?since=1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json',
          'x-kobo-deviceid': 'dev123',
          'x-kobo-userkey': 'user-secret',
          'x-kobo-synctoken': 'raw-kobo-token',
        }),
        body: '{"hello":"world"}',
      }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders).not.toHaveProperty('host');
    expect(sentHeaders).not.toHaveProperty('content-length');
    // Raw Kobo tokens (no PX. prefix) reach Kobo verbatim, so the device's own cursor is forwarded.
    expect(sentHeaders['x-kobo-synctoken']).toBe('raw-kobo-token');
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.header).toHaveBeenCalledWith('content-type', 'application/json');
    expect(reply.header).toHaveBeenCalledWith('x-custom', 'ok');
    expect(reply.header).not.toHaveBeenCalledWith('connection', 'close');
    expect(reply.header).not.toHaveBeenCalledWith('content-length', '123');
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('{"ok":true}'));
  });

  it('skips body forwarding for GET requests', async () => {
    const service = new KoboProxyService();
    const upstream = {
      status: 204,
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    };
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetchMock);

    await service.forward(
      {
        method: 'GET',
        url: '/v1/affiliate',
        headers: {},
        body: { ignored: true },
      } as never,
      makeReply() as never,
      'token',
    );

    expect(fetchMock).toHaveBeenCalledWith('https://storeapi.kobo.com/v1/affiliate', expect.objectContaining({ method: 'GET', body: undefined }));
  });

  it('preserves Kobo reading-state PUT payload and authentication when proxying', async () => {
    const service = new KoboProxyService();
    const upstream = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{"RequestResult":"Success"}').buffer),
    };
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetchMock);
    const entitlementId = 'baee12cd-e85f-4d98-be7f-ac5ec1289fb5';
    const body = { ReadingStates: [{ EntitlementId: entitlementId, CurrentBookmark: { ProgressPercent: 6 } }] };
    const req = {
      method: 'PUT',
      url: `/api/v1/kobo/device-1/v1/library/${entitlementId}/state`,
      headers: {
        accept: 'application/json',
        authorization: 'Bearer kobo-oauth-token',
        'content-type': 'application/json',
        'user-agent': 'Kobo Touch',
        'x-kobo-appversion': '4.45.23697',
        'x-kobo-deviceid': 'device-id',
        host: 'bookorbit.example.com',
      },
      body,
    };
    const reply = makeReply();

    await service.forward(req as never, reply as never, 'device-1');

    expect(fetchMock).toHaveBeenCalledWith(
      `https://storeapi.kobo.com/v1/library/${entitlementId}/state`,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          accept: 'application/json',
          authorization: 'Bearer kobo-oauth-token',
          'content-type': 'application/json',
          'user-agent': 'Kobo Touch',
          'x-kobo-appversion': '4.45.23697',
          'x-kobo-deviceid': 'device-id',
        }),
        body: JSON.stringify(body),
      }),
    );
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('{"RequestResult":"Success"}'));
  });

  it('returns 502 when upstream call fails', async () => {
    const service = new KoboProxyService();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const reply = makeReply();

    await service.forward(
      {
        method: 'GET',
        url: '/api/v1/kobo/dev/v1/library/sync',
        headers: {},
      } as never,
      reply as never,
      'dev',
    );

    expect(reply.status).toHaveBeenCalledWith(502);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Upstream Kobo API unavailable' });
  });

  describe('over-the-device-borrow flow', () => {
    it('forwards the Kobo userkey and decodes the BookOrbit composite sync token before proxying a borrow', async () => {
      const service = new KoboProxyService();
      const upstream = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{"success":true}').buffer),
      };
      const fetchMock = vi.fn().mockResolvedValue(upstream);
      vi.stubGlobal('fetch', fetchMock);

      const composite = `PX.${Buffer.from(JSON.stringify({ snapshotId: 4, koboSyncToken: 'kobo-cursor-9' })).toString('base64')}`;
      const req = {
        method: 'POST',
        url: '/api/v1/kobo/dev/v1/library/borrow',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-kobo-userkey': 'device-user-key',
          'x-kobo-deviceid': 'device-id',
          'x-kobo-synctoken': composite,
        },
        body: { BookId: '9780123456789' },
      };
      const reply = makeReply();

      await service.forward(req as never, reply as never, 'dev');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://storeapi.kobo.com/v1/library/borrow',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-kobo-userkey': 'device-user-key',
            'x-kobo-synctoken': 'kobo-cursor-9',
          }),
          body: JSON.stringify({ BookId: '9780123456789' }),
        }),
      );
    });

    it('omits the sync token entirely when the device sent no Kobo cursor', async () => {
      const service = new KoboProxyService();
      const upstream = {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      const fetchMock = vi.fn().mockResolvedValue(upstream);
      vi.stubGlobal('fetch', fetchMock);

      const composite = `PX.${Buffer.from(JSON.stringify({ snapshotId: 4 })).toString('base64')}`;
      const req = {
        method: 'POST',
        url: '/api/v1/kobo/dev/v1/library/borrow',
        headers: {
          'x-kobo-userkey': 'device-user-key',
          'x-kobo-synctoken': composite,
        },
        body: {},
      };

      await service.forward(req as never, makeReply() as never, 'dev');

      const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(sentHeaders).not.toHaveProperty('x-kobo-synctoken');
      expect(sentHeaders['x-kobo-userkey']).toBe('device-user-key');
    });
  });

  describe('credentials that must not reach Kobo', () => {
    function stubFetch() {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    async function sentHeaders(headers: Record<string, string>, options?: KoboProxyRequestOptions): Promise<Record<string, string>> {
      const fetchMock = stubFetch();
      await new KoboProxyService().request({ method: 'GET', url: '/api/v1/kobo/dev/v1/library/sync', headers } as never, 'dev', options);
      return fetchMock.mock.calls[0][1].headers as Record<string, string>;
    }

    const composite = `PX.${Buffer.from(JSON.stringify({ snapshotId: 4, koboSyncToken: 'kobo-cursor-9' })).toString('base64')}`;

    // Every caller gets the substitution, not just the ones that remember to ask: forwardTagDelete
    // relays through request() with no options and must not hand Kobo a token it cannot read.
    it('substitutes the Kobo cursor for the composite token even with no options', async () => {
      expect((await sentHeaders({ 'x-kobo-synctoken': composite }))['x-kobo-synctoken']).toBe('kobo-cursor-9');
    });

    it('drops a composite token it cannot decode rather than forwarding it', async () => {
      expect(await sentHeaders({ 'x-kobo-synctoken': 'PX.not-base64-json' })).not.toHaveProperty('x-kobo-synctoken');
    });

    it('still lets omitHeaders drop the token the substitution would have written', async () => {
      const headers = await sentHeaders({ 'x-kobo-synctoken': composite }, { omitHeaders: ['x-kobo-synctoken'] });
      expect(headers).not.toHaveProperty('x-kobo-synctoken');
    });

    it('still lets extraHeaders override the token the substitution would have written', async () => {
      const headers = await sentHeaders({ 'x-kobo-synctoken': composite }, { extraHeaders: { 'x-kobo-synctoken': 'server-cursor' } });
      expect(headers['x-kobo-synctoken']).toBe('server-cursor');
    });

    // These routes sit on the BookOrbit origin, so a browser carrying a session reaches them with
    // our auth cookies attached. Kobo must never receive those; cookies it set itself still ride.
    it('strips the BookOrbit session cookies while keeping the rest of the jar', async () => {
      const headers = await sentHeaders({ cookie: 'access_token=secret; kobo_session=keep-me; refresh_token=secret; wsid=abc' });
      expect(headers.cookie).toBe('kobo_session=keep-me; wsid=abc');
    });

    it('sends no cookie header at all when only BookOrbit cookies were present', async () => {
      expect(await sentHeaders({ cookie: 'access_token=secret; refresh_token=secret' })).not.toHaveProperty('cookie');
    });

    it('drops the reverse proxy forwarding headers that describe our hop', async () => {
      const headers = await sentHeaders({
        forwarded: 'for=10.0.0.5',
        'x-forwarded-for': '10.0.0.5',
        'x-forwarded-host': 'books.example',
        'x-forwarded-proto': 'https',
        'x-real-ip': '10.0.0.5',
        'x-kobo-userkey': 'device-user-key',
      });

      expect(headers).not.toHaveProperty('forwarded');
      expect(headers).not.toHaveProperty('x-forwarded-for');
      expect(headers).not.toHaveProperty('x-forwarded-host');
      expect(headers).not.toHaveProperty('x-forwarded-proto');
      expect(headers).not.toHaveProperty('x-real-ip');
      expect(headers['x-kobo-userkey']).toBe('device-user-key');
    });
  });

  describe('hop-by-hop header handling', () => {
    it('strips the singular Trailer header field on the way out', async () => {
      const service = new KoboProxyService();
      const upstream = {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      const fetchMock = vi.fn().mockResolvedValue(upstream);
      vi.stubGlobal('fetch', fetchMock);

      await service.forward(
        {
          method: 'GET',
          url: '/api/v1/kobo/dev/v1/library/sync',
          headers: {
            trailer: 'x-internal-state',
            'x-kobo-deviceid': 'device-id',
          },
        } as never,
        makeReply() as never,
        'dev',
      );

      const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(sentHeaders).not.toHaveProperty('trailer');
      expect(sentHeaders['x-kobo-deviceid']).toBe('device-id');
    });

    it('drops header fields nominated by the device Connection header before forwarding', async () => {
      const service = new KoboProxyService();
      const upstream = {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      const fetchMock = vi.fn().mockResolvedValue(upstream);
      vi.stubGlobal('fetch', fetchMock);

      await service.forward(
        {
          method: 'GET',
          url: '/api/v1/kobo/dev/v1/library/sync',
          headers: {
            connection: 'x-kobo-tracking, x-kobo-internal',
            'x-kobo-tracking': 'should-be-stripped',
            'x-kobo-internal': 'also-stripped',
            'x-kobo-deviceid': 'device-id',
          },
        } as never,
        makeReply() as never,
        'dev',
      );

      const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(sentHeaders).not.toHaveProperty('x-kobo-tracking');
      expect(sentHeaders).not.toHaveProperty('x-kobo-internal');
      expect(sentHeaders['x-kobo-deviceid']).toBe('device-id');
    });

    it('drops header fields nominated by the upstream Connection header before relaying the response', async () => {
      const service = new KoboProxyService();
      const upstream = {
        status: 200,
        headers: new Headers({
          connection: 'x-kobo-tracking, x-kobo-internal',
          'x-kobo-tracking': 'should-be-stripped',
          'x-kobo-internal': 'also-stripped',
          'x-kobo-deviceid': 'device-id',
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{}').buffer),
      };
      const fetchMock = vi.fn().mockResolvedValue(upstream);
      vi.stubGlobal('fetch', fetchMock);

      const reply = makeReply();
      await service.forward(
        {
          method: 'GET',
          url: '/api/v1/kobo/dev/v1/library/sync',
          headers: {},
        } as never,
        reply as never,
        'dev',
      );

      expect(reply.header).not.toHaveBeenCalledWith('x-kobo-tracking', expect.anything());
      expect(reply.header).not.toHaveBeenCalledWith('x-kobo-internal', expect.anything());
      expect(reply.header).toHaveBeenCalledWith('x-kobo-deviceid', 'device-id');
    });
  });

  describe('request', () => {
    function stubUpstream(headers: Record<string, string>, body = '[]') {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(headers),
        arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(body).buffer),
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    const syncRequest = {
      method: 'GET',
      url: '/api/v1/kobo/dev/v1/library/sync?Filter=ALL',
      headers: { authorization: 'Bearer kobo-jwt', 'x-kobo-synctoken': 'PX.composite', 'x-kobo-userkey': 'user-secret' },
    };

    it('returns the upstream response with lowercased headers instead of piping it', async () => {
      stubUpstream({ 'X-Kobo-Sync': 'continue', 'X-Kobo-SyncToken': 'kobo-cursor' }, '[{"a":1}]');

      const response = await new KoboProxyService().request(syncRequest as never, 'dev');

      expect(response.status).toBe(200);
      expect(response.headers['x-kobo-sync']).toBe('continue');
      expect(response.headers['x-kobo-synctoken']).toBe('kobo-cursor');
      expect(JSON.parse(response.body.toString('utf8'))).toEqual([{ a: 1 }]);
    });

    it('overrides a forwarded header with extraHeaders', async () => {
      const fetchMock = stubUpstream({});

      await new KoboProxyService().request(syncRequest as never, 'dev', { extraHeaders: { 'x-kobo-synctoken': 'kobo-cursor' } });

      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer kobo-jwt', 'x-kobo-synctoken': 'kobo-cursor' });
    });

    it('drops a forwarded header listed in omitHeaders while keeping the device credential', async () => {
      const fetchMock = stubUpstream({});

      await new KoboProxyService().request(syncRequest as never, 'dev', { omitHeaders: ['X-Kobo-SyncToken'] });

      const sentHeaders = fetchMock.mock.calls[0][1].headers;
      expect(sentHeaders).not.toHaveProperty('x-kobo-synctoken');
      expect(sentHeaders.authorization).toBe('Bearer kobo-jwt');
    });

    it('attaches an abort signal only when a timeout is requested', async () => {
      const fetchMock = stubUpstream({});
      const service = new KoboProxyService();

      await service.request(syncRequest as never, 'dev');
      expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();

      await service.request(syncRequest as never, 'dev', { timeoutMs: 8000 });
      expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('propagates upstream failures to the caller rather than swallowing them', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      await expect(new KoboProxyService().request(syncRequest as never, 'dev')).rejects.toThrow('network down');
    });
  });

  describe('buildTargetUrl', () => {
    let service: KoboProxyService;

    beforeEach(() => {
      service = new KoboProxyService();
    });

    it('builds correct URL for a standard API path', () => {
      expect((service as any).buildTargetUrl('/v1/library/sync?since=1')).toBe('https://storeapi.kobo.com/v1/library/sync?since=1');
    });

    it('builds correct URL for a path without query string', () => {
      expect((service as any).buildTargetUrl('/v1/affiliate')).toBe('https://storeapi.kobo.com/v1/affiliate');
    });

    it('throws for an absolute URL pointing to a different host', () => {
      expect(() => (service as any).buildTargetUrl('https://evil.com/path')).toThrow(BadRequestException);
    });

    it('throws for a protocol-relative URL pointing to a different host', () => {
      expect(() => (service as any).buildTargetUrl('//evil.com/path')).toThrow(BadRequestException);
    });

    it('throws for a path that introduces a scheme override', () => {
      expect(() => (service as any).buildTargetUrl('https://storeapi.kobo.com@evil.com/path')).toThrow(BadRequestException);
    });

    it('throws for a javascript: scheme in the path', () => {
      expect(() => (service as any).buildTargetUrl('javascript:alert()')).toThrow(BadRequestException);
    });

    it('allows a path containing @ that does not change the hostname', () => {
      const url = (service as any).buildTargetUrl('/v1/path/with@symbol');
      expect(url).toBe('https://storeapi.kobo.com/v1/path/with@symbol');
    });
  });
});
