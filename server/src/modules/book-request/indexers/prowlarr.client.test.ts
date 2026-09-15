vi.mock('../../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));
vi.mock('../../../common/utils/ssrf.utils', () => ({ ensureSafeUrl: vi.fn((value: string) => Promise.resolve(new URL(value))) }));

import { BadGatewayException } from '@nestjs/common';

import { safeFetch } from '../../../common/utils/safe-fetch';
import { ProwlarrClient, type ProwlarrConnection } from './prowlarr.client';

const fetchMock = vi.mocked(safeFetch);
const connection: ProwlarrConnection = {
  baseUrl: 'https://prowlarr.example.test/root',
  apiKey: 'secret-key',
  allowPrivateAddress: false,
  networkProfile: null,
};

describe('ProwlarrClient', () => {
  beforeEach(() => fetchMock.mockReset());

  it('reads status and discovers bounded torrent and Usenet child sources', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ version: '1.2.3' }))).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 4,
            name: 'Torrent source',
            implementation: 'Cardigann',
            protocol: 'torrent',
            enable: true,
            priority: 10,
            fields: [
              { name: 'torrentBaseSettings.seedRatio', value: '2.5' },
              { name: 'torrentBaseSettings.seedTime', value: 7200 },
            ],
          },
          { id: 8, name: 'Usenet source', protocol: 'usenet', enable: false, priority: 20 },
          { id: 9, name: 'Unsupported source', protocol: 'http', enable: true },
        ]),
      ),
    );

    const client = new ProwlarrClient();
    await expect(client.status(connection)).resolves.toEqual({ version: '1.2.3' });
    await expect(client.indexers(connection)).resolves.toEqual([
      {
        id: 4,
        name: 'Torrent source',
        implementation: 'Cardigann',
        protocol: 'torrent',
        enabled: true,
        priority: 10,
        seedRatioGoal: 2.5,
        seedTimeMinutes: 7200,
      },
      {
        id: 8,
        name: 'Usenet source',
        implementation: null,
        protocol: 'usenet',
        enabled: false,
        priority: 20,
        seedRatioGoal: null,
        seedTimeMinutes: null,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ 'X-Api-Key': 'secret-key' }));
  });

  it('drops a seed time the column could never hold rather than losing the whole synchronization', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 4,
            name: 'Torrent source',
            protocol: 'torrent',
            enable: true,
            fields: [
              { name: 'torrentBaseSettings.seedRatio', value: 1.5 },
              { name: 'torrentBaseSettings.seedTime', value: 9_000_000_000 },
            ],
          },
        ]),
      ),
    );

    await expect(new ProwlarrClient().indexers(connection)).resolves.toEqual([
      expect.objectContaining({ id: 4, seedRatioGoal: 1.5, seedTimeMinutes: null }),
    ]);
  });

  it('rejects invalid discovery payloads and oversized responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ indexers: [] })));
    await expect(new ProwlarrClient().indexers(connection)).rejects.toBeInstanceOf(BadGatewayException);

    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    await expect(new ProwlarrClient().indexers(connection)).rejects.toThrow(/more data/);
  });

  it('never forwards the API key across an origin-changing redirect', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example.test/api' } }));

    await expect(new ProwlarrClient().status(connection)).rejects.toThrow(/different host/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an authentication refusal distinctly', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(new ProwlarrClient().status(connection)).rejects.toThrow(/rejected the API key/);
  });
});
