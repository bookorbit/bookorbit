vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

vi.mock('../../../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));

import { safeFetch } from '../../../../common/utils/safe-fetch';
import type { ResolvedClientConfig } from '../download-client-adapter';
import { TorboxApiClient } from './torbox.api';

const safeFetchMock = vi.mocked(safeFetch);

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
