import { DEFAULT_INDEXER_CATEGORIES } from '@bookorbit/types';

/**
 * Grabbing a .torrent pins the connection to the address that passed policy, and that path goes
 * through undici's fetch rather than the global one. The adapter is what is under test, so undici
 * is pointed back at the stub each test installs; what the dispatcher does is proven in
 * `safe-fetch.test.ts`.
 */
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

/** Every name in these tests is a stand-in, so one public answer stands for all of them. */
vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

import { ProxyAgent } from 'undici';

import { forgetDispatchers } from '../../../../common/utils/safe-fetch';
import { IndexerSearchException, type ReleaseQuery, type ResolvedIndexerConfig } from '../indexer-adapter';
import { TorznabAdapter } from './torznab.adapter';

const RELEASE = {
  indexerId: 7,
  guid: 'g',
  title: 'Dune',
  downloadUrl: 'https://tracker.example.com/download/1.torrent?key=abc',
  sizeBytes: null,
  seeders: null,
  leechers: null,
};

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** A body that never ends, and counts how much of it the adapter actually pulled. */
function endlessStream(chunkBytes: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulls = 0;
  // No read-ahead, so the count is what the reader asked for rather than what the queue primed.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(chunkBytes));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => pulls };
}

function config(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
  return {
    id: 7,
    name: 'jackett',
    adapterType: 'torznab',
    // A Jackett on the LAN, which is the deployment the private-address opt-in exists for.
    baseUrl: 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab',
    credential: 'secret-key',
    allowPrivateAddress: true,
    categories: DEFAULT_INDEXER_CATEGORIES.torznab,
    settings: null,
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
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items}</channel></rss>`;
}

const ITEM = `
  <item>
    <title>Dune - Frank Herbert (retail) [EPUB]</title>
    <guid>https://tracker.example.com/details/1</guid>
    <link>https://tracker.example.com/download/1.torrent?key=abc</link>
    <pubDate>Tue, 01 Apr 2025 10:00:00 +0000</pubDate>
    <enclosure url="https://tracker.example.com/download/1.torrent?key=abc" length="1048576" type="application/x-bittorrent" />
    <torznab:attr name="seeders" value="42" />
    <torznab:attr name="peers" value="50" />
    <torznab:attr name="size" value="1048576" />
    <torznab:attr name="infohash" value="C9E15763F722F23E98A29DECDFAE341B98D53056" />
    <torznab:attr name="downloadvolumefactor" value="0" />
  </item>`;

describe('TorznabAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  function lastUrl(): URL {
    return new URL(fetchMock.mock.calls.at(-1)![0].toString());
  }

  it('searches under the base URL path rather than replacing it', async () => {
    fetchMock.mockResolvedValue(new Response(feed(ITEM)));

    await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    const url = lastUrl();
    expect(url.pathname).toBe('/api/v2.0/indexers/all/results/torznab/api');
    expect(url.searchParams.get('t')).toBe('search');
    expect(url.searchParams.get('apikey')).toBe('secret-key');
    expect(url.searchParams.get('cat')).toBe('7020');
    // The ISBN is not in the query text: trackers do not index it, and it is a scoring signal.
    expect(url.searchParams.get('q')).toBe('Dune Frank Herbert');
  });

  /** Some proxies hand the operator a base with the key already in it. */
  it('keeps query parameters the base URL carries, without letting them shadow ours', async () => {
    fetchMock.mockResolvedValue(new Response(feed(ITEM)));

    await new TorznabAdapter().search(
      query(),
      config({ baseUrl: 'http://127.0.0.1:9117/api?apikey=from-base&passkey=abc' }),
      AbortSignal.timeout(1000),
    );

    const url = lastUrl();
    expect(url.searchParams.get('passkey')).toBe('abc');
    expect(url.searchParams.getAll('apikey')).toEqual(['secret-key']);
  });

  /** A feed nobody vets must not decide how much CPU a search costs. */
  it('stops reading a feed past the item ceiling, and drops an item with an absurd title', async () => {
    const oversized = ITEM.replace('Dune - Frank Herbert (retail) [EPUB]', 'x'.repeat(5000));
    fetchMock.mockResolvedValue(new Response(feed(oversized + ITEM.repeat(600))));

    const releases = await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    // 500 items read, of which the first is the one with the 5000-character title.
    expect(releases.length).toBe(499);
    expect(releases.every((release) => release.title.length < 5000)).toBe(true);
  });

  it('does not append a second /api when the base URL already ends in one', async () => {
    fetchMock.mockResolvedValue(new Response(feed('')));

    await new TorznabAdapter().search(query(), config({ baseUrl: 'http://127.0.0.1:9117/api' }), AbortSignal.timeout(1000));

    expect(lastUrl().pathname).toBe('/api');
  });

  it('reads seeders, size, infohash and freeleech off the torznab attributes', async () => {
    fetchMock.mockResolvedValue(new Response(feed(ITEM)));

    const [release] = await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    expect(release).toMatchObject({
      indexerId: 7,
      guid: 'https://tracker.example.com/details/1',
      title: 'Dune - Frank Herbert (retail) [EPUB]',
      downloadUrl: 'https://tracker.example.com/download/1.torrent?key=abc',
      infoHash: 'c9e15763f722f23e98a29decdfae341b98d53056',
      sizeBytes: 1048576,
      seeders: 42,
      freeleech: true,
    });
    // `peers` counts seeders, so leechers is the difference and not the raw 50.
    expect(release.leechers).toBe(8);
  });

  it('treats a lone item as a list rather than dropping it', async () => {
    fetchMock.mockResolvedValue(new Response(feed(ITEM)));
    expect(await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).toHaveLength(1);
  });

  it('carries a magnet link through when the proxy publishes one', async () => {
    const magnetItem = `<item><title>Dune</title><guid>2</guid><link>magnet:?xt=urn:btih:abc</link></item>`;
    fetchMock.mockResolvedValue(new Response(feed(magnetItem)));

    const [release] = await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000));

    expect(release.magnet).toBe('magnet:?xt=urn:btih:abc');
    expect(release.downloadUrl).toBeUndefined();
  });

  /**
   * The failure this exists for: torznab reports a bad key as a 200 carrying `<error>`, which
   * would otherwise reach the approver as "no releases found" rather than "fix your key".
   */
  it('raises an unauthorized failure for a 200 carrying a torznab error element', async () => {
    fetchMock.mockResolvedValue(new Response('<error code="100" description="Incorrect user credentials" />'));

    await expect(new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({
      failure: 'unauthorized',
    });
  });

  it('distinguishes throttling from an ordinary failure', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));

    await expect(new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).rejects.toBeInstanceOf(IndexerSearchException);
    await expect(new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000))).rejects.toMatchObject({ failure: 'throttled' });
  });

  it('reports a caps document as a successful test', async () => {
    fetchMock.mockResolvedValue(new Response('<caps><server title="Jackett" version="0.21" /></caps>'));

    await expect(new TorznabAdapter().test(config())).resolves.toEqual({ success: true, indexerName: 'Jackett' });
    expect(lastUrl().searchParams.get('t')).toBe('caps');
  });

  it('fails the test when the URL answers with something that is not torznab', async () => {
    fetchMock.mockResolvedValue(new Response('<html><body>hello</body></html>'));

    await expect(new TorznabAdapter().test(config())).resolves.toMatchObject({ success: false });
  });

  /**
   * Real Prowlarr output. `booktitle` is the bare work title where the release name is decorated,
   * and the seed figures are the tracker's own requirements passed through.
   */
  it('reads booktitle and the tracker seed requirements', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        feed(`
        <item>
          <title>Project Hail Mary by Andy Weir [ENG / M4B]</title>
          <guid>https://tracker.example.com/details/9</guid>
          <link>https://tracker.example.com/download/9.torrent</link>
          <torznab:attr name="booktitle" value="Project Hail Mary" />
          <torznab:attr name="author" value="Andy Weir" />
          <torznab:attr name="seeders" value="7414" />
          <torznab:attr name="minimumratio" value="1" />
          <torznab:attr name="minimumseedtime" value="259200" />
        </item>`),
      ),
    );

    const [release] = await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000));
    expect(release.bookTitle).toBe('Project Hail Mary');
    // The release name keeps its flags, because that is what the picker shows.
    expect(release.title).toBe('Project Hail Mary by Andy Weir [ENG / M4B]');
    expect(release.seedRatioGoal).toBe(1);
    // Torznab states seconds; 259200 is the 72 hours the tracker asks for.
    expect(release.seedTimeMinutes).toBe(4320);
  });

  it('leaves the seed requirements and booktitle unset when the indexer states none', async () => {
    fetchMock.mockResolvedValue(new Response(feed(ITEM)));

    const [release] = await new TorznabAdapter().search(query(), config(), AbortSignal.timeout(1000));
    expect(release.bookTitle).toBeUndefined();
    expect(release.seedRatioGoal).toBeUndefined();
    expect(release.seedTimeMinutes).toBeUndefined();
  });
});

/**
 * `redirect: 'follow'` checks the URL it was given and nothing after it, then lets the global
 * fetch take up to twenty hops unchecked. A compromised or intercepted indexer could answer the
 * search itself with a 302 at loopback or the link-local metadata address and have the body read
 * and parsed, which is the same hole `fetchTorrentFile` was already closed against.
 */
describe('TorznabAdapter search redirects', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  /** A public proxy, because a LAN Jackett is allowed private addresses and has nothing to prove. */
  function publicConfig(): ResolvedIndexerConfig {
    return config({ baseUrl: 'https://tracker.example.com/api', allowPrivateAddress: false });
  }

  it('checks each hop rather than only the URL configured', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));

    await expect(new TorznabAdapter().search(query(), publicConfig(), AbortSignal.timeout(1000))).rejects.toThrow(/private or local/);
    // The metadata address was never opened: the refusal happened between the hops.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to a public address and parses what it answered', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://proxy.example.com/api?t=search' } }))
      .mockResolvedValueOnce(new Response(feed(ITEM)));

    const releases = await new TorznabAdapter().search(query(), publicConfig(), AbortSignal.timeout(1000));

    expect(releases).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls.at(-1)![0].toString()).origin).toBe('https://proxy.example.com');
  });

  it('gives up on a chain that never lands', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://tracker.example.com/again' } }));

    await expect(new TorznabAdapter().search(query(), publicConfig(), AbortSignal.timeout(1000))).rejects.toThrow(/redirected more than/);
  });

  it('refuses a redirect that says nothing about where to go', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));

    await expect(new TorznabAdapter().search(query(), publicConfig(), AbortSignal.timeout(1000))).rejects.toThrow(/without saying where/);
  });
});

/**
 * The one URL on this adapter a tracker chose rather than an operator, and so the one that gets
 * checked on every hop rather than only on the first.
 */
describe('TorznabAdapter.fetchTorrentFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  /** A public host is the only thing the pre-flight approves, so a public one is what it starts as. */
  function publicConfig(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
    return config({ baseUrl: 'https://tracker.example.com/api', allowPrivateAddress: false, ...overrides });
  }

  it('returns the .torrent a tracker answered with', async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from('d8:announce...e')));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).resolves.toEqual(Buffer.from('d8:announce...e'));
  });

  it('follows a redirect and grabs the file from where it points', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('https://cdn.example.com/1.torrent')).mockResolvedValueOnce(new Response(Buffer.from('d8:announcee')));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).resolves.toEqual(Buffer.from('d8:announcee'));
    expect(new URL(fetchMock.mock.calls.at(-1)![0].toString()).href).toBe('https://cdn.example.com/1.torrent');
  });

  it('refuses a redirect to loopback', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('http://127.0.0.1:8080/secret'));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).rejects.toThrow(/private or local/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** The address a cloud instance answers its own credentials on. */
  it('refuses a redirect to a link-local metadata address', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data/iam/security-credentials/'));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).rejects.toThrow(/private or local/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** The hop that is checked has to be every hop, not only the one the release named. */
  it('refuses a private address reached through a chain of public redirects', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('https://cdn.example.com/a'))
      .mockResolvedValueOnce(redirectTo('https://mirror.example.com/b'))
      .mockResolvedValueOnce(redirectTo('http://10.0.0.5/internal'));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).rejects.toThrow(/private or local/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up rather than following redirects forever', async () => {
    fetchMock.mockResolvedValue(redirectTo('https://tracker.example.com/again'));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).rejects.toThrow(/redirected more than/);
  });

  /**
   * The grab used the global fetch while the search honoured the profile, so an indexer reachable
   * only through a proxy searched fine and then failed at the moment it mattered.
   */
  it('carries the operator egress the search already honours', async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from('d8:announcee')));

    await new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig({ networkProfile: { proxyUrl: 'http://proxy.example.com:8080' } }));

    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ dispatcher: expect.any(ProxyAgent) });
  });

  it('refuses a .torrent that declares itself past the ceiling', async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from('d8:e'), { headers: { 'content-length': String(4 * 1024 * 1024) } }));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).rejects.toThrow(/too large/);
  });

  /** Two megabytes of metadata is already impossible; the rest of an endless body is not read. */
  it('aborts a .torrent that streams past the ceiling rather than buffering it', async () => {
    const chunk = 64 * 1024;
    const { stream, pulled } = endlessStream(chunk);
    fetchMock.mockResolvedValue(new Response(stream));

    await expect(new TorznabAdapter().fetchTorrentFile(RELEASE, publicConfig())).rejects.toThrow(/too large/);
    // The ceiling plus the one chunk it takes to notice, rather than however much was on offer.
    expect(pulled()).toBe((2 * 1024 * 1024) / chunk + 1);
  });

  it('refuses a release with no download link at all', async () => {
    await expect(new TorznabAdapter().fetchTorrentFile({ ...RELEASE, downloadUrl: undefined }, publicConfig())).rejects.toBeInstanceOf(
      IndexerSearchException,
    );
  });
});

/** A feed is a document, and a document that never ends is not one. */
describe('TorznabAdapter search response bounds', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  it('fails an endless feed as a bounded error rather than reading it all', async () => {
    const chunk = 256 * 1024;
    const { stream, pulled } = endlessStream(chunk);
    fetchMock.mockResolvedValue(new Response(stream));

    await expect(new TorznabAdapter().search(query(), config(), AbortSignal.timeout(5000))).rejects.toMatchObject({ failure: 'error' });
    expect(pulled()).toBe((16 * 1024 * 1024) / chunk + 1);
  });

  it('refuses a feed that declares itself past the ceiling before reading it', async () => {
    const { stream, pulled } = endlessStream(1024);
    fetchMock.mockResolvedValue(new Response(stream, { headers: { 'content-length': String(64 * 1024 * 1024) } }));

    await expect(new TorznabAdapter().search(query(), config(), AbortSignal.timeout(5000))).rejects.toThrow(/more XML/);
    expect(pulled()).toBe(0);
  });
});
