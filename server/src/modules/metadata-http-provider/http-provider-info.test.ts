import { bookUrlFromTemplate, distinctProviderLabels, fallbackProviderInfo, parseProviderInfo } from './http-provider-info';

describe('parseProviderInfo', () => {
  it('reads a base-spec provider with every extension defaulted', () => {
    const result = parseProviderInfo({ name: 'Book Metadata Provider', version: '1.0.0', authenticationRequired: false });

    expect(result).toEqual({
      ok: true,
      info: {
        key: 'book-metadata-provider',
        name: 'Book Metadata Provider',
        version: '1.0.0',
        specVersion: '1',
        avatarUrl: null,
        authenticationRequired: false,
        mediaTypes: ['book', 'audiobook'],
        lookup: false,
        supportedFields: null,
        searchParams: ['query', 'author', 'mediaType'],
        idMaxLength: 512,
        bookUrlTemplate: null,
        rateLimit: { maxConcurrency: 2, minIntervalMs: 0 },
        coverShape: null,
        color: null,
      },
    });
  });

  it('keeps only an opaque #rrggbb colour, lowercased', () => {
    const colour = (color: unknown) => {
      const result = parseProviderInfo({ name: 'FantLab', key: 'fantlab', color });
      return result.ok ? result.info.color : 'refused';
    };
    expect(colour('#8B1E1E')).toBe('#8b1e1e');
    expect(colour(' #00aaff ')).toBe('#00aaff');
    for (const bad of ['red', '#fff', '#8b1e1e80', 'rgb(1,2,3)', 'var(--primary)', 7, null]) {
      expect(colour(bad)).toBeNull();
    }
  });

  it('reads the extensions BookOrbit understands and bounds them', () => {
    const result = parseProviderInfo({
      name: 'FantLab',
      key: 'fantlab',
      mediaTypes: ['book', 'tape'],
      lookup: true,
      supportedFields: ['title', 'cover', 'nonsense'],
      searchParams: ['query', 'isbn', 'limit', 'secret'],
      idMaxLength: 9_000,
      bookUrlTemplate: 'https://fantlab.ru/work{id}',
      rateLimit: { maxConcurrency: 50, minIntervalMs: 250 },
      coverShape: 'portrait',
      avatarUrl: 'javascript:alert(1)',
    });

    expect(result.ok && result.info).toMatchObject({
      key: 'fantlab',
      mediaTypes: ['book'],
      lookup: true,
      supportedFields: ['title', 'cover'],
      searchParams: ['query', 'author', 'mediaType', 'isbn', 'limit'],
      idMaxLength: 512,
      bookUrlTemplate: 'https://fantlab.ru/work{id}',
      rateLimit: { maxConcurrency: 4, minIntervalMs: 250 },
      coverShape: 'portrait',
      avatarUrl: null,
    });
  });

  it('refuses info without a name or with a key BookOrbit cannot file data under', () => {
    expect(parseProviderInfo({ version: '1' }).ok).toBe(false);
    expect(parseProviderInfo([]).ok).toBe(false);
    for (const key of ['Goodreads', 'goodreads', 'autofill', 'x', 'has space', 'a'.repeat(33)]) {
      expect(parseProviderInfo({ name: 'Anything', key }).ok).toBe(false);
    }
  });

  it('builds record links only from a template that yields an http(s) URL', () => {
    const info = parseProviderInfo({ name: 'FantLab', key: 'fantlab', bookUrlTemplate: 'https://fantlab.ru/work{id}' });
    expect(info.ok && bookUrlFromTemplate(info.info, '3104')).toBe('https://fantlab.ru/work3104');
    const bad = parseProviderInfo({ name: 'FantLab', key: 'fantlab', bookUrlTemplate: 'ftp://x/{id}' });
    expect(bad.ok && bad.info.bookUrlTemplate).toBeNull();
  });
});

describe('fallbackProviderInfo', () => {
  it('names a provider without /provider/info after its whole address, so one host can serve several', () => {
    expect(fallbackProviderInfo('http://pack:8080/a/')).toEqual({ name: 'pack:8080/a', key: 'pack-8080-a', specVersion: '0' });
    expect(fallbackProviderInfo('http://pack:8080/b/').key).toBe('pack-8080-b');
    expect(fallbackProviderInfo('http://abs-provider/').key).toBe('abs-provider');
  });

  it('keeps the key valid for an IP address, a reserved host name and a long path', () => {
    expect(fallbackProviderInfo('http://192.168.1.20:3000/').key).toBe('p-192-168-1-20-3000');
    expect(fallbackProviderInfo('http://kobo/').key).toBe('p-kobo');
    const long = fallbackProviderInfo('http://provider.example.org/a/very/long/path/to/one/provider/').key;
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    for (const url of ['http://192.168.1.20:3000/', 'http://kobo/', 'http://provider.example.org/a/very/long/path/to/one/provider/']) {
      expect(parseProviderInfo(fallbackProviderInfo(url)).ok).toBe(true);
    }
  });

  it('gives providers behind one long host name different keys', () => {
    const goodreads = fallbackProviderInfo('http://bookorbit-metadata-providers:8080/goodreads/').key;
    const audible = fallbackProviderInfo('http://bookorbit-metadata-providers:8080/audible/').key;
    expect(goodreads).not.toBe(audible);
    expect(goodreads.length).toBeLessThanOrEqual(32);
    expect(goodreads.startsWith('bookorbit-metadata-prov')).toBe(true);
  });

  it('keeps a pinned key whatever the address becomes', () => {
    expect(fallbackProviderInfo('http://pack:3001/a/', 'pack-3000-a')).toEqual({ name: 'pack:3001/a', key: 'pack-3000-a', specVersion: '0' });
  });
});

describe('parseProviderInfo key from a long name', () => {
  it('keeps two long names that share a start apart', () => {
    const first = parseProviderInfo({ name: 'Bibliotheque Nationale Metadata Bridge One' });
    const second = parseProviderInfo({ name: 'Bibliotheque Nationale Metadata Bridge Two' });
    expect(first.ok && second.ok && first.info.key !== second.info.key).toBe(true);
  });
});

describe('distinctProviderLabels', () => {
  const builtIns = ['Goodreads', 'goodreads', 'Open Library', 'openLibrary'];

  it('keeps a name that clashes with nothing', () => {
    const labels = distinctProviderLabels([{ key: 'fantlab', name: 'FantLab', baseUrl: 'http://fantlab:8080/' }], builtIns);
    expect(labels.get('fantlab')).toBe('FantLab');
  });

  it('adds the host when two providers share a name, and the key when they share the host too', () => {
    const labels = distinctProviderLabels(
      [
        { key: 'fantlab', name: 'FantLab', baseUrl: 'http://fantlab:8080/' },
        { key: 'fantlab-mirror', name: 'fantlab', baseUrl: 'http://mirror.example:8080/' },
        { key: 'pack-a', name: 'Pack', baseUrl: 'http://pack:8080/a/' },
        { key: 'pack-b', name: 'Pack', baseUrl: 'http://pack:8080/b/' },
      ],
      builtIns,
    );
    expect(labels.get('fantlab')).toBe('FantLab (fantlab:8080)');
    expect(labels.get('fantlab-mirror')).toBe('fantlab (mirror.example:8080)');
    expect(labels.get('pack-a')).toBe('Pack (pack-a)');
    expect(labels.get('pack-b')).toBe('Pack (pack-b)');
  });

  it("never lets an external provider read as a built-in's name", () => {
    const labels = distinctProviderLabels(
      [
        { key: 'goodreads-mirror', name: 'Goodreads', baseUrl: 'http://gr.example/' },
        { key: 'ol', name: 'OpenLibrary', baseUrl: 'http://ol.example/' },
      ],
      builtIns,
    );
    expect(labels.get('goodreads-mirror')).toBe('Goodreads (gr.example)');
    expect(labels.get('ol')).toBe('OpenLibrary (ol.example)');
  });
});
