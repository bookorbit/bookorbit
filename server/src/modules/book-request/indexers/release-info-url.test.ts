import { indexerSecrets, safeReleaseInfoUrl, withSafeInfoUrl } from './release-info-url';

describe('safeReleaseInfoUrl', () => {
  it('passes an ordinary details page through', () => {
    expect(safeReleaseInfoUrl('https://tracker.example.com/details.php?id=123&hit=1', [])).toBe(
      'https://tracker.example.com/details.php?id=123&hit=1',
    );
  });

  it('opens a Newznab comments link at the top of its page', () => {
    expect(safeReleaseInfoUrl('https://indexer.example.com/details/abc#comments', [])).toBe('https://indexer.example.com/details/abc');
  });

  it('keeps any other anchor, which a hash-routed tracker needs to land on the release', () => {
    expect(safeReleaseInfoUrl('https://tracker.example.com/#/torrent/9', [])).toBe('https://tracker.example.com/#/torrent/9');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'magnet:?xt=urn:btih:abc', 'ftp://tracker.example.com/1', '/details/1', 'not a url'])(
    'drops %s, which is not an http(s) page',
    (raw) => {
      expect(safeReleaseInfoUrl(raw, [])).toBeUndefined();
    },
  );

  it.each([
    'https://indexer.example.com/details/1?apikey=abc',
    'https://indexer.example.com/details/1?api_key=abc',
    'https://jackett.example.com/dl/x?jackett_apikey=abc',
    'https://tracker.example.com/details.php?id=1&passkey=abc',
    'https://tracker.example.com/details.php?id=1&torrent_pass=abc',
    'https://tracker.example.com/details.php?id=1&authkey=abc',
    'https://tracker.example.com/details.php?id=1&access_token=abc',
    'https://tracker.example.com/details.php?id=1&rsskey=abc',
    'https://cdn.example.com/page?X-Amz-Signature=abc',
  ])('drops %s, whose query names a credential', (raw) => {
    expect(safeReleaseInfoUrl(raw, [])).toBeUndefined();
  });

  it('does not mistake an author parameter for an auth one', () => {
    expect(safeReleaseInfoUrl('https://library.example.org/search?author=Herbert', [])).toBe('https://library.example.org/search?author=Herbert');
  });

  it("drops a link carrying the indexer's own secret anywhere, path included", () => {
    expect(safeReleaseInfoUrl('https://tracker.example.com/details/1/s3cr3t-value', ['s3cr3t-value'])).toBeUndefined();
    expect(safeReleaseInfoUrl('https://tracker.example.com/details/1?ref=s3cr3t%2Fvalue', ['s3cr3t/value'])).toBeUndefined();
  });

  it('ignores a secret too short to search for without matching ordinary text', () => {
    expect(safeReleaseInfoUrl('https://tracker.example.com/details/1', ['1'])).toBe('https://tracker.example.com/details/1');
  });

  it('drops a link carrying user info', () => {
    expect(safeReleaseInfoUrl('https://user:pass@tracker.example.com/details/1', [])).toBeUndefined();
  });

  it('drops a link longer than any page address', () => {
    expect(safeReleaseInfoUrl(`https://tracker.example.com/${'a'.repeat(2100)}`, [])).toBeUndefined();
  });
});

describe('indexerSecrets', () => {
  it('collects the credential and any key pasted into the base URL', () => {
    expect(indexerSecrets({ credential: 'stored-key', baseUrl: 'http://127.0.0.1:9117/api?apikey=base-key&t=caps' })).toEqual([
      'stored-key',
      'base-key',
    ]);
  });

  it('survives an unparseable base URL', () => {
    expect(indexerSecrets({ credential: null, baseUrl: 'not a url' })).toEqual([]);
  });
});

describe('withSafeInfoUrl', () => {
  const candidate = { indexerId: 1, guid: 'g', title: 'Dune', sizeBytes: null, seeders: null, leechers: null };

  it('returns the same candidate when there is no page link to vet', () => {
    expect(withSafeInfoUrl(candidate, [])).toBe(candidate);
  });

  it('removes a page link that may not be shown', () => {
    expect(withSafeInfoUrl({ ...candidate, infoUrl: 'https://t.example/d/1?passkey=x' }, []).infoUrl).toBeUndefined();
  });
});
