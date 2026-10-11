import { AuthorMetadataProviderKey } from '@bookorbit/types';

import { ProviderCallRecord, runWithProviderCallRecord } from '../../../../../common/provider-cache/provider-call-context';
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

  it('passes the caller deadline into every request', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn().mockResolvedValue(textResponse(AUTHOR_PAGE));

    await provider.lookupById('874602', undefined, controller.signal);
    const signal = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  describe('cache hardening markers', () => {
    async function recorded<T>(run: () => Promise<T>): Promise<{ value: T; record: ProviderCallRecord }> {
      const record = new ProviderCallRecord();
      const value = await runWithProviderCallRecord(record, run);
      return { value, record };
    }

    beforeEach(() => {
      vi.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);
    });

    it('leaves a clean record for a well-formed autocomplete answer', async () => {
      global.fetch = vi.fn().mockResolvedValue(textResponse(JSON.stringify([{ author: { id: 1, name: 'Jane Doe' } }])));

      const { record } = await recorded(() => provider.search({ name: 'Jane Doe' }));

      expect(record.mainRequests).toBe(1);
      expect(record.unsuccessfulRequests()).toEqual([]);
      expect(record.failureReasons).toEqual([]);
      expect(record.degradationReasons).toEqual([]);
    });

    it('marks malformed autocomplete JSON as failed and still falls back to the search page', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(textResponse('<html>not json</html>'))
        .mockResolvedValueOnce(textResponse('<a href="/author/show/1.Jane_Doe">Jane Doe</a>'));

      const { value, record } = await recorded(() => provider.search({ name: 'Jane Doe' }));

      expect(value).toEqual([expect.objectContaining({ providerId: '1' })]);
      expect(record.failureReasons).toContain('goodreads_malformed_autocomplete');
    });

    it('marks a non-array autocomplete answer as failed', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(textResponse('{"error":"oops"}')).mockResolvedValueOnce(textResponse(''));

      const { record } = await recorded(() => provider.search({ name: 'Jane Doe' }));

      expect(record.failureReasons).toContain('goodreads_malformed_autocomplete');
    });

    it('marks a challenge page served with a 2xx status as degraded', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(textResponse('[]'))
        .mockResolvedValueOnce(textResponse('<script>window.awsWafCookieDomainList = []</script>', { status: 202 }));

      const { value, record } = await recorded(() => provider.search({ name: 'Jane Doe' }));

      expect(value).toEqual([]);
      expect(record.degradationReasons).toContain('goodreads_challenge_page');
    });

    it('marks an unparseable author page as degraded', async () => {
      global.fetch = vi.fn().mockResolvedValue(textResponse('<html>something else</html>'));

      const { value, record } = await recorded(() => provider.lookupById('874602'));

      expect(value).toBeNull();
      expect(record.degradationReasons).toContain('goodreads_unparseable_author_page');
    });

    it('records a failed status as an unsuccessful request', async () => {
      global.fetch = vi.fn().mockResolvedValue(textResponse('', { ok: false, status: 503 }));

      const record = new ProviderCallRecord();
      await expect(runWithProviderCallRecord(record, () => provider.lookupById('874602'))).rejects.toBeInstanceOf(AuthorMetadataProviderError);

      expect(record.unsuccessfulRequests()).toEqual([{ kind: 'status', status: 503 }]);
    });
  });

  describe('cache declaration', () => {
    it('never keeps empty answers', () => {
      expect(provider.cache.version).toBe(1);
      expect(provider.cache.trustEmpty).toBe(false);
    });

    it('is available only while the provider is enabled', async () => {
      await expect(provider.cache.context()).resolves.toEqual({ available: true, fingerprint: '{}' });
      await expect(new GoodreadsAuthorMetadataProvider(configService(false)).cache.context()).resolves.toEqual({
        available: false,
        fingerprint: '{}',
      });
    });

    it('keys a search by the canonical name and the result cap it honours', () => {
      expect(provider.cache.describeSearch({ name: '  Ursula  K. Le Guin ' })).toEqual({ inputs: { name: 'Ursula K. Le Guin' }, maxCandidates: 10 });
      expect(provider.cache.describeSearch({ name: 'Ursula K. Le Guin', limit: 3 })).toEqual({
        inputs: { name: 'Ursula K. Le Guin' },
        maxCandidates: 3,
      });
      expect(provider.cache.describeSearch({ name: 'Ursula K. Le Guin', limit: 400 })).toEqual({
        inputs: { name: 'Ursula K. Le Guin' },
        maxCandidates: 25,
      });
      expect(provider.cache.describeSearch({ name: '   ' })).toBeNull();
    });

    it('ignores inputs that do not change the request', () => {
      const base = provider.cache.describeSearch({ name: 'Jane Doe', limit: 5 });

      expect(provider.cache.describeSearch({ name: 'Jane Doe', limit: 5, region: 'uk', signal: new AbortController().signal })).toEqual(base);
      expect(provider.cache.describeLookup('874602', { name: 'x', region: 'ca' })).toEqual(provider.cache.describeLookup(' 874602 '));
    });

    it('keys a lookup by the provider id', () => {
      expect(provider.cache.describeLookup(' 874602 ')).toEqual({ inputs: { id: '874602' } });
      expect(provider.cache.describeLookup('  ')).toBeNull();
    });

    it('honours the result cap it declares', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          textResponse(
            JSON.stringify([{ author: { id: 1, name: 'One' } }, { author: { id: 2, name: 'Two' } }, { author: { id: 3, name: 'Three' } }]),
          ),
        );

      await expect(provider.search({ name: 'Author', limit: 2 })).resolves.toHaveLength(2);
    });
  });
});
