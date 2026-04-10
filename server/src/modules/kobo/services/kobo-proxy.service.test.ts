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
});
