import { BUNDLED_PROVIDER_DIRECTORY, parseProviderDirectory } from './metadata-provider-directory';

const VALID = {
  key: 'mangabaka',
  name: 'MangaBaka',
  summary: 'Manga, manhwa and light novels.',
  image: 'ghcr.io/bookorbit/mangabaka-provider',
  version: '0.1.0',
  docsUrl: 'https://github.com/bookorbit/bookorbit-metadata-providers/tree/main/providers/mangabaka',
  homepage: 'https://mangabaka.org',
  color: '#E30047',
  mediaTypes: ['book', 'comic', 'magazine'],
  languages: ['ja', 'en-US', 'not a language'],
};

describe('parseProviderDirectory', () => {
  it('keeps a well-formed entry, normalising what it can', () => {
    expect(parseProviderDirectory({ providers: [VALID] })).toEqual([
      {
        ...VALID,
        port: 8080,
        color: '#e30047',
        mediaTypes: ['book', 'comic'],
        languages: ['ja', 'en-US'],
      },
    ]);
  });

  it('drops entries that could mislead an admin, and keeps the rest', () => {
    const entries = parseProviderDirectory({
      providers: [
        { ...VALID, key: 'Bad Key' },
        { ...VALID, key: 'plain-http', docsUrl: 'http://example.com/readme' },
        { ...VALID, key: 'odd-image', image: 'ghcr.io/x/y; rm -rf /' },
        { ...VALID, key: 'no-version', version: 'latest' },
        { ...VALID, key: 'bad-port', port: 70000 },
        VALID,
        { ...VALID, name: 'Duplicate key' },
      ],
    });

    expect(entries?.map((entry) => entry.key)).toEqual(['mangabaka']);
    expect(entries?.[0]?.name).toBe('MangaBaka');
  });

  it('drops a homepage or colour it cannot trust without dropping the entry', () => {
    const [entry] = parseProviderDirectory({ providers: [{ ...VALID, homepage: 'javascript:alert(1)', color: 'red' }] }) ?? [];

    expect(entry).toMatchObject({ key: 'mangabaka', homepage: null, color: null });
  });

  it('treats a document without usable providers as unusable', () => {
    expect(parseProviderDirectory(null)).toBeNull();
    expect(parseProviderDirectory({ providers: 'none' })).toBeNull();
    expect(parseProviderDirectory({ providers: [{ key: 'x' }] })).toBeNull();
  });

  it('accepts its own bundled copy, so the two can be kept in step', () => {
    expect(parseProviderDirectory({ providers: BUNDLED_PROVIDER_DIRECTORY })).toEqual(BUNDLED_PROVIDER_DIRECTORY);
  });
});
