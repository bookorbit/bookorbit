import type { MetadataHttpProviderInfo } from '@bookorbit/types';

import { HttpProviderError, type HttpProviderClient } from '../../../metadata-http-provider/http-provider.client';
import type { ActiveHttpProvider } from '../../../metadata-http-provider/metadata-http-provider.catalog';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { HttpMetadataProvider } from './http-metadata-provider';

const info = (overrides: Partial<MetadataHttpProviderInfo> = {}): MetadataHttpProviderInfo => ({
  key: 'fantlab',
  name: 'FantLab',
  version: '0.1.0',
  specVersion: '1',
  avatarUrl: null,
  authenticationRequired: false,
  mediaTypes: ['book'],
  lookup: true,
  supportedFields: null,
  searchParams: ['query', 'author', 'mediaType', 'isbn', 'limit'],
  idMaxLength: 11,
  bookUrlTemplate: 'https://fantlab.ru/work{id}',
  rateLimit: { maxConcurrency: 2, minIntervalMs: 0 },
  coverShape: null,
  ...overrides,
});

function adapter(providerInfo = info()) {
  const client = { search: vi.fn(), lookup: vi.fn() };
  const provider: ActiveHttpProvider = {
    id: 1,
    key: providerInfo.key,
    label: providerInfo.name,
    enabled: true,
    status: 'ok',
    info: providerInfo,
    authorizationUnreadable: false,
    iconUrl: '/api/v1/metadata-providers/fantlab/icon?v=abc123',
    color: '#8b1e1e',
    target: {
      key: providerInfo.key,
      baseUrl: 'http://fantlab:8080/',
      authorization: null,
      allowPrivateAddress: true,
      timeoutMs: 10_000,
      rateLimit: providerInfo.rateLimit,
    },
  };
  return { client, adapter: new HttpMetadataProvider(provider, client as unknown as HttpProviderClient) };
}

describe('HttpMetadataProvider', () => {
  it('takes its identity and capabilities from the provider info', () => {
    const { adapter: a } = adapter();
    expect(a).toMatchObject({
      key: 'fantlab',
      label: 'FantLab',
      identifiable: true,
      source: 'external',
      mediaKinds: ['ebook'],
      timeoutMs: 10_000,
      iconUrl: '/api/v1/metadata-providers/fantlab/icon?v=abc123',
      color: '#8b1e1e',
    });
    expect(adapter(info({ lookup: false })).adapter.identifiable).toBe(false);
  });

  it('sends only the extension params the provider declared', async () => {
    const { client, adapter: a } = adapter(info({ searchParams: ['query', 'author', 'mediaType'] }));
    client.search.mockResolvedValue({ matches: [] });
    await a.search({ title: 'Солярис', author: 'Лем', isbn: '9785170254767', resultsPerProvider: 5 });
    expect(Object.fromEntries(client.search.mock.calls[0][1])).toEqual({ query: 'Солярис', author: 'Лем', mediaType: 'book' });
  });

  it('coerces records to the types released clients require', async () => {
    const { client, adapter: a } = adapter();
    client.search.mockResolvedValue({
      matches: [
        {
          providerId: 3104,
          title: '  Солярис ',
          author: 'Станислав Лем',
          publishedYear: '1961',
          series: [{ series: 'Дозоры', sequenceNumber: 1 }],
          rating: 4.31,
          ratingCount: 9103,
          cover: 'https://fantlab.ru/images/editions/big/121417',
          isbn13: '9785170254767',
        },
        { title: 'No id' },
        { providerId: 'way-too-long-for-this-provider', title: 'Too long' },
        { providerId: 'x', title: 'Bad cover', cover: 'file:///etc/passwd', rating: 9 },
      ],
    });

    const [first, second, ...rest] = await a.search({ title: 'Солярис' });

    expect(rest).toEqual([]);
    expect(first).toMatchObject({
      provider: 'fantlab',
      providerId: '3104',
      title: 'Солярис',
      authors: ['Станислав Лем'],
      publishedYear: 1961,
      seriesName: 'Дозоры',
      seriesIndex: '1',
      communityRating: 4.31,
      communityRatingCount: 9103,
      coverUrl: 'https://fantlab.ru/images/editions/big/121417',
      sourceUrl: 'https://fantlab.ru/work3104',
    });
    expect(second).toMatchObject({ providerId: 'x', coverUrl: undefined, communityRating: undefined });
  });

  it("files the base spec's single isbn under the length it has", async () => {
    const { client, adapter: a } = adapter();
    client.search.mockResolvedValue({
      matches: [
        { providerId: '1', title: 'Ten', isbn: '0-441-01359-7' },
        { providerId: '2', title: 'Thirteen', isbn: '978-0-441-01359-3' },
        { providerId: '3', title: 'Both', isbn: '0441013597', isbn13: '9780441013593' },
      ],
    });

    const [ten, thirteen, both] = await a.search({ title: 'Dune' });

    expect(ten).toMatchObject({ isbn10: '0441013597', isbn13: undefined });
    expect(thirteen).toMatchObject({ isbn10: undefined, isbn13: '9780441013593' });
    expect(both).toMatchObject({ isbn10: '0441013597', isbn13: '9780441013593' });
  });

  it("tells a record's medium, but only one its provider serves", async () => {
    const { client, adapter: a } = adapter(info({ mediaTypes: ['book', 'comic'] }));
    client.search.mockResolvedValue({
      matches: [
        { providerId: '1', title: 'Novel', mediaType: 'book' },
        { providerId: '2', title: 'Manga', mediaType: 'comic' },
        { providerId: '3', title: 'Claims audio', mediaType: 'audiobook' },
        { providerId: '4', title: 'Says nothing' },
      ],
    });

    const found = await a.search({ title: 'x' });

    expect(found.map((c) => c.mediaKind)).toEqual(['ebook', 'comic', undefined, undefined]);
  });

  it('turns a provider throttle into the cooldown BookOrbit already understands', async () => {
    const { client, adapter: a } = adapter();
    client.search.mockRejectedValue(new HttpProviderError('throttled', 'provider answered 429', 429, 30));
    await expect(a.search({ title: 'x' })).rejects.toBeInstanceOf(ProviderThrottleError);
  });

  it('fails a search whose answer has no matches list rather than reporting nothing found', async () => {
    const { client, adapter: a } = adapter();
    client.search.mockResolvedValue({ results: [] });
    await expect(a.search({ title: 'x' })).rejects.toBeInstanceOf(HttpProviderError);
  });

  it('looks up by id only when the provider declares lookup, and answers null for an unknown id', async () => {
    const { client, adapter: a } = adapter();
    client.lookup.mockResolvedValue(null);
    await expect(a.lookupById('3104')).resolves.toBeNull();
    expect(client.lookup).toHaveBeenCalledWith(expect.anything(), '3104', undefined);

    const searchOnly = adapter(info({ lookup: false }));
    await expect(searchOnly.adapter.lookupById('3104')).resolves.toBeNull();
    expect(searchOnly.client.lookup).not.toHaveBeenCalled();
  });

  it('keys the cache on exactly what it sends and on the provider version', () => {
    const { adapter: a } = adapter();
    expect(a.cache.describeSearch({ title: 'Dune', author: 'Herbert', isbn: '1', seriesName: 'ignored' })).toEqual({
      inputs: { query: 'Dune', author: 'Herbert', isbn: '1', mediaType: 'book' },
    });
    expect(adapter(info({ version: '0.2.0' })).adapter.cache.version).not.toBe(a.cache.version);
    expect(a.cache.trustEmpty).toBe(false);
  });

  it('expires cached answers when info the mapping reads changes, even without a version bump', () => {
    const { adapter: a } = adapter();
    for (const changed of [
      info({ bookUrlTemplate: 'https://fantlab.ru/edition{id}' }),
      info({ idMaxLength: 20 }),
      info({ coverShape: 'portrait' }),
      info({ version: null }),
    ]) {
      expect(adapter(changed).adapter.cache.version).not.toBe(a.cache.version);
    }
    expect(adapter(info({ name: 'FantLab.ru' })).adapter.cache.version).toBe(a.cache.version);
  });
});
