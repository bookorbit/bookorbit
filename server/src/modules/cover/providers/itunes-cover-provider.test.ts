import { ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../metadata-preferences/provider-config.service';
import { ITunesCoverProvider } from './itunes-cover-provider';

const baseConfig: ProviderConfigurations = {
  google: { enabled: true, apiKey: '' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: true },
  itunes: { enabled: true, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: false },
};

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue('application/json') },
  } as unknown as Response;
}

describe('ITunesCoverProvider', () => {
  let provider: ITunesCoverProvider;
  let providerConfig: ProviderConfigService;

  beforeEach(() => {
    providerConfig = {
      getConfig: vi.fn().mockResolvedValue(baseConfig),
    } as unknown as ProviderConfigService;
    provider = new ITunesCoverProvider(providerConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty results when iTunes metadata provider is disabled', async () => {
    vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
      ...baseConfig,
      itunes: { enabled: false, coverResolution: 'high' },
    });
    global.fetch = vi.fn();

    await expect(provider.search({ title: 'Dune' })).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses ebook entity and high resolution mapping by default', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({
        resultCount: 1,
        results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/id/cover.jpg/100x100bb.jpg' }],
      }),
    );

    const results = await provider.search({ title: 'Dune', author: 'Frank Herbert' });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/v4/id/cover.jpg/10000x10000bb.jpg');
    expect(results[0].previewUrl).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/v4/id/cover.jpg/300x300bb.jpg');
    expect(results[0].source).toBe('iTunes');
    const [requestUrl] = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls[0];
    const parsed = new URL(requestUrl);
    expect(parsed.searchParams.get('entity')).toBe('ebook');
    expect(parsed.searchParams.get('term')).toBe('Dune Frank Herbert');
  });

  it('uses audiobook entity and standard cover mapping when configured', async () => {
    vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
      ...baseConfig,
      itunes: { enabled: true, coverResolution: 'standard' },
    });
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({
        resultCount: 1,
        results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/id/cover.jpg/100x100bb.jpg' }],
      }),
    );

    const results = await provider.search({ title: 'Dune', isAudiobook: true });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/v4/id/cover.jpg/600x600bb.jpg');
    const [requestUrl] = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls[0];
    const parsed = new URL(requestUrl);
    expect(parsed.searchParams.get('entity')).toBe('audiobook');
  });

  it('falls back to title-only query when title+author has no results', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ resultCount: 0, results: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          resultCount: 1,
          results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/id/cover.jpg/100x100bb.jpg' }],
        }),
      );

    const results = await provider.search({ title: 'Dune', author: 'Frank Herbert' });
    expect(results).toHaveLength(1);
    expect((global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls).toHaveLength(2);
    const [firstUrl] = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls[0];
    const [secondUrl] = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls[1];
    expect(new URL(firstUrl).searchParams.get('term')).toBe('Dune Frank Herbert');
    expect(new URL(secondUrl).searchParams.get('term')).toBe('Dune');
  });
});
