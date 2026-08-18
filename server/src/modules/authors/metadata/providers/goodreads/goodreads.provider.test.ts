import { AuthorMetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../../metadata-preferences/provider-config.service';
import { AuthorMetadataProviderError } from '../author-metadata-provider';
import { GoodreadsAuthorMetadataProvider } from './goodreads.provider';

function configService(enabled: boolean): ProviderConfigService {
  return { getConfig: vi.fn().mockResolvedValue({ goodreads: { enabled } }) } as unknown as ProviderConfigService;
}

function textResponse(body: string, init?: { ok?: boolean; status?: number; retryAfter?: string }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    text: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue(init?.retryAfter ?? null) },
  };
}

const AUTHOR_PAGE = `
  <div class="authorLeftContainer"><img itemprop="image" src="https://images.gr-assets.com/authors/1/874602.jpg" /></div>
  <h1 class="authorName"><span itemprop="name">Ursula K. Le Guin</span></h1>
  <div class="aboutAuthorInfo"><span>short</span><span>The complete biography</span></div>
  <div class="dataTitle">Born</div><div class="dataItem">October 21, 1929</div>
`;

describe('GoodreadsAuthorMetadataProvider', () => {
  let provider: GoodreadsAuthorMetadataProvider;

  beforeEach(() => {
    provider = new GoodreadsAuthorMetadataProvider(configService(true));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves author ids from the autocomplete endpoint without loading a page', async () => {
    global.fetch = vi.fn().mockResolvedValue(textResponse(JSON.stringify([{ author: { id: 874602, name: 'Ursula K. Le Guin' } }])));

    const results = await provider.search({ name: 'Ursula K. Le Guin' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/book/auto_complete'), expect.any(Object));
    expect(results).toEqual([
      {
        provider: AuthorMetadataProviderKey.GOODREADS,
        providerId: '874602',
        name: 'Ursula K. Le Guin',
        sourceUrl: 'https://www.goodreads.com/author/show/874602',
      },
    ]);
  });

  it('falls back to the search page when autocomplete yields no author', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(textResponse('[]'))
      .mockResolvedValueOnce(textResponse('<a href="/author/show/666524.Donna_J_Haraway">Donna J. Haraway</a>'));

    const results = await provider.search({ name: 'Donna Haraway' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('search%5Bfield%5D=author'), expect.any(Object));
    expect(results).toEqual([
      {
        provider: AuthorMetadataProviderKey.GOODREADS,
        providerId: '666524',
        name: 'Donna J Haraway',
        sourceUrl: 'https://www.goodreads.com/author/show/666524',
      },
    ]);
  });

  it('lookupById scrapes the author page into a full candidate', async () => {
    global.fetch = vi.fn().mockResolvedValue(textResponse(AUTHOR_PAGE));

    const candidate = await provider.lookupById('874602');

    expect(global.fetch).toHaveBeenCalledWith('https://www.goodreads.com/author/show/874602', expect.any(Object));
    expect(candidate).toMatchObject({
      provider: AuthorMetadataProviderKey.GOODREADS,
      providerId: '874602',
      name: 'Ursula K. Le Guin',
      description: 'The complete biography',
      birthDate: '1929-10-21',
      sourceUrl: 'https://www.goodreads.com/author/show/874602',
    });
  });

  it('returns null when the author page cannot be parsed', async () => {
    global.fetch = vi.fn().mockResolvedValue(textResponse('<html>challenge</html>'));

    expect(await provider.lookupById('874602')).toBeNull();
  });

  it('surfaces a rate limit as a transient error carrying retryAfterMs', async () => {
    global.fetch = vi.fn().mockResolvedValue(textResponse('', { ok: false, status: 429, retryAfter: '30' }));

    await expect(provider.lookupById('874602')).rejects.toMatchObject({
      httpStatus: 429,
      retryAfterMs: 30_000,
      transient: true,
    });
    await expect(provider.lookupById('874602')).rejects.toBeInstanceOf(AuthorMetadataProviderError);
  });

  it('does no network work while the provider is disabled', async () => {
    const disabled = new GoodreadsAuthorMetadataProvider(configService(false));
    global.fetch = vi.fn();

    expect(await disabled.search({ name: 'Ursula K. Le Guin' })).toEqual([]);
    expect(await disabled.lookupById('874602')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores a blank name without calling out', async () => {
    global.fetch = vi.fn();

    expect(await provider.search({ name: '   ' })).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
