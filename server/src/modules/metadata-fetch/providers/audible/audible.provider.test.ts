import type { ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { buildRequestSignal } from '../provider-utils';
import { mapAudibleProduct } from './audible.mapper';
import { AudibleProvider } from './audible.provider';

vi.mock('../../fetch-with-throttle', () => ({
  fetchWithThrottle: vi.fn(),
}));

vi.mock('../provider-utils', () => ({
  buildRequestSignal: vi.fn(() => new AbortController().signal),
}));

vi.mock('./audible.mapper', () => ({
  mapAudibleProduct: vi.fn((product: { asin?: string; title?: string }) => ({
    provider: 'audible',
    providerId: product.asin ?? 'missing',
    title: product.title ?? 'untitled',
  })),
}));

const mockFetchWithThrottle = fetchWithThrottle as MockedFunction<typeof fetchWithThrottle>;
const mockBuildRequestSignal = buildRequestSignal as MockedFunction<typeof buildRequestSignal>;
const mockMapAudibleProduct = mapAudibleProduct as MockedFunction<typeof mapAudibleProduct>;

const baseConfig: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: false },
  itunes: { enabled: false, coverResolution: 'high' },
  audible: { enabled: true, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: false },
};

function makeProvider(config: ProviderConfigurations = baseConfig): {
  provider: AudibleProvider;
  providerConfig: { getConfig: MockedFunction<() => Promise<ProviderConfigurations>> };
} {
  const providerConfig = {
    getConfig: vi.fn().mockResolvedValue(config),
  };

  return {
    provider: new AudibleProvider(providerConfig as unknown as ProviderConfigService),
    providerConfig,
  };
}

describe('AudibleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results when provider is disabled', async () => {
    const { provider } = makeProvider({
      ...baseConfig,
      audible: { enabled: false, domain: 'com' },
    });

    await expect(provider.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual([]);
    expect(mockFetchWithThrottle).not.toHaveBeenCalled();
  });

  it('returns empty results for non-audiobook searches', async () => {
    const { provider } = makeProvider();

    await expect(provider.search({ title: 'Dune', isAudiobook: false })).resolves.toEqual([]);
    expect(mockFetchWithThrottle).not.toHaveBeenCalled();
  });

  it('returns empty results when there is no title/author query', async () => {
    const { provider } = makeProvider();

    await expect(provider.search({ isAudiobook: true })).resolves.toEqual([]);
    expect(mockFetchWithThrottle).not.toHaveBeenCalled();
  });

  it('searches audible with normalized domain and mapped response', async () => {
    const { provider } = makeProvider({
      ...baseConfig,
      audible: { enabled: true, domain: 'https://api.audible.co.uk/store' },
    });

    mockFetchWithThrottle.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        products: [
          { asin: 'A1', title: 'Dune' },
          { asin: 'A2', title: 'Dune Messiah' },
        ],
      }),
    } as unknown as Response);

    const result = await provider.search({ title: 'Dune', author: 'Frank Herbert', isAudiobook: true });

    expect(mockFetchWithThrottle).toHaveBeenCalledWith(
      expect.stringContaining('https://api.audible.co.uk/1.0/catalog/products'),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mockFetchWithThrottle).toHaveBeenCalledWith(expect.stringContaining('keywords=Dune+Frank+Herbert'), expect.any(Object));
    expect(mockBuildRequestSignal).toHaveBeenCalled();
    expect(mockMapAudibleProduct).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { provider: 'audible', providerId: 'A1', title: 'Dune' },
      { provider: 'audible', providerId: 'A2', title: 'Dune Messiah' },
    ]);
  });

  it('returns empty results on non-ok search responses', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    } as unknown as Response);

    await expect(provider.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual([]);
  });

  it('rethrows throttling errors from search', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle.mockRejectedValue(new ProviderThrottleError(90));

    await expect(provider.search({ title: 'Dune', isAudiobook: true })).rejects.toBeInstanceOf(ProviderThrottleError);
  });

  it('returns empty results on unexpected search failures', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle.mockRejectedValue(new Error('network down'));

    await expect(provider.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual([]);
  });

  it('returns null from lookupById when provider is disabled', async () => {
    const { provider } = makeProvider({
      ...baseConfig,
      audible: { enabled: false, domain: 'com' },
    });

    await expect(provider.lookupById('A1')).resolves.toBeNull();
    expect(mockFetchWithThrottle).not.toHaveBeenCalled();
  });

  it('looks up a product by provider id and maps the result', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        product: { asin: 'A1', title: 'Dune' },
      }),
    } as unknown as Response);

    await expect(provider.lookupById('A1')).resolves.toEqual({
      provider: 'audible',
      providerId: 'A1',
      title: 'Dune',
    });
    expect(mockFetchWithThrottle).toHaveBeenCalledWith(
      expect.stringContaining('/1.0/catalog/products/A1'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns null for non-ok lookup responses or empty product payloads', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: vi.fn(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ product: null }),
      } as unknown as Response);

    await expect(provider.lookupById('missing')).resolves.toBeNull();
    await expect(provider.lookupById('empty')).resolves.toBeNull();
  });

  it('rethrows throttling errors from lookupById', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle.mockRejectedValue(new ProviderThrottleError(45));

    await expect(provider.lookupById('A1')).rejects.toBeInstanceOf(ProviderThrottleError);
  });

  it('returns null on unexpected lookup failures', async () => {
    const { provider } = makeProvider();
    mockFetchWithThrottle.mockRejectedValue(new Error('request failed'));

    await expect(provider.lookupById('A1')).resolves.toBeNull();
  });
});
