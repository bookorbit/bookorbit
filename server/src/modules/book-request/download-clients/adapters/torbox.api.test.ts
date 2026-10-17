vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

vi.mock('../../../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));

import { safeFetch } from '../../../../common/utils/safe-fetch';
import type { ResolvedClientConfig } from '../download-client-adapter';
import { TorboxApiClient } from './torbox.api';

const safeFetchMock = vi.mocked(safeFetch);

/** Request 3's infohash, the one whose TorBox listing this fix has to find. */
const HASH = '0d4af725cc7cdf3ce933e5bff8c0b3a6ed6e0d93';

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 9,
    name: 'torbox',
    adapterType: 'torbox',
    baseUrl: 'https://api.torbox.app',
    username: null,
    password: 'api-secret',
    category: '',
    allowPrivateAddress: false,
    settings: null,
    ...overrides,
  };
}

function envelopeResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
}

describe('TorboxApiClient credential transport', () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
  });

  it('refuses a non-https base URL before sending the API key', async () => {
    await expect(new TorboxApiClient().getUser(config({ baseUrl: 'http://api.torbox.app' }))).rejects.toThrow('TorBox requires an https:// base URL');
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('refuses a plain-http download-link request before sending the API key', async () => {
    await expect(new TorboxApiClient().requestDownloadLink(config({ baseUrl: 'http://api.torbox.app' }), 42, 7)).rejects.toThrow(
      'TorBox requires an https:// base URL',
    );
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('carries the API key over https', async () => {
    safeFetchMock.mockResolvedValueOnce(envelopeResponse({ email: 'reader@example.com', plan: 1 }));

    await expect(new TorboxApiClient().getUser(config())).resolves.toEqual({ email: 'reader@example.com', plan: 1 });

    const [url, init] = safeFetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.torbox.app/v1/api/user/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer api-secret');
  });
});

describe('TorboxApiClient.findByHashes', () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
  });

  it('asks for a fresh listing and matches a requested hash', async () => {
    safeFetchMock.mockResolvedValueOnce(
      envelopeResponse([
        {
          id: 42,
          hash: HASH,
          name: 'Dune',
          download_state: 'downloading',
          download_finished: true,
          download_present: true,
          progress: 1,
          size: 100,
          files: [{ id: 7, name: 'Dune.epub', size: 100 }],
        },
      ]),
    );

    const found = await new TorboxApiClient().findByHashes(config(), new Set([HASH]));

    expect(found.get(HASH)).toMatchObject({ torrentId: 42, downloadFinished: true, files: [{ fileId: 7, name: 'Dune.epub', size: 100 }] });
    // Without `bypass_cache` TorBox answers from a listing that lags by up to ten minutes.
    expect(String(safeFetchMock.mock.calls[0][0])).toBe('https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true&offset=0&limit=1000');
  });

  it('fails rather than reporting an empty account when the answer is not a list', async () => {
    safeFetchMock.mockResolvedValueOnce(envelopeResponse({ unexpected: true }));

    await expect(new TorboxApiClient().findByHashes(config(), new Set([HASH]))).rejects.toThrow('not a list');
  });

  it('pages forward while a page comes back full without the wanted hash', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, hash: 'b'.repeat(64) }));
    safeFetchMock.mockResolvedValueOnce(envelopeResponse(fullPage));
    safeFetchMock.mockResolvedValueOnce(envelopeResponse([{ id: 42, hash: HASH, size: 100, progress: 1, files: [] }]));

    const found = await new TorboxApiClient().findByHashes(config(), new Set([HASH]));

    expect(found.has(HASH)).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    expect(String(safeFetchMock.mock.calls[1][0])).toBe('https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true&offset=1000&limit=1000');
  });
});
