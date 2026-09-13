import { DEFAULT_INDEXER_CATEGORIES } from '@bookorbit/types';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

import { forgetDispatchers } from '../../../../common/utils/safe-fetch';
import { IndexerSearchException, type ReleaseQuery, type ResolvedIndexerConfig } from '../indexer-adapter';
import { NewznabAdapter, newznabClientKey } from './newznab.adapter';

const NZB = Buffer.from('<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file /></nzb>');

function config(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
  return {
    id: 7,
    name: 'usenet indexer',
    adapterType: 'newznab',
    baseUrl: 'https://indexer.example.com',
    credential: 'secret-key',
    credentialError: null,
    allowPrivateAddress: false,
    applyTrackerSeedGoals: true,
    seedRatioGoal: null,
    seedTimeMinutes: null,
    categories: DEFAULT_INDEXER_CATEGORIES.newznab,
    disabledMediaKinds: [],
    isbnSearchDisabled: false,
    settings: null,
    networkProfile: null,
    ...overrides,
  };
}

function query(overrides: Partial<ReleaseQuery> = {}): ReleaseQuery {
  return {
    title: 'Dune',
    author: 'Frank Herbert',
    isbn13: '9780441013593',
    isbn13s: ['9780441013593'],
    mediaKind: 'ebook',
    language: null,
    limit: 50,
    ...overrides,
  };
}

function feed(items: string): string {
  return `<?xml version="1.0"?><rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel>${items}</channel></rss>`;
}

const ITEM = `<item>
  <title>Dune - Frank Herbert EPUB</title>
  <guid isPermaLink="false">release-guid</guid>
  <link>https://indexer.example.com/api?t=get&amp;id=release-guid&amp;apikey=secret-key</link>
  <pubDate>Tue, 01 Apr 2025 10:00:00 +0000</pubDate>
  <newznab:attr name="size" value="1048576" />
  <newznab:attr name="files" value="2" />
  <newznab:attr name="author" value="Frank Herbert" />
  <newznab:attr name="booktitle" value="Dune" />
  <newznab:attr name="isbn" value="9780441013593" />
  <newznab:attr name="format" value="EPUB" />
</item>`;

describe('NewznabAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  it('searches by ISBN with the configured category and API key', async () => {
    fetchMock.mockResolvedValue(new Response(feed(ITEM)));

    const releases = await new NewznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    const url = new URL(fetchMock.mock.calls[0]![0].toString());
    expect(url.pathname).toBe('/api');
    expect(url.searchParams.get('t')).toBe('search');
    expect(url.searchParams.get('q')).toBe('9780441013593');
    expect(url.searchParams.get('cat')).toBe('7020');
    expect(url.searchParams.get('apikey')).toBe('secret-key');
    expect(releases[0]).toMatchObject({
      guid: 'release-guid',
      title: 'Dune - Frank Herbert EPUB',
      sizeBytes: 1048576,
      fileCount: 2,
      author: 'Frank Herbert',
      bookTitle: 'Dune',
      isbn: '9780441013593',
      format: 'EPUB',
      seeders: null,
    });
  });

  it('falls back to title and author for a search without an ISBN', async () => {
    fetchMock.mockResolvedValue(new Response(feed('')));

    await new NewznabAdapter().search(query({ isbn13: null, isbn13s: [] }), config(), AbortSignal.timeout(1000));

    expect(new URL(fetchMock.mock.calls[0]![0].toString()).searchParams.get('q')).toBe('Dune Frank Herbert');
  });

  it('does not expose a credentialed download URL as the release identifier', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        feed(`<item>
          <title>Dune EPUB</title>
          <enclosure url="https://indexer.example.com/api?t=get&amp;id=release-guid&amp;apikey=secret-key" length="1048576" />
        </item>`),
      ),
    );

    const [release] = await new NewznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    expect(release?.guid).toMatch(/^[a-f0-9]{64}$/);
    expect(release?.guid).not.toContain('secret-key');
  });

  it('turns a Newznab credential error document into an unauthorized failure', async () => {
    fetchMock.mockResolvedValue(new Response('<error code="100" description="Incorrect user credentials" />'));

    await expect(new NewznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({
      failure: 'unauthorized',
    });
  });

  it('classifies HTTP throttling separately from an indexer error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));

    await expect(new NewznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({
      failure: 'throttled',
    });
  });

  it('follows search redirects manually without carrying the original API query onto the target', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/newznab-feed' } }))
      .mockResolvedValueOnce(new Response(feed(ITEM)));

    await new NewznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    const redirected = new URL(fetchMock.mock.calls[1]![0].toString());
    expect(redirected.pathname).toBe('/newznab-feed');
    expect(redirected.search).toBe('');
  });

  it('bounds search responses before parsing them', async () => {
    fetchMock.mockResolvedValue(new Response('<rss />', { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } }));

    await expect(new NewznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({
      failure: 'error',
      message: expect.stringContaining('more XML'),
    });
  });

  it('tests the capabilities endpoint', async () => {
    fetchMock.mockResolvedValue(new Response('<caps><server title="Example Indexer" /></caps>'));

    await expect(new NewznabAdapter().test(config())).resolves.toEqual({ success: true, indexerName: 'Example Indexer' });
    expect(new URL(fetchMock.mock.calls[0]![0].toString()).searchParams.get('t')).toBe('caps');
  });

  it('fetches and validates the credentialed NZB', async () => {
    fetchMock.mockResolvedValue(new Response(NZB));

    await expect(
      new NewznabAdapter().fetchNzbFile(
        {
          indexerId: 7,
          guid: 'release-guid',
          title: 'Dune',
          downloadUrl: 'https://indexer.example.com/get/1',
          sizeBytes: null,
          seeders: null,
          leechers: null,
        },
        config(),
      ),
    ).resolves.toEqual(NZB);
  });

  it('follows a relative NZB redirect and validates the final document', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/download/final.nzb' } }))
      .mockResolvedValueOnce(new Response(NZB));

    await expect(
      new NewznabAdapter().fetchNzbFile(
        {
          indexerId: 7,
          guid: 'release-guid',
          title: 'Dune',
          downloadUrl: 'https://indexer.example.com/get/1',
          sizeBytes: null,
          seeders: null,
          leechers: null,
        },
        config(),
      ),
    ).resolves.toEqual(NZB);
    expect(new URL(fetchMock.mock.calls[1]![0].toString()).pathname).toBe('/download/final.nzb');
  });

  it('rejects empty and oversized NZB responses', async () => {
    const release = {
      indexerId: 7,
      guid: 'release-guid',
      title: 'Dune',
      downloadUrl: 'https://indexer.example.com/get/1',
      sizeBytes: null,
      seeders: null,
      leechers: null,
    };
    fetchMock.mockResolvedValueOnce(new Response(''));
    await expect(new NewznabAdapter().fetchNzbFile(release, config())).rejects.toMatchObject({ message: expect.stringContaining('empty NZB') });

    fetchMock.mockResolvedValueOnce(new Response(NZB, { headers: { 'content-length': String(32 * 1024 * 1024 + 1) } }));
    await expect(new NewznabAdapter().fetchNzbFile(release, config())).rejects.toMatchObject({ message: expect.stringContaining('too large') });
  });

  it('rejects a download response that is not an NZB document', async () => {
    fetchMock.mockResolvedValue(new Response('<html>login</html>'));

    await expect(
      new NewznabAdapter().fetchNzbFile(
        {
          indexerId: 7,
          guid: 'release-guid',
          title: 'Dune',
          downloadUrl: 'https://indexer.example.com/get/1',
          sizeBytes: null,
          seeders: null,
          leechers: null,
        },
        config(),
      ),
    ).rejects.toBeInstanceOf(IndexerSearchException);
  });

  it('classifies an NZB fetch timeout for automation retry', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    await expect(
      new NewznabAdapter().fetchNzbFile(
        {
          indexerId: 7,
          guid: 'release-guid',
          title: 'Dune',
          downloadUrl: 'https://indexer.example.com/get/1',
          sizeBytes: null,
          seeders: null,
          leechers: null,
        },
        config(),
      ),
    ).rejects.toMatchObject({ failure: 'timeout' });
  });

  it('derives a stable source-scoped client key', () => {
    expect(newznabClientKey(7, 'release-guid')).toHaveLength(64);
    expect(newznabClientKey(7, 'release-guid')).toBe(newznabClientKey(7, 'release-guid'));
    expect(newznabClientKey(8, 'release-guid')).not.toBe(newznabClientKey(7, 'release-guid'));
  });
});
