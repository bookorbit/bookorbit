import { AuthorMetadataProviderKey } from '@bookorbit/types';

import { ProviderCallRecord, runWithProviderCallRecord } from '../../../../../common/provider-cache/provider-call-context';
import { AudnexusAuthorMetadataProvider } from './audnexus.provider';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: vi.fn().mockReturnValue(null) },
    json: vi.fn().mockResolvedValue(body),
  };
}

/** Mirrors the cache's verdict on a live call record, minus the trustEmpty and TTL settings. */
function isCleanRecord(record: ProviderCallRecord): boolean {
  return (
    record.mainRequests > 0 &&
    record.unsuccessfulRequests().length === 0 &&
    record.failureReasons.length === 0 &&
    record.degradationReasons.length === 0 &&
    !record.truncated
  );
}

async function settle<T>(run: () => Promise<T>): Promise<{ record: ProviderCallRecord; value?: T; error?: unknown }> {
  const record = new ProviderCallRecord();
  try {
    return { record, value: await runWithProviderCallRecord(record, run) };
  } catch (error) {
    return { record, error };
  }
}

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

  it('passes the caller deadline into the request', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([]));

    await provider.search({ name: 'Any', signal: controller.signal });
    const signal = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('sends the canonical region', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([]));

    await provider.search({ name: 'Any', region: ' UK ' });

    expect(global.fetch).toHaveBeenCalledWith('https://api.audnex.us/authors?name=Any&region=uk', expect.any(Object));
  });

  // Empty answers are only cached for a provider whose every failure mode leaves the call record
  // uncacheable. These five cases are that proof for Audnexus; `trustEmpty` depends on them.
  describe('empty-answer trust suite', () => {
    type Operation = (p: AudnexusAuthorMetadataProvider) => Promise<unknown>;
    describe.each<[string, Operation]>([
      ['search', (p) => p.search({ name: 'Jane Doe', region: 'us' })],
      ['lookup', (p) => p.lookupById('B1', 'us')],
    ])('%s', (_operation, call) => {
      it('1. transport failure leaves the record uncacheable', async () => {
        global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

        const { record, error } = await settle(() => call(provider));

        expect(error).toMatchObject({ name: 'AuthorMetadataProviderError', transient: true });
        expect(record.unsuccessfulRequests()).toEqual([{ kind: 'error', errorClass: 'TypeError' }]);
        expect(isCleanRecord(record)).toBe(false);
      });

      it('2. a 200 with malformed JSON leaves the record uncacheable', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: { get: vi.fn() },
          json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
        });

        const { record, error } = await settle(() => call(provider));

        expect(error).toMatchObject({ name: 'AuthorMetadataProviderError' });
        expect(record.failureReasons).toContain('audnexus_malformed_json');
        expect(isCleanRecord(record)).toBe(false);
      });

      it('3. an API error body inside a 200 leaves the record uncacheable', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ statusCode: 500, error: 'Internal Server Error', message: 'upstream unavailable' }));

        const { record, value } = await settle(() => call(provider));

        expect(value === null || (Array.isArray(value) && value.length === 0)).toBe(true);
        expect(record.failureReasons.length).toBeGreaterThan(0);
        expect(isCleanRecord(record)).toBe(false);
      });

      it('4. a mapper exception leaves the record uncacheable', async () => {
        const row = { asin: 42, name: 'Jane Doe' };
        global.fetch = vi.fn().mockResolvedValue(jsonResponse(_operation === 'search' ? [row] : row));

        const { record, error } = await settle(() => call(provider));

        expect(error).toBeInstanceOf(TypeError);
        expect(record.failureReasons).toContain('audnexus_mapper_error');
        expect(isCleanRecord(record)).toBe(false);
      });
    });

    it('4. a partially unmappable search answer leaves the record uncacheable', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse([{ asin: 'A1', name: 'Jane Doe' }, { name: 'No Asin' }]));

      const { record, value } = await settle(() => provider.search({ name: 'Jane Doe' }));

      expect(value).toEqual([expect.objectContaining({ providerId: 'A1' })]);
      expect(record.degradationReasons).toContain('audnexus_unmapped_row');
      expect(isCleanRecord(record)).toBe(false);
    });

    it('5. a genuine empty answer leaves a clean record', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse([]));

      const { record, value } = await settle(() => provider.search({ name: 'Nobody Anyone' }));

      expect(value).toEqual([]);
      expect(record.mainRequests).toBe(1);
      expect(isCleanRecord(record)).toBe(true);
    });

    it('a non-ok status leaves the record uncacheable', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ message: 'not found' }, 404));

      const { record } = await settle(() => provider.lookupById('B404'));

      expect(record.unsuccessfulRequests()).toEqual([{ kind: 'status', status: 404 }]);
    });
  });

  describe('cache declaration', () => {
    it('trusts empty answers', () => {
      expect(provider.cache.version).toBe(1);
      expect(provider.cache.trustEmpty).toBe(true);
    });

    it('is always available with an empty fingerprint', async () => {
      await expect(provider.cache.context()).resolves.toEqual({ available: true, fingerprint: '{}' });
    });

    it('keys a search by canonical name, canonical region and the result cap it honours', () => {
      expect(provider.cache.describeSearch({ name: ' Jane   Doe ' })).toEqual({ inputs: { name: 'Jane Doe', region: 'us' }, maxCandidates: 10 });
      expect(provider.cache.describeSearch({ name: 'Jane Doe', region: ' CA ', limit: 30 })).toEqual({
        inputs: { name: 'Jane Doe', region: 'ca' },
        maxCandidates: 25,
      });
      expect(provider.cache.describeSearch({ name: 'Jane Doe', region: 'us' })).toEqual(provider.cache.describeSearch({ name: 'Jane Doe' }));
      expect(provider.cache.describeSearch({ name: '' })).toBeNull();
    });

    it('ignores inputs that do not change the request', () => {
      expect(provider.cache.describeSearch({ name: 'Jane Doe', limit: 4, signal: new AbortController().signal })).toEqual(
        provider.cache.describeSearch({ name: 'Jane Doe', limit: 4 }),
      );
      expect(provider.cache.describeLookup('B1', { name: 'Someone Else', region: 'ca', limit: 3 })).toEqual(
        provider.cache.describeLookup('B1', { name: '', region: 'CA' }),
      );
    });

    it('keys a lookup by id and canonical region', () => {
      expect(provider.cache.describeLookup(' B1 ')).toEqual({ inputs: { id: 'B1', region: 'us' } });
      expect(provider.cache.describeLookup('B1', { name: '', region: 'DE' })).toEqual({ inputs: { id: 'B1', region: 'de' } });
      expect(provider.cache.describeLookup(' ')).toBeNull();
    });

    it('honours the result cap it declares', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        jsonResponse([
          { asin: 'A1', name: 'One' },
          { asin: 'A2', name: 'Two' },
          { asin: 'A3', name: 'Three' },
        ]),
      );

      await expect(provider.search({ name: 'Author', limit: 2 })).resolves.toHaveLength(2);
    });
  });
});
