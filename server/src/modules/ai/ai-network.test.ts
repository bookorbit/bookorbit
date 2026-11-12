import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Both the pre-flight and the connection's own lookup go through this. */
vi.mock('dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns/promises')>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

import { lookup } from 'dns/promises';

import { forgetDispatchers } from '../../common/utils/safe-fetch';
import { isLinkLocalOrMetadataAddress } from '../../common/utils/ssrf.utils';
import { AI_MAX_RESPONSE_BYTES, AiNetworkError, aiHttp } from './ai-network';

const lookupMock = vi.mocked(lookup) as unknown as ReturnType<typeof vi.fn>;
const options = { networkProfile: null, timeoutMs: 5_000 };

async function failure(url: string, extra: Partial<typeof options> & { signal?: AbortSignal } = {}): Promise<AiNetworkError> {
  const error = await aiHttp({ method: 'GET', url, headers: {} }, { ...options, ...extra }).catch((err: unknown) => err);
  expect(error).toBeInstanceOf(AiNetworkError);
  return error as AiNetworkError;
}

describe('isLinkLocalOrMetadataAddress', () => {
  it.each([
    '169.254.169.254',
    '169.254.0.1',
    'fe80::1',
    'FE80::abcd%en0',
    'febf::1',
    'fd00:ec2::254',
    'fd00:0ec2:0:0:0:0:0:254',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
  ])('blocks %s', (address) => {
    expect(isLinkLocalOrMetadataAddress(address)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.20',
    '172.16.0.1',
    '::1',
    'fd00::1',
    'fd00:ec2::253',
    '8.8.8.8',
    '2606:4700::1111',
    '::ffff:10.0.0.1',
  ])('allows %s', (address) => {
    expect(isLinkLocalOrMetadataAddress(address)).toBe(false);
  });
});

describe('aiHttp', () => {
  let server: Server;
  let base: string;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    forgetDispatchers();
    lookupMock.mockClear();
  });

  it('reaches a private address, since local runners live there', async () => {
    handler = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    const response = await aiHttp(
      { method: 'POST', url: `${base}/v1/chat/completions`, headers: { 'content-type': 'application/json' }, body: '{}' },
      options,
    );
    expect(response).toMatchObject({ status: 200, text: '{"ok":true}' });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://[fd00:ec2::254]/latest',
    'http://[fe80::1]:8080/v1',
    'http://[::ffff:169.254.169.254]/',
  ])('refuses %s before connecting', async (url) => {
    expect(await failure(url)).toMatchObject({ failure: 'blocked-address' });
  });

  it('refuses a name that resolves to the metadata address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as never);
    expect(await failure('http://metadata.example.test/v1')).toMatchObject({ failure: 'blocked-address' });
  });

  it('refuses a name that answers publicly first and with the metadata address at connect time', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: 'fd00:ec2::254', family: 6 }] as never);
    expect(await failure('http://rebinding.example.test/v1')).toMatchObject({ failure: 'blocked-address' });
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('does not follow a redirect and names where it pointed', async () => {
    handler = (_req, res) => res.writeHead(301, { location: 'https://api.example.com/v1/models' }).end();
    expect(await failure(`${base}/v1/models`)).toMatchObject({ failure: 'redirect', extra: { location: 'https://api.example.com/v1/models' } });
  });

  it('stops reading a body over 8 MB', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const chunk = Buffer.alloc(1024 * 1024, 'a');
      for (let i = 0; i < AI_MAX_RESPONSE_BYTES / chunk.length + 1; i++) res.write(chunk);
      res.end();
    };
    expect(await failure(`${base}/v1/models`)).toMatchObject({ failure: 'provider-error', message: 'The provider sent more than 8 MB' });
  });

  it('refuses a declared length over 8 MB without reading it', async () => {
    handler = (_req, res) => res.writeHead(200, { 'content-length': String(AI_MAX_RESPONSE_BYTES + 1) }).end();
    expect(await failure(`${base}/v1/models`)).toMatchObject({ failure: 'provider-error' });
  });

  it('gives up at the connection timeout', async () => {
    handler = () => undefined;
    expect(await failure(`${base}/v1/models`, { timeoutMs: 150 })).toMatchObject({ failure: 'timeout' });
  });

  it('stops when the job is cancelled', async () => {
    handler = () => undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    expect(await failure(`${base}/v1/models`, { signal: controller.signal })).toMatchObject({ failure: 'timeout', extra: { aborted: true } });
  });

  it('says plainly when nothing listens there', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await failure(`http://127.0.0.1:${port}/v1`)).toMatchObject({
      failure: 'unreachable',
      message: 'Nothing is listening at this address and port',
    });
  });

  it('refuses schemes other than http and https', async () => {
    expect(await failure('file:///etc/passwd')).toMatchObject({ failure: 'invalid-url' });
  });
});
