import { BadRequestException } from '@nestjs/common';

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
      },
      body: { hello: 'world' },
    };
    const reply = makeReply();

    await service.forward(req as never, reply as never, 'device-1');

    expect(fetchMock).toHaveBeenCalledWith('https://storeapi.kobo.com/v1/library/sync?since=1', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-kobo-deviceid': 'dev123',
      },
      body: '{"hello":"world"}',
    });
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

    expect(fetchMock).toHaveBeenCalledWith(`https://storeapi.kobo.com/v1/library/${entitlementId}/state`, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer kobo-oauth-token',
        'content-type': 'application/json',
        'user-agent': 'Kobo Touch',
        'x-kobo-appversion': '4.45.23697',
        'x-kobo-deviceid': 'device-id',
      },
      body: JSON.stringify(body),
    });
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
      headers: { authorization: 'Bearer kobo-jwt', 'x-kobo-synctoken': 'PX.composite' },
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
