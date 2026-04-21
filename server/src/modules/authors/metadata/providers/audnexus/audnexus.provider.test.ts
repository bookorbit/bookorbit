import { AuthorMetadataProviderKey } from '@bookorbit/types';

import { AudnexusAuthorMetadataProvider } from './audnexus.provider';

describe('AudnexusAuthorMetadataProvider', () => {
  let provider: AudnexusAuthorMetadataProvider;

  beforeEach(() => {
    provider = new AudnexusAuthorMetadataProvider();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('search maps and deduplicates candidates by ASIN', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        { asin: 'A1', name: 'Author One', description: ' Bio ', image: 'https://img/one.jpg' },
        { asin: 'A1', name: 'Author One Duplicate', description: 'Ignored duplicate' },
        { asin: 'A2', name: 'Author Two' },
      ]),
    });

    const results = await provider.search({ name: 'Author', region: 'us', limit: 10 });

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://api.audnex.us/authors?name=Author&region=us'), expect.any(Object));
    expect(results).toEqual([
      {
        provider: AuthorMetadataProviderKey.AUDNEXUS,
        providerId: 'A1',
        name: 'Author One',
        description: 'Bio',
        imageUrl: 'https://img/one.jpg',
        sourceUrl: 'https://www.audible.com/author/A1',
      },
      {
        provider: AuthorMetadataProviderKey.AUDNEXUS,
        providerId: 'A2',
        name: 'Author Two',
        description: undefined,
        imageUrl: undefined,
        sourceUrl: 'https://www.audible.com/author/A2',
      },
    ]);
  });

  it('lookupById maps a single author detail result', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        asin: 'B123',
        name: 'Detail Author',
        description: 'Detail text',
        image: 'https://img/detail.jpg',
      }),
    });

    const result = await provider.lookupById('B123', 'ca');

    expect(global.fetch).toHaveBeenCalledWith('https://api.audnex.us/authors/B123?region=ca', expect.any(Object));
    expect(result).toEqual({
      provider: AuthorMetadataProviderKey.AUDNEXUS,
      providerId: 'B123',
      name: 'Detail Author',
      description: 'Detail text',
      imageUrl: 'https://img/detail.jpg',
      sourceUrl: 'https://www.audible.com/author/B123',
    });
  });

  it('throws when upstream fails so callers can apply retry policy', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: vi.fn((name: string) => (name === 'retry-after' ? '15' : null)),
      },
    });

    await expect(provider.search({ name: 'Any' })).rejects.toMatchObject({
      name: 'AuthorMetadataProviderError',
      httpStatus: 429,
      retryAfterMs: 15_000,
      transient: true,
    });
    await expect(provider.lookupById('A1')).rejects.toMatchObject({
      name: 'AuthorMetadataProviderError',
      httpStatus: 429,
      retryAfterMs: 15_000,
      transient: true,
    });
  });
});
