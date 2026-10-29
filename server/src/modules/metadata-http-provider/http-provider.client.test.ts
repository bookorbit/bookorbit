import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { PrivateAddressException } from '../../common/utils/ssrf.utils';
import { HttpProviderClient, HttpProviderError, sniffImageType, type HttpProviderTarget } from './http-provider.client';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

describe('HttpProviderClient', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  const seen: IncomingMessage[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req);
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pack/`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    seen.length = 0;
  });

  const target = (overrides: Partial<HttpProviderTarget> = {}): HttpProviderTarget => ({
    key: 'fake',
    baseUrl,
    authorization: 'Bearer s3cret',
    allowPrivateAddress: true,
    timeoutMs: 2_000,
    rateLimit: { maxConcurrency: 2, minIntervalMs: 0 },
    ...overrides,
  });

  const json =
    (status: number, body: unknown, headers: Record<string, string> = {}): Handler =>
    (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

  it('resolves paths under the base URL and sends the stored authorization header', async () => {
    handler = json(200, { name: 'Fake' });
    await expect(new HttpProviderClient().getInfo(target())).resolves.toEqual({ name: 'Fake' });
    expect(seen[0].url).toBe('/pack/provider/info');
    expect(seen[0].headers.authorization).toBe('Bearer s3cret');
  });

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const image =
    (body: Buffer | string, type: string): Handler =>
    (_req, res) => {
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    };

  it('fetches an icon, keeping the type its bytes show and the credential on the provider host only', async () => {
    const client = new HttpProviderClient();
    // The server claims SVG; the bytes are a PNG, and the bytes win.
    handler = image(PNG, 'image/svg+xml');
    await expect(client.getIcon(target(), `${baseUrl}icon.png`)).resolves.toEqual({ data: PNG, contentType: 'image/png' });
    expect(seen[0].headers.authorization).toBe('Bearer s3cret');

    const elsewhere = `${baseUrl.replace('127.0.0.1', 'localhost')}icon.png`;
    await client.getIcon(target(), elsewhere);
    expect(seen[1].headers.authorization).toBeUndefined();
  });

  it('refuses an SVG, an HTML page and an icon over the size limit', async () => {
    const client = new HttpProviderClient();
    handler = image('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml');
    await expect(client.getIcon(target(), `${baseUrl}icon.svg`)).rejects.toThrow('not a PNG');
    handler = image('<html></html>', 'image/png');
    await expect(client.getIcon(target(), `${baseUrl}icon.png`)).rejects.toThrow('not a PNG');
    handler = image(Buffer.concat([PNG, Buffer.alloc(300 * 1024)]), 'image/png');
    await expect(client.getIcon(target(), `${baseUrl}icon.png`)).rejects.toThrow('too large');
  });

  it('recognises the raster formats it accepts by their first bytes', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg/>'))).toBeNull();
  });

  it('passes search params through and encodes lookup ids', async () => {
    handler = json(200, { matches: [] });
    const client = new HttpProviderClient();
    await client.search(target(), new URLSearchParams({ query: 'Солярис', isbn: '978-5' }));
    await client.lookup(target(), 'e 723/x');
    expect(seen[0].url).toBe('/pack/search?query=%D0%A1%D0%BE%D0%BB%D1%8F%D1%80%D0%B8%D1%81&isbn=978-5');
    expect(seen[1].url).toBe('/pack/book/e%20723%2Fx');
  });

  it('never lets a dot-segment id leave the book path', async () => {
    handler = json(200, { providerId: 'root', title: 'Not a book' });
    const client = new HttpProviderClient();
    await expect(client.lookup(target(), '..')).resolves.toBeNull();
    await expect(client.lookup(target(), '.')).resolves.toBeNull();
    expect(seen).toEqual([]);
    await client.lookup(target(), '...');
    expect(seen[0].url).toBe('/pack/book/...');
  });

  it('answers a 404 lookup with null and maps refusals to typed errors', async () => {
    const client = new HttpProviderClient();
    handler = json(404, { error: 'Not found' });
    await expect(client.lookup(target(), '1')).resolves.toBeNull();
    await expect(client.search(target(), new URLSearchParams())).rejects.toMatchObject({ kind: 'failed', status: 404 });

    handler = json(429, {}, { 'retry-after': '30' });
    await expect(client.search(target(), new URLSearchParams())).rejects.toMatchObject({ kind: 'throttled', retryAfterSeconds: 30 });

    handler = json(401, {});
    await expect(client.getInfo(target())).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });

    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>parked</html>');
    };
    await expect(client.getInfo(target())).rejects.toBeInstanceOf(HttpProviderError);
  });

  it('refuses a body over 2 MB', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(`"${'x'.repeat(2 * 1024 * 1024 + 10)}"`);
    };
    await expect(new HttpProviderClient().getInfo(target())).rejects.toThrow('too large');
  });

  it('follows a redirect on the same origin and keeps the header', async () => {
    handler = (req, res) => {
      if (req.url === '/pack/provider/info') {
        res.writeHead(302, { location: '/pack/v2/provider/info' });
        res.end();
        return;
      }
      json(200, { name: 'Moved' })(req, res);
    };
    await expect(new HttpProviderClient().getInfo(target())).resolves.toEqual({ name: 'Moved' });
    expect(seen[1].headers.authorization).toBe('Bearer s3cret');
  });

  it('stops after three redirects', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: '/pack/provider/info' });
      res.end();
    };
    await expect(new HttpProviderClient().getInfo(target())).rejects.toThrow('too many times');
    expect(seen).toHaveLength(4);
  });

  it('refuses a private address unless the row allows one', async () => {
    handler = json(200, { name: 'Fake' });
    await expect(new HttpProviderClient().getInfo(target({ allowPrivateAddress: false }))).rejects.toBeInstanceOf(PrivateAddressException);
    expect(seen).toHaveLength(0);
  });

  it('gives up when the provider does not answer in time', async () => {
    handler = () => undefined;
    await expect(new HttpProviderClient().getInfo(target({ timeoutMs: 100 }))).rejects.toThrow();
  });

  it('keeps no more requests in flight than the provider allows', async () => {
    let inFlight = 0;
    let peak = 0;
    handler = (_req, res) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight--;
        json(200, { matches: [] })(_req, res);
      }, 30);
    };
    const client = new HttpProviderClient();
    const limited = target({ rateLimit: { maxConcurrency: 1, minIntervalMs: 0 } });
    await Promise.all([1, 2, 3].map(() => client.search(limited, new URLSearchParams())));
    expect(peak).toBe(1);
  });
});
