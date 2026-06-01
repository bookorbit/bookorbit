import { Test, TestingModule } from '@nestjs/testing';
import { MetadataProviderKey, ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { AudnexusProvider } from './audnexus.provider';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as Response;
}

describe('AudnexusProvider', () => {
  let provider: AudnexusProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true, coverResolution: 'high' },
    audible: { enabled: false, domain: 'audible.com' },
    audnexus: { enabled: true },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudnexusProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<AudnexusProvider>(AudnexusProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty results when disabled', async () => {
    vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
      ...mockConfig,
      audnexus: { enabled: false },
    });

    const result = await provider.search({ title: 'Artificial Condition', isAudiobook: true });
    expect(result).toEqual([]);
  });

  it('returns empty results when the request is not audiobook-scoped', async () => {
    const result = await provider.search({ title: 'Artificial Condition', isAudiobook: false });
    expect(result).toEqual([]);
  });

  it('uses stored audible ids directly without hitting Audible search', async () => {
    global.fetch = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url === 'https://api.audnex.us/books/B0TEST12345') {
        return Promise.resolve(jsonResponse({ asin: 'B0TEST12345', name: 'Artificial Condition' }));
      }
      if (url === 'https://api.audnex.us/books/B0TEST12345/chapters') {
        return Promise.resolve(jsonResponse({ asin: 'B0TEST12345', chapters: [] }));
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const result = await provider.search({
      title: 'Artificial Condition',
      isAudiobook: true,
      existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0TEST12345' },
    });

    expect(result).toHaveLength(1);
    expect(result[0].providerId).toBe('B0TEST12345');
    expect(result[0].audibleId).toBe('B0TEST12345');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('api.audible.com'), expect.anything());
  });

  it('resolves an ASIN from Audible when no stored audible id exists', async () => {
    global.fetch = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.startsWith('https://api.audible.com/1.0/catalog/products')) {
        return Promise.resolve(jsonResponse({ products: [{ asin: 'B0RESOLVED01' }] }));
      }
      if (url === 'https://api.audnex.us/books/B0RESOLVED01') {
        return Promise.resolve(jsonResponse({ asin: 'B0RESOLVED01', name: 'Artificial Condition' }));
      }
      if (url === 'https://api.audnex.us/books/B0RESOLVED01/chapters') {
        return Promise.resolve(jsonResponse({ asin: 'B0RESOLVED01', chapters: [] }));
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const result = await provider.search({
      title: 'Artificial Condition',
      author: 'Martha Wells',
      isAudiobook: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].providerId).toBe('B0RESOLVED01');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://api.audible.com/1.0/catalog/products'), expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('keywords=Artificial+Condition+Martha+Wells'), expect.any(Object));
  });

  it('returns empty results when title/author cannot produce an Audible query', async () => {
    global.fetch = vi.fn();

    const result = await provider.search({
      title: '   ',
      author: '   ',
      isAudiobook: true,
    });

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns empty results for non-ok Audible or AudNexus book responses', async () => {
    global.fetch = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ products: [] }, 503)))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ products: [{ asin: 'B0BROKEN001' }] })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({}, 404)))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({}, 200)));

    const resolveFailure = await provider.search({
      title: 'Failure One',
      isAudiobook: true,
    });
    const lookupFailure = await provider.search({
      title: 'Failure Two',
      isAudiobook: true,
    });

    expect(resolveFailure).toEqual([]);
    expect(lookupFailure).toEqual([]);
  });

  it('returns metadata even when chapters lookup fails, and propagates throttle errors', async () => {
    global.fetch = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ products: [{ asin: 'B0CHAPTERS01' }] })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ asin: 'B0CHAPTERS01', name: 'Book without chapters' })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({}, 500)))
      .mockImplementationOnce(() => Promise.reject(new ProviderThrottleError(30)));

    const result = await provider.search({
      title: 'Book without chapters',
      isAudiobook: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].providerId).toBe('B0CHAPTERS01');

    await expect(
      provider.search({
        title: 'Throttle me',
        isAudiobook: true,
      }),
    ).rejects.toThrow(ProviderThrottleError);
  });

  it('returns empty results when Audible ASIN resolution throws a non-throttle error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('audible unavailable'));

    const result = await provider.search({
      title: 'Transient Audible failure',
      isAudiobook: true,
    });

    expect(result).toEqual([]);
  });

  it('returns empty results when internal AudNexus lookup throws an unexpected error', async () => {
    const fetchByAsinSpy = vi.spyOn(provider as any, 'fetchByAsin').mockRejectedValue(new Error('unexpected lookup crash'));

    const result = await provider.search({
      title: 'Use stored ASIN',
      isAudiobook: true,
      existingProviderIds: {
        [MetadataProviderKey.AUDIBLE]: 'B0INTERNAL01',
      },
    });

    expect(result).toEqual([]);
    expect(fetchByAsinSpy).toHaveBeenCalledWith('B0INTERNAL01', undefined);
  });
});
