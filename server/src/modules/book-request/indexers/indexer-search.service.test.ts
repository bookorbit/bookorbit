import type { BookRequestRow } from '../../../db/schema';
import { emptyReleaseProfiles } from '@bookorbit/types';
import type { IndexerAdapterType } from '@bookorbit/types';

import { IndexerSearchException, type ReleaseCandidate, type ResolvedIndexerConfig } from './indexer-adapter';
import { IndexerOperationLock } from './indexer-operation-lock';
import { IndexerSearchService } from './indexer-search.service';

function request(overrides: Partial<BookRequestRow> = {}): BookRequestRow {
  return {
    id: 7,
    title: 'Dune',
    authors: ['Frank Herbert'],
    isbn13: null,
    isbn10: null,
    metadataSources: [],
    mediaKind: 'ebook',
    preferredFormats: ['epub'],
    language: null,
    ...overrides,
  } as BookRequestRow;
}

/**
 * Torznab is the only built-in type, so anything else a row can name is a plugin slug. Cast the way
 * `IndexerConfigService` casts a row it read from the database, which is where these come from.
 */
const pluginType = (slug: string) => slug as IndexerAdapterType;

function indexer(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
  return {
    id: 1,
    name: 'jackett',
    adapterType: 'torznab',
    baseUrl: 'http://127.0.0.1:9117',
    credential: null,
    allowPrivateAddress: true,
    categories: { ebook: [7020], audiobook: [3030], comic: [7030] },
    disabledMediaKinds: [],
    isbnSearchDisabled: false,
    settings: null,
    credentialError: null,
    ...overrides,
  };
}

function release(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    indexerId: 1,
    guid: 'g1',
    title: 'Frank Herbert - Dune [EPUB]',
    sizeBytes: 2 * 1024 * 1024,
    seeders: 10,
    leechers: 1,
    format: 'epub',
    ...overrides,
  };
}

/**
 * Adapters here declare every medium unless a test says otherwise, so a stub is not silently read
 * as a source that carries nothing.
 */
function makeService(
  configs: ResolvedIndexerConfig[],
  adapters: Record<string, { search: ReturnType<typeof vi.fn>; mediaKinds?: readonly string[]; seedsBack?: boolean; supportsIsbnSearch?: boolean }>,
) {
  // The rows that exist, of which `configs` is the enabled subset. Every case here builds its
  // sources enabled, so the two counts match unless a case says otherwise.
  const indexers = {
    resolveEnabledConfigs: vi.fn().mockResolvedValue(configs),
    resolveConfig: vi.fn((id: number) => Promise.resolve(configs.find((config) => config.id === id))),
    countSources: vi.fn().mockResolvedValue({ configured: configs.length, enabled: configs.length }),
    recordSearchOutcomes: vi.fn().mockResolvedValue(undefined),
  };
  const registry = {
    find: vi.fn((type: string) => {
      const adapter = adapters[type];
      return adapter ? { mediaKinds: ['ebook', 'audiobook', 'comic'], supportsIsbnSearch: false, ...adapter } : undefined;
    }),
    seedsBack: vi.fn((type: string) => adapters[type]?.seedsBack ?? true),
  };
  // No profile, which is the shipped default and keeps these cases about search and scoring.
  const automationSettings = { get: vi.fn(() => Promise.resolve({ profiles: emptyReleaseProfiles() })) };
  return {
    service: new IndexerSearchService(indexers as never, registry as never, automationSettings as never, new IndexerOperationLock()),
    indexers,
    adapters,
    automationSettings,
  };
}

describe('IndexerSearchService', () => {
  /**
   * A rotated or unset encryption key leaves stored credentials unreadable. Decrypting the whole
   * enabled list up front meant one such row threw out of the resolve and took every other source
   * with it, including the ones holding no credential at all.
   */
  it('reports a source whose credential cannot be read without abandoning the others', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const archive = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2' })]) };
    const { service } = makeService(
      [
        indexer({ credentialError: 'BOOK_REQUEST_ENCRYPTION_KEY may have changed' }),
        indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' }),
      ],
      { torznab, 'internet-archive': archive },
    );

    const result = await service.search(request());

    expect(torznab.search).not.toHaveBeenCalled();
    expect(archive.search).toHaveBeenCalled();
    expect(result.releases.map((item) => item.indexerName)).toEqual(['archive']);
    expect(result.indexers.find((status) => status.indexerId === 1)).toMatchObject({
      ok: false,
      failure: 'unauthorized',
      error: expect.stringContaining('ENCRYPTION_KEY'),
    });
  });

  /**
   * A grab resolves a release by guid, so an indexer that returns one twice is describing one
   * release however many rows it sent. The resolution map already collapsed them, so the picker
   * offered a duplicate row that resolved to the same release and the source's count claimed one
   * it does not have.
   */
  it('collapses a guid one indexer returned more than once', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release(), release(), release({ guid: 'g2' })]) };
    const { service } = makeService([indexer()], { torznab });

    const result = await service.search(request());

    expect(result.releases.map((item) => item.guid)).toEqual(['g1', 'g2']);
    expect(result.indexers[0]).toMatchObject({ ok: true, count: 2, filtered: 0 });
  });

  /** Two indexers naming the same guid are two releases; the key is scoped to the source. */
  it('keeps the same guid from two different indexers apart', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const archive = { search: vi.fn().mockResolvedValue([release({ indexerId: 2 })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' })], {
      torznab,
      'internet-archive': archive,
    });

    const result = await service.search(request());

    expect(result.releases).toHaveLength(2);
  });

  it('merges every enabled indexer into one list ranked by score', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release({ title: 'Something Else [EPUB]', seeders: 400 })]) };
    const archive = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2', seeders: 5 })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' })], {
      torznab,
      'internet-archive': archive,
    });

    const result = await service.search(request());

    expect(result.releases.map((item) => item.indexerName)).toEqual(['archive', 'jackett']);
    expect(result.releases[0].score).toBeGreaterThan(result.releases[1].score);
  });

  it('records the outcome of every source that took part in a real search', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const archive = { search: vi.fn().mockRejectedValue(new Error('tracker is offline')) };
    const { service, indexers } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' })], {
      torznab,
      'internet-archive': archive,
    });

    await service.search(request());

    expect(indexers.recordSearchOutcomes).toHaveBeenCalledWith([
      { indexerId: 1, ok: true, error: null },
      { indexerId: 2, ok: false, error: 'tracker is offline' },
    ]);
  });

  it('reports the request fields used to search and rank the releases', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([]) };
    const { service } = makeService([indexer()], { torznab });

    const result = await service.search(
      request({
        authors: ['Frank Herbert', 'Brian Herbert'],
        isbn10: '0441172717',
        isbn13: '9780441172719',
        language: 'en',
        preferredFormats: ['epub', 'azw3'],
      }),
    );

    expect(result.criteria).toEqual({
      title: 'Dune',
      authors: ['Frank Herbert', 'Brian Herbert'],
      isbn10: null,
      isbn13: '9780441172719',
      activeIsbn: '9780441172719',
      isbns: ['9780441172719'],
      mediaKind: 'ebook',
      language: 'en',
      preferredFormats: ['epub', 'azw3'],
    });
  });

  it('searches only the recommended ISBN while retaining every distinct provider ISBN as an alternative', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });

    const result = await service.search(
      request({
        metadataSources: [
          { providerKey: 'google', providerId: 'g1', providerLabel: 'Google Books', isbn10: '0441013597', isbn13: null },
          { providerKey: 'amazon', providerId: 'a1', providerLabel: 'Amazon', isbn10: null, isbn13: '9781250301697' },
        ],
      }),
    );

    expect(libgen.search).toHaveBeenCalledWith(
      expect.objectContaining({ isbn13: '9780441013593', isbn13s: ['9780441013593'] }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.criteria).toMatchObject({ activeIsbn: '9780441013593', isbns: ['9780441013593', '9781250301697'] });
    expect(result.indexers[0]?.query).toEqual({ kind: 'isbn', value: '9780441013593' });
  });

  it('uses explicit picker overrides instead of silently retaining request search fields', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });

    const result = await service.search(request({ isbn13: '9780441172719', language: 'en' }), {
      refresh: true,
      overrides: {
        title: 'Dune Messiah',
        authors: ['Frank Herbert'],
        isbn: '9780593098233',
        language: null,
        preferredFormats: ['azw3'],
      },
    });

    expect(libgen.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Dune Messiah',
        author: 'Frank Herbert',
        isbn13: '9780593098233',
        isbn13s: ['9780593098233'],
        language: null,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.criteria).toEqual({
      title: 'Dune Messiah',
      authors: ['Frank Herbert'],
      isbn10: null,
      isbn13: '9780593098233',
      activeIsbn: '9780593098233',
      isbns: ['9780593098233', '9780441172719'],
      mediaKind: 'ebook',
      language: null,
      preferredFormats: ['azw3'],
    });
  });

  it('lets an explicit null ISBN select a title and author search', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });

    const result = await service.search(request({ isbn13: '9780441172719' }), { refresh: true, overrides: { isbn: null } });

    expect(libgen.search).toHaveBeenCalledWith(expect.objectContaining({ isbn13: null, isbn13s: [] }), expect.anything(), expect.anything());
    expect(result.criteria).toMatchObject({ activeIsbn: null, isbns: ['9780441172719'] });
    expect(result.indexers[0]?.query).toEqual({ kind: 'titleAuthor', value: 'Dune Frank Herbert' });
  });

  it('withholds the ISBN from a source the operator took it away from', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen'), isbnSearchDisabled: true })], { libgen });

    const result = await service.search(request({ isbn13: '9780441172719' }));

    expect(libgen.search).toHaveBeenCalledWith(expect.objectContaining({ isbn13: null, isbn13s: [] }), expect.anything(), expect.anything());
    expect(result.indexers[0]?.query).toEqual({ kind: 'titleAuthor', value: 'Dune Frank Herbert' });
    // Still the request's ISBN: taking it from one source does not change what was asked for.
    expect(result.criteria).toMatchObject({ activeIsbn: '9780441172719' });
  });

  it('leaves a source with the ISBN taken away out of an ISBN-capable pass', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const other = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService(
      [indexer({ adapterType: pluginType('libgen'), isbnSearchDisabled: true }), indexer({ id: 2, name: 'other', adapterType: pluginType('other') })],
      { libgen, other },
    );

    const result = await service.search(request({ isbn13: '9780441172719' }), { indexerMode: 'isbn-capable' });

    expect(libgen.search).not.toHaveBeenCalled();
    expect(result.indexers.map((status) => status.indexerName)).toEqual(['other']);
  });

  it('limits fallback passes to ISBN-capable indexers', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([]) };
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'libgen', adapterType: pluginType('libgen') })], {
      torznab,
      libgen,
    });

    const result = await service.search(request({ isbn13: '9780441172719' }), { indexerMode: 'isbn-capable' });

    expect(torznab.search).not.toHaveBeenCalled();
    expect(libgen.search).toHaveBeenCalledTimes(1);
    expect(result.indexers.map((status) => status.indexerName)).toEqual(['libgen']);
    expect(result.uncoveredIndexerCount).toBe(0);
  });

  it('sends the final title fallback only to ISBN-capable indexers', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([]) };
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'libgen', adapterType: pluginType('libgen') })], {
      torznab,
      libgen,
    });

    const result = await service.search(request({ isbn13: '9780441172719' }), {
      indexerMode: 'isbn-capable',
      overrides: { isbn: null },
    });

    expect(torznab.search).not.toHaveBeenCalled();
    expect(libgen.search).toHaveBeenCalledWith(expect.objectContaining({ isbn13: null, isbn13s: [] }), expect.anything(), expect.anything());
    expect(result.indexers[0]?.query).toEqual({ kind: 'titleAuthor', value: 'Dune Frank Herbert' });
  });

  /** One tracker being down is a per-indexer state in the picker, not a failed search. */
  it('reports a failing indexer beside the results the others returned', async () => {
    const torznab = { search: vi.fn().mockRejectedValue(new IndexerSearchException('unauthorized', 'bad key')) };
    const archive = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2' })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' })], {
      torznab,
      'internet-archive': archive,
    });

    const result = await service.search(request());

    expect(result.releases).toHaveLength(1);
    expect(result.indexers).toEqual([
      {
        indexerId: 1,
        indexerName: 'jackett',
        ok: false,
        count: 0,
        filtered: 0,
        query: { kind: 'titleAuthor', value: 'Dune Frank Herbert' },
        failure: 'unauthorized',
        error: 'bad key',
        seedsBack: true,
      },
      {
        indexerId: 2,
        indexerName: 'archive',
        ok: true,
        count: 1,
        filtered: 0,
        query: { kind: 'titleAuthor', value: 'Dune Frank Herbert' },
        seedsBack: true,
      },
    ]);
  });

  /**
   * A source that serves the file itself has no swarm to report, which the picker must not read
   * as one release having omitted its seeder count. The answer belongs to the adapter, so it
   * travels with the indexer's status rather than being guessed from the merged release list.
   */
  it('reports whether each source joins a swarm', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const libgen = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2', seeders: null })]), seedsBack: false };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'libgen', adapterType: 'libgen' })], { torznab, libgen });

    const result = await service.search(request());

    expect(result.indexers.map((status) => [status.indexerName, status.seedsBack])).toEqual([
      ['jackett', true],
      ['libgen', false],
    ]);
  });

  it('counts what the hard filters dropped, so an empty list stays explainable', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release({ seeders: 0 }), release({ guid: 'g2', format: 'mp3' })]) };
    const { service } = makeService([indexer()], { torznab });

    const result = await service.search(request());

    expect(result.releases).toHaveLength(0);
    expect(result.indexers[0]).toMatchObject({ ok: true, count: 0, filtered: 2 });
  });

  /** Reopening the picker must not re-hit a private tracker; `refresh` is the way past that. */
  it('serves a repeat search from the cache until asked to refresh', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer()], { torznab });

    await service.search(request());
    const second = await service.search(request());
    expect(second.cached).toBe(true);
    expect(torznab.search).toHaveBeenCalledTimes(1);

    const refreshed = await service.search(request(), { refresh: true });
    expect(refreshed.cached).toBe(false);
    expect(torznab.search).toHaveBeenCalledTimes(2);
  });

  it('keeps manual and default search caches separate while retaining both pickable result sets', async () => {
    const torznab = {
      search: vi.fn((query: { title: string }) =>
        Promise.resolve([release(query.title === 'Dune Messiah' ? { guid: 'custom' } : { guid: 'default' })]),
      ),
    };
    const { service } = makeService([indexer()], { torznab });

    await service.search(request());
    await service.search(request(), { overrides: { title: 'Dune Messiah' } });
    const defaultAgain = await service.search(request());

    expect(defaultAgain.cached).toBe(true);
    expect(torznab.search).toHaveBeenCalledTimes(2);
    expect(service.find(7, 1, 'default')).toBeDefined();
    expect(service.find(7, 1, 'custom')).toBeDefined();
  });

  it('keeps all-indexer and ISBN-capable search caches separate', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });
    const book = request({ isbn13: '9780441172719' });

    await service.search(book);
    await service.search(book, { indexerMode: 'isbn-capable' });
    const capableAgain = await service.search(book, { indexerMode: 'isbn-capable' });

    expect(libgen.search).toHaveBeenCalledTimes(2);
    expect(capableAgain.cached).toBe(true);
  });

  /**
   * An open library that holds only text has nothing to say about an audiobook. Nothing goes wrong
   * when it is asked for one, because it is never asked: the mismatch is a permanent property of
   * the source, known before any request, so it is left out of the search rather than reported as
   * a per-indexer failure the operator might try to fix.
   */
  it('leaves out a source that does not carry the requested medium instead of failing it', async () => {
    const gutenberg = { search: vi.fn(), mediaKinds: ['ebook'] as const };
    const { service } = makeService([indexer({ id: 2, name: 'gutenberg', adapterType: pluginType('project-gutenberg') })], {
      'project-gutenberg': gutenberg,
    });

    const result = await service.search(request({ mediaKind: 'audiobook' }));

    expect(gutenberg.search).not.toHaveBeenCalled();
    expect(result.indexers).toEqual([]);
  });

  /**
   * The operator's own narrowing, on top of what the adapter declares. A general torznab proxy in
   * front of an audiobook-only tracker still says it carries all three, and an empty category list
   * cannot express the exclusion either: torznab reads that as "send no `cat`".
   */
  it('leaves out a source the operator took out of this medium', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer({ disabledMediaKinds: ['ebook'] })], { torznab });

    const result = await service.search(request({ mediaKind: 'ebook' }));

    expect(torznab.search).not.toHaveBeenCalled();
    expect(result.uncoveredIndexerCount).toBe(1);
  });

  it('still searches that source for the media it was left in', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer({ disabledMediaKinds: ['ebook'] })], { torznab });

    await service.search(request({ mediaKind: 'audiobook' }));

    expect(torznab.search).toHaveBeenCalledTimes(1);
  });

  /**
   * A missing adapter is a fact about the build and is reported rather than hidden, but an
   * exclusion is a decision about the source, and it stands whether or not the adapter loaded.
   */
  it('honours the exclusion even for a row whose adapter this build no longer has', async () => {
    const { service } = makeService([indexer({ adapterType: pluginType('departed'), disabledMediaKinds: ['ebook'] })], {});

    const result = await service.search(request({ mediaKind: 'ebook' }));

    expect(result.indexers).toEqual([]);
    expect(result.uncoveredIndexerCount).toBe(1);
  });

  /** Counted rather than dropped, so an empty list can still say why it is empty. */
  it('counts the sources it left out, so an empty list stays explainable', async () => {
    const gutenberg = { search: vi.fn(), mediaKinds: ['ebook'] as const };
    const librivox = { search: vi.fn().mockResolvedValue([]), mediaKinds: ['audiobook'] as const };
    const { service } = makeService(
      [
        indexer({ id: 2, name: 'gutenberg', adapterType: pluginType('project-gutenberg') }),
        indexer({ id: 3, name: 'librivox', adapterType: pluginType('librivox') }),
      ],
      { 'project-gutenberg': gutenberg, librivox },
    );

    const result = await service.search(request({ mediaKind: 'audiobook' }));

    expect(result.uncoveredIndexerCount).toBe(1);
    expect(result.indexers).toEqual([expect.objectContaining({ indexerName: 'librivox', ok: true })]);
  });

  it('counts nothing as uncovered when every source carries the medium', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer()], { torznab });

    await expect(service.search(request())).resolves.toMatchObject({ uncoveredIndexerCount: 0 });
  });

  /**
   * The picker cannot ask for the indexer list, so an empty release list has to carry why it is
   * empty. Without these two counts "nothing is set up", "everything is switched off" and "this
   * book was not found" all arrive as the same empty array.
   */
  it('reports how many sources were enabled and how many exist at all', async () => {
    const { service, indexers } = makeService([], {});
    indexers.countSources.mockResolvedValue({ configured: 3, enabled: 0 });

    const result = await service.search(request());

    expect(result.enabledIndexerCount).toBe(0);
    expect(result.configuredIndexerCount).toBe(3);
    expect(result.releases).toEqual([]);
    expect(result.indexers).toEqual([]);
  });

  /**
   * A row whose adapter is gone cannot be judged on its media at all, so leaving it out here would
   * hide the one state the operator has to act on.
   */
  it('still searches a row whose adapter this build no longer has, so it is reported', async () => {
    const { service } = makeService([indexer({ adapterType: pluginType('departed') })], {});

    const result = await service.search(request({ mediaKind: 'audiobook' }));

    expect(result.uncoveredIndexerCount).toBe(0);
    expect(result.indexers).toEqual([expect.objectContaining({ ok: false, failure: 'error' })]);
  });

  it('resolves a picked release from its own results rather than anything a client sent', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release({ downloadUrl: 'https://tracker.example.com/dl?tid=1' })]) };
    const { service } = makeService([indexer()], { torznab });

    await service.search(request());

    expect(service.find(7, 1, 'g1')).toMatchObject({ downloadUrl: 'https://tracker.example.com/dl?tid=1' });
    expect(service.find(7, 1, 'unknown')).toBeUndefined();
    expect(service.find(99, 1, 'g1')).toBeUndefined();
  });

  it('reports an indexer whose adapter is not built rather than silently skipping it', async () => {
    const { service } = makeService([indexer({ adapterType: 'internet-archive' })], {});

    const result = await service.search(request());

    expect(result.indexers[0]).toMatchObject({ ok: false, failure: 'error' });
  });

  /**
   * A signal an adapter is handed only ends the work that actually watches it, so the search races
   * the adapter against its own deadline rather than trusting it: one that never settles used to
   * hold a slot in the bounded search pool for the life of the process, and the `Promise.all` over
   * the indexers never resolved - a picker spinning with nothing to show and nothing to report.
   *
   * That the race ends a wait nothing is watching is proven in `with-deadline.utils.test.ts`,
   * where it costs milliseconds rather than the real twenty-second per-indexer deadline. What
   * belongs here is the deadline reaching the adapter at all, and an overrun landing as one
   * source's failure rather than the search's.
   */
  it('gives each source a deadline and reports the one that ran out of time', async () => {
    const slow = {
      search: vi.fn((_query: unknown, _config: unknown, signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        return Promise.reject(new IndexerSearchException('timeout', 'jackett did not answer in time'));
      }),
    };
    const working = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2' })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: pluginType('internet-archive') })], {
      torznab: slow,
      'internet-archive': working,
    });

    const result = await service.search(request());

    expect(slow.search.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(result.indexers).toEqual([
      expect.objectContaining({ indexerId: 1, ok: false, failure: 'timeout' }),
      expect.objectContaining({ indexerId: 2, ok: true }),
    ]);
    expect(result.releases).toHaveLength(1);
  });

  it('serializes work for one source and resolves its latest credential inside the lock', async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const credentialsSeen: Array<string | null> = [];
    const torznab = {
      search: vi.fn(async (_query: unknown, config: ResolvedIndexerConfig) => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        credentialsSeen.push(config.credential);
        if (calls === 1) await firstHeld;
        active--;
        return [release()];
      }),
    };
    const { service, indexers } = makeService([indexer({ credential: 'session-1' })], { torznab });
    indexers.resolveConfig.mockResolvedValueOnce(indexer({ credential: 'session-1' })).mockResolvedValueOnce(indexer({ credential: 'session-2' }));

    const first = service.search(request({ id: 7 }), { refresh: true });
    await vi.waitFor(() => expect(torznab.search).toHaveBeenCalledTimes(1));
    const second = service.search(request({ id: 8 }), { refresh: true });
    await Promise.resolve();
    expect(torznab.search).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(credentialsSeen).toEqual(['session-1', 'session-2']);
  });

  /**
   * Scoring runs per candidate, so a release the scorer cannot read is one source misbehaving.
   * Outside the per-indexer accounting it threw out of the merge and 500d the whole picker,
   * including every other indexer that answered perfectly well.
   */
  it('reports the one source whose release could not be scored and keeps the rest', async () => {
    const malformed = {
      search: vi.fn().mockResolvedValue([
        // A getter rather than a value, because the sanitiser at the plugin boundary is what
        // ordinarily catches a bad shape: this is the layer behind it.
        Object.defineProperty(release(), 'title', {
          get() {
            throw new TypeError('title is not a string');
          },
        }),
      ]),
    };
    const working = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2' })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: pluginType('internet-archive') })], {
      torznab: malformed,
      'internet-archive': working,
    });

    const result = await service.search(request());

    expect(result.indexers).toEqual([
      expect.objectContaining({ indexerId: 1, ok: false, failure: 'error' }),
      expect.objectContaining({ indexerId: 2, ok: true, count: 1 }),
    ]);
    expect(result.releases).toHaveLength(1);
  });
});
