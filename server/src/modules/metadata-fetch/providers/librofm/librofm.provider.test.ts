import type { ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { LibroFmProvider } from './librofm.provider';

vi.mock('../../fetch-with-throttle', () => ({
  fetchWithThrottle: vi.fn(),
}));

const mockFetchWithThrottle = fetchWithThrottle as MockedFunction<typeof fetchWithThrottle>;

const baseConfig: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: false },
  itunes: { enabled: false, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  librofm: { enabled: true },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: false },
  kobo: { enabled: false, country: 'us', language: 'en' },
  lubimyczytac: { enabled: false },
  aladin: { enabled: false, ttbKey: '' },
};

function makeProvider(config: ProviderConfigurations = baseConfig): LibroFmProvider {
  const providerConfig = { getConfig: vi.fn().mockResolvedValue(config) };
  return new LibroFmProvider(providerConfig as unknown as ProviderConfigService);
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('LibroFmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not search when disabled or when the book is not an audiobook', async () => {
    const disabled = makeProvider({ ...baseConfig, librofm: { enabled: false } });
    await expect(disabled.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual([]);
    await expect(makeProvider().search({ title: 'Dune', isAudiobook: false })).resolves.toEqual([]);
    expect(mockFetchWithThrottle).not.toHaveBeenCalled();
  });

  it('uses an ISBN for a direct details lookup', async () => {
    mockFetchWithThrottle.mockResolvedValue(
      response({
        data: {
          audiobook: {
            title: 'Dune',
            isbn: 9781427201438,
            audiobook_info: { narrators: ['Simon Vance'], duration: 75840 },
          },
        },
      }),
    );

    const result = await makeProvider().search({ isbn: '9781427201438', isAudiobook: true });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerId: '9781427201438', narrators: ['Simon Vance'], durationSeconds: 75840 });
    expect(mockFetchWithThrottle).toHaveBeenCalledTimes(1);
    expect(mockFetchWithThrottle).toHaveBeenCalledWith(
      expect.stringContaining('/audiobook_details/9781427201438'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'user-agent': 'okhttp/4.12.0', 'x-librofm-appver': '7.37.4' }),
      }),
    );
  });

  it('searches by title and author, limits candidates, and enriches each result', async () => {
    mockFetchWithThrottle
      .mockResolvedValueOnce(
        response({
          audiobook_collection: {
            audiobooks: [{ isbn: 1111111111111 }, { isbn: 2222222222222 }, { isbn: 3333333333333 }, { isbn: 4444444444444 }],
          },
        }),
      )
      .mockResolvedValueOnce(response({ data: { audiobook: { isbn: 1111111111111, title: 'First' } } }))
      .mockResolvedValueOnce(response({ data: { audiobook: { isbn: 2222222222222, title: 'Second' } } }));

    const result = await makeProvider().search({
      title: 'Project Hail Mary',
      author: 'Andy Weir',
      isAudiobook: true,
      maxCandidatesPerProvider: 2,
    });

    expect(result.map((candidate) => candidate.title)).toEqual(['First', 'Second']);
    expect(mockFetchWithThrottle).toHaveBeenCalledTimes(3);
    expect(String(mockFetchWithThrottle.mock.calls[0]?.[0])).toContain('q=Project+Hail+Mary+Andy+Weir');
  });

  it('returns null for missing details and rethrows throttling errors', async () => {
    mockFetchWithThrottle.mockResolvedValueOnce(response({}, 404));
    await expect(makeProvider().lookupById('missing')).resolves.toBeNull();

    mockFetchWithThrottle.mockRejectedValueOnce(new ProviderThrottleError(60));
    await expect(makeProvider().lookupById('9781427201438')).rejects.toBeInstanceOf(ProviderThrottleError);
  });
});
