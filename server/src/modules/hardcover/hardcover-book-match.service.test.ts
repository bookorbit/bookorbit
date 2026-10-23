import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { EDITION_DISPLAY_LIMIT, HardcoverBookMatchService } from './hardcover-book-match.service';
import { buildHardcoverMatchBasis } from './hardcover-id.utils';

const mockRepo = {
  findBookState: vi.fn(),
  upsertBookState: vi.fn(),
  relinkBook: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

function makeService() {
  return new HardcoverBookMatchService(mockRepo as any, mockClient as any);
}

const baseBook = {
  bookId: 42,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Test Book',
  authorName: 'Test Author',
  hardcoverMetadataId: null,
  status: 'reading',
  startedAt: null,
  finishedAt: null,
  rating: null,
  progress: null,
  pageCount: null,
  format: null,
};

// A link whose identifiers are unchanged since it was made, so the cached path runs untouched.
const BASE_BASIS = buildHardcoverMatchBasis(baseBook);

describe('HardcoverBookMatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.relinkBook.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached match when state exists and no error', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 200, pages: 320 }] }],
    });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result).toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      editionPages: 320,
      editionAudioSeconds: null,
      matchMethod: 'cached',
    });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('keeps the cached edition even when it has no page count (no silent swap)', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    mockClient.query.mockResolvedValue({
      books: [
        {
          id: 100,
          editions: [
            { id: 200, pages: null, isbn_13: null, isbn_10: null, audio_seconds: null },
            { id: 201, pages: 544, isbn_13: null, isbn_10: null, audio_seconds: null },
          ],
        },
      ],
    });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result).toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      editionPages: null,
      editionAudioSeconds: null,
      matchMethod: 'cached',
    });
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('returns the cached audiobook edition duration for progress sync', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 200, pages: null, audio_seconds: 3600 }] }],
    });

    await expect(makeService().matchBook(1, 'tok', { ...baseBook, format: 'm4b' })).resolves.toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      editionPages: null,
      editionAudioSeconds: 3600,
      matchMethod: 'cached',
    });
  });

  it('re-points a cached match when the cached edition no longer exists on Hardcover', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 301, pages: 410, isbn_13: '9781234567890', isbn_10: null, audio_seconds: null }] }],
    });

    const result = await makeService().matchBook(1, 'tok', { ...baseBook, isbn13: '9781234567890', pageCount: 410 });

    expect(result?.hardcoverEditionId).toBe(301);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ hardcoverBookId: 100, hardcoverEditionId: 301, matchMethod: 'cached' }),
    );
  });

  it('keeps a cached edition that sits past the selection cap instead of re-pointing it', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 9999,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    const cappedWindow = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      pages: 410,
      isbn_13: index === 0 ? '9781234567890' : null,
      isbn_10: null,
      audio_seconds: null,
    }));
    mockClient.query.mockImplementation((_userId, _token, query: string) => {
      if (query.includes('FindBookEditionMetricsById')) {
        return { books: [{ id: 100, editions: [{ id: 9999, pages: 250, isbn_13: null, isbn_10: null, audio_seconds: null }] }] };
      }
      return { books: [{ id: 100, editions: cappedWindow }] };
    });

    const result = await makeService().matchBook(1, 'tok', { ...baseBook, isbn13: '9781234567890', pageCount: 410 });

    expect(result).toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 9999,
      editionPages: 250,
      editionAudioSeconds: null,
      matchMethod: 'cached',
    });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('FindBookEditionMetricsById'), { id: 100, editionId: 9999 });
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('falls back to the capped list only after the cached edition is missing from the book', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    mockClient.query.mockImplementation((_userId, _token, query: string) => {
      if (query.includes('FindBookEditionMetricsById')) {
        return { books: [{ id: 100, editions: [] }] };
      }
      return { books: [{ id: 100, editions: [{ id: 301, pages: 410, isbn_13: null, isbn_10: null, audio_seconds: null }] }] };
    });

    const result = await makeService().matchBook(1, 'tok', { ...baseBook, pageCount: 410 });

    expect(result?.hardcoverEditionId).toBe(301);
    const queries = mockClient.query.mock.calls.map((call) => call[2] as string);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('FindBookEditionMetricsById');
    expect(queries[1]).toContain('FindBookEditionsById');
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ hardcoverBookId: 100, hardcoverEditionId: 301, matchMethod: 'cached' }),
    );
  });

  it('skips the by-id lookup when no edition is cached', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: null,
      matchError: null,
      matchBasis: BASE_BASIS,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 301, pages: 410, isbn_13: null, isbn_10: null, audio_seconds: null }] }],
    });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result?.hardcoverEditionId).toBe(301);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('FindBookEditionsById'), { id: 100 });
  });

  it('re-queries when cached state has match error', async () => {
    mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: null, matchError: 'no_match' });
    mockClient.query.mockResolvedValue({ books: [{ id: 99, editions: [{ id: 55 }] }] });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result?.hardcoverBookId).toBe(99);
    expect(result?.matchMethod).toBe('isbn');
  });

  it('matches by metadata_id when hardcoverMetadataId is set', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 77 }] });
    const book = { ...baseBook, hardcoverMetadataId: '77', isbn13: null };
    const result = await makeService().matchBook(1, 'tok', book);
    expect(result?.matchMethod).toBe('metadata_id');
    expect(result?.hardcoverBookId).toBe(77);
    expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('query FindBookById'), { id: 77 });
  });

  it('matches by metadata slug when hardcoverMetadataId is not numeric', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 686104, editions: [{ id: 30673405, pages: 382 }] }] });
    const book = { ...baseBook, hardcoverMetadataId: 'fyrebirds', isbn13: null };

    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 686104,
      hardcoverEditionId: 30673405,
      editionPages: 382,
      editionAudioSeconds: null,
      matchMethod: 'metadata_id',
    });
    expect(mockClient.query).toHaveBeenCalledWith(
      1,
      'tok',
      expect.stringContaining('query FindBookBySlug'),
      expect.objectContaining({ slug: 'fyrebirds' }),
    );
  });

  it('treats a digit-prefixed Hardcover slug as a slug instead of a partial numeric ID', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockImplementation((_userId, _token, query: string) => {
      if (query.includes('query FindBookById')) {
        return { books: [{ id: 84, editions: [{ id: 24634818, pages: 284 }] }] };
      }
      if (query.includes('query FindBookBySlug')) {
        return { books: [{ id: 277100, editions: [{ id: 15528636, pages: 114, isbn_13: '9780140143508' }] }] };
      }
      throw new Error('Unexpected query');
    });
    const book = {
      ...baseBook,
      title: '84, Charing Cross Road',
      hardcoverMetadataId: '84-charing-cross-road',
      isbn13: '9780140143508',
    };

    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 277100,
      hardcoverEditionId: 15528636,
      editionPages: 114,
      editionAudioSeconds: null,
      matchMethod: 'metadata_id',
    });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('query FindBookBySlug'), {
      slug: '84-charing-cross-road',
    });
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ hardcoverBookId: 277100, hardcoverEditionId: 15528636, matchMethod: 'metadata_id' }),
    );
  });

  it('falls back to isbn13 when metadata_id fails', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce({ books: [{ id: 88, editions: [{ id: 11 }] }] });
    const book = { ...baseBook, hardcoverMetadataId: '99' };
    const result = await makeService().matchBook(1, 'tok', book);
    expect(result?.hardcoverBookId).toBe(88);
    expect(result?.matchMethod).toBe('isbn');
  });

  it('falls back to title+author when isbn fails', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query
      .mockResolvedValueOnce({ books: [] })
      .mockResolvedValueOnce({ search: { ids: [123] } })
      .mockResolvedValueOnce({ books: [{ id: 123 }] });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result?.matchMethod).toBe('title');
    expect(result?.hardcoverBookId).toBe(123);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      1,
      'tok',
      expect.stringContaining('query SearchBooks'),
      expect.objectContaining({ query: 'Test Book Test Author' }),
    );
    const searchQuery = mockClient.query.mock.calls[1]?.[2] as string;
    expect(searchQuery).toContain('error');
    expect(searchQuery).not.toContain('fields:');
    expect(searchQuery).not.toContain('weights:');
  });

  it('logs payload-level errors returned by Hardcover search', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValueOnce({ books: [] }).mockResolvedValueOnce({
      search: {
        error: 'Number of values in `num_typos` does not match number of `query_by` fields.',
        ids: null,
      },
    });
    const service = makeService();
    const logger = Reflect.get(service, 'logger') as { warn: (message: string) => void };
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(service.matchBook(1, 'tok', baseBook)).resolves.toBeNull();

    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[hardcover\.book_match\] \[fail\] userId=1 bookId=42 method=title_author durationMs=\d+ errorClass=SearchError error="Number of values in `num_typos` does not match number of `query_by` fields\." - title lookup failed$/,
      ),
    );
  });

  it('preserves Hardcover search ranking when hydrating title matches', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query
      .mockResolvedValueOnce({ books: [] })
      .mockResolvedValueOnce({ search: { ids: [123, 456] } })
      .mockResolvedValueOnce({
        books: [
          { id: 456, editions: [{ id: 40 }] },
          { id: 123, editions: [{ id: 30 }] },
        ],
      });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result).toEqual({
      hardcoverBookId: 123,
      hardcoverEditionId: 30,
      editionPages: null,
      editionAudioSeconds: null,
      matchMethod: 'title',
    });
  });

  it('returns null and stores no_match when all strategies fail', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [] });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result).toBeNull();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ matchError: 'no_match' }));
  });

  it('stores match result to cache on success', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 5, editions: [{ id: 6 }] }] });
    await makeService().matchBook(1, 'tok', baseBook);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        bookId: 42,
        hardcoverBookId: 5,
        hardcoverEditionId: 6,
        matchMethod: 'isbn',
      }),
    );
  });

  it('does not hardcode editions(limit: 1) on the metadata_id lookup', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 700, editions: [{ id: 901, pages: 512 }] }] });

    await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverMetadataId: '700', isbn13: null, isbn10: null });

    const queryArg = mockClient.query.mock.calls[0][2] as string;
    expect(queryArg).toContain('query FindBookById');
    expect(queryArg).not.toContain('editions(limit: 1)');
  });

  it('selects the ISBN-matching edition on a metadata_id match instead of the first (audiobook) edition', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({
      books: [
        {
          id: 700,
          editions: [
            { id: 900, pages: null, isbn_13: '9990000000000', isbn_10: null, audio_seconds: 36000 },
            { id: 901, pages: 512, isbn_13: '9781234567890', isbn_10: null, audio_seconds: null },
          ],
        },
      ],
    });

    const book = { ...baseBook, hardcoverMetadataId: '700', isbn13: '9781234567890', isbn10: null, pageCount: 512, format: 'epub' };
    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 700,
      hardcoverEditionId: 901,
      editionPages: 512,
      editionAudioSeconds: null,
      matchMethod: 'metadata_id',
    });
  });

  it('selects the closest page-count, non-audiobook edition on a title match', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValueOnce({ search: { ids: [123] } }).mockResolvedValueOnce({
      books: [
        {
          id: 123,
          editions: [
            { id: 800, pages: null, isbn_13: null, isbn_10: null, audio_seconds: 50000 },
            { id: 801, pages: 405, isbn_13: null, isbn_10: null, audio_seconds: null },
            { id: 802, pages: 980, isbn_13: null, isbn_10: null, audio_seconds: null },
          ],
        },
      ],
    });

    const book = { ...baseBook, isbn13: null, isbn10: null, pageCount: 400, format: 'epub' };
    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 123,
      hardcoverEditionId: 801,
      editionPages: 405,
      editionAudioSeconds: null,
      matchMethod: 'title',
    });
  });

  it('records the identifiers a new link was resolved from', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 5, editions: [{ id: 6 }] }] });

    await makeService().matchBook(1, 'tok', baseBook);

    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverBookId: 5, matchBasis: BASE_BASIS }));
  });

  it('records no basis when nothing matched', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [] });

    await makeService().matchBook(1, 'tok', baseBook);

    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ matchError: 'no_match', matchBasis: null }));
  });

  describe('when the identifiers change after a link was made', () => {
    const WRONG_BOOK = 1554702;
    const WRONG_EDITION = 31616496;
    const RIGHT_BOOK = 2973670;
    const RIGHT_EDITION = 33314466;
    const staleBook = { ...baseBook, title: 'ok, amen', hardcoverMetadataId: 'hell-be-ok-growing-gorgeous-boys-into-good-men', isbn13: null };
    const correctedBook = {
      ...staleBook,
      hardcoverMetadataId: 'ok-amen',
      hardcoverEditionId: String(RIGHT_EDITION),
      isbn13: '9789146223856',
      format: 'epub',
    };
    const rightBookAnswer = {
      books: [{ id: RIGHT_BOOK, editions: [{ id: RIGHT_EDITION, pages: 321, isbn_13: '9789146223856', isbn_10: null, audio_seconds: null }] }],
    };
    const wrongBookMetrics = {
      books: [{ id: WRONG_BOOK, editions: [{ id: WRONG_EDITION, pages: 217, isbn_13: null, isbn_10: null, audio_seconds: null }] }],
    };

    function answer(routes: Record<string, unknown>) {
      mockClient.query.mockImplementation((_userId: number, _token: string, query: string) => {
        const route = Object.keys(routes).find((name) => query.includes(name));
        if (!route) return Promise.reject(new Error(`unexpected query ${query.trim().split('(')[0]}`));
        const value = routes[route];
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      });
    }

    function queryNames(): string[] {
      return mockClient.query.mock.calls.map((call) => /query (\w+)/.exec(call[2] as string)?.[1] ?? '');
    }

    function silenceWarnings(service: HardcoverBookMatchService) {
      const logger = Reflect.get(service, 'logger') as { warn: (message: string) => void; log: (message: string) => void };
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(logger, 'log').mockImplementation(() => undefined);
      return logger;
    }

    it('moves the link to the book the corrected metadata identifies (issue 1488)', async () => {
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: WRONG_EDITION,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(staleBook),
      });
      answer({ 'query FindBookBySlug': rightBookAnswer });
      const service = makeService();
      const logger = silenceWarnings(service);

      const result = await service.matchBook(1, 'tok', correctedBook);

      expect(result).toEqual({
        hardcoverBookId: RIGHT_BOOK,
        hardcoverEditionId: RIGHT_EDITION,
        editionPages: 321,
        editionAudioSeconds: null,
        matchMethod: 'metadata_id',
        replacedHardcoverBookId: WRONG_BOOK,
      });
      expect(mockRepo.relinkBook).toHaveBeenCalledWith({
        userId: 1,
        bookId: 42,
        hardcoverBookId: RIGHT_BOOK,
        hardcoverEditionId: RIGHT_EDITION,
        matchMethod: 'metadata_id',
        matchBasis: buildHardcoverMatchBasis(correctedBook),
      });
      expect(queryNames()).toEqual(['FindBookBySlug']);
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          `[hardcover.book_relink] [end] userId=1 bookId=42 previousHardcoverBookId=${WRONG_BOOK} hardcoverBookId=${RIGHT_BOOK}`,
        ),
      );
    });

    it('heals a link recorded before its basis existed when the Hardcover ID disagrees with it', async () => {
      // The reporter's row: the corrected edition was written onto the stale book by the metadata save.
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: RIGHT_EDITION,
        matchError: null,
        matchBasis: null,
      });
      answer({ 'query FindBookBySlug': rightBookAnswer });
      const service = makeService();
      silenceWarnings(service);
      const result = await service.matchBook(1, 'tok', correctedBook);

      expect(result).toMatchObject({ hardcoverBookId: RIGHT_BOOK, hardcoverEditionId: RIGHT_EDITION, replacedHardcoverBookId: WRONG_BOOK });
      expect(mockRepo.relinkBook).toHaveBeenCalledWith(expect.objectContaining({ hardcoverBookId: RIGHT_BOOK, hardcoverEditionId: RIGHT_EDITION }));
    });

    it('lets only the Hardcover ID move a link recorded before its basis existed', async () => {
      // Import may have confirmed such a link against an ISBN that disagrees with it.
      const isbnOnlyBook = { ...baseBook, isbn13: '9789146223856' };
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: WRONG_EDITION,
        matchError: null,
        matchBasis: null,
      });
      answer({ FindBookEditionMetricsById: wrongBookMetrics });

      const result = await makeService().matchBook(1, 'tok', isbnOnlyBook);

      expect(result).toMatchObject({ hardcoverBookId: WRONG_BOOK, hardcoverEditionId: WRONG_EDITION, matchMethod: 'cached' });
      expect(queryNames()).toEqual(['FindBookEditionMetricsById']);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith({ userId: 1, bookId: 42, matchBasis: buildHardcoverMatchBasis(isbnOnlyBook) });
      expect(mockRepo.relinkBook).not.toHaveBeenCalled();
    });

    it('moves a recorded link when a changed ISBN resolves to another book', async () => {
      const before = { ...baseBook, isbn13: '9780000000001' };
      const after = { ...baseBook, isbn13: '9789146223856' };
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: WRONG_EDITION,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(before),
      });
      answer({ FindBookByISBN13: rightBookAnswer });
      const service = makeService();
      silenceWarnings(service);

      const result = await service.matchBook(1, 'tok', after);

      expect(result).toMatchObject({
        hardcoverBookId: RIGHT_BOOK,
        hardcoverEditionId: RIGHT_EDITION,
        matchMethod: 'isbn',
        replacedHardcoverBookId: WRONG_BOOK,
      });
      expect(mockRepo.relinkBook).toHaveBeenCalledWith(expect.objectContaining({ matchMethod: 'isbn', matchBasis: buildHardcoverMatchBasis(after) }));
    });

    it("keeps the link and the user's edition when the changed identifiers resolve to the same book", async () => {
      const before = { ...baseBook, hardcoverMetadataId: '100', isbn13: '9780000000001' };
      const after = { ...before, isbn13: '9780000000002' };
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: 100,
        hardcoverEditionId: 200,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(before),
      });
      answer({
        'query FindBookById': {
          books: [{ id: 100, editions: [{ id: 201, pages: 300, isbn_13: '9780000000002', isbn_10: null, audio_seconds: null }] }],
        },
        FindBookEditionMetricsById: { books: [{ id: 100, editions: [{ id: 200, pages: 320, isbn_13: null, isbn_10: null, audio_seconds: null }] }] },
      });

      const result = await makeService().matchBook(1, 'tok', after);

      expect(result).toEqual({ hardcoverBookId: 100, hardcoverEditionId: 200, editionPages: 320, editionAudioSeconds: null, matchMethod: 'cached' });
      // The Hardcover ID outranks the ISBN, so the ISBN is never looked up.
      expect(queryNames()).toEqual(['FindBookById', 'FindBookEditionMetricsById']);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith({ userId: 1, bookId: 42, matchBasis: buildHardcoverMatchBasis(after) });
      expect(mockRepo.relinkBook).not.toHaveBeenCalled();
    });

    it('keeps the link when Hardcover knows none of the corrected identifiers, and settles the check', async () => {
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: WRONG_EDITION,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(staleBook),
      });
      answer({ 'query FindBookBySlug': { books: [] }, FindBookByISBN13: { books: [] }, FindBookEditionMetricsById: wrongBookMetrics });

      const result = await makeService().matchBook(1, 'tok', correctedBook);

      expect(result).toMatchObject({ hardcoverBookId: WRONG_BOOK, matchMethod: 'cached' });
      expect(queryNames()).toEqual(['FindBookBySlug', 'FindBookByISBN13', 'FindBookEditionMetricsById']);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith({ userId: 1, bookId: 42, matchBasis: buildHardcoverMatchBasis(correctedBook) });
      expect(mockRepo.relinkBook).not.toHaveBeenCalled();
    });

    it('falls through to the ISBN when Hardcover does not know the corrected Hardcover ID', async () => {
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: WRONG_EDITION,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(staleBook),
      });
      answer({ 'query FindBookBySlug': { books: [] }, FindBookByISBN13: rightBookAnswer });
      const service = makeService();
      silenceWarnings(service);

      const result = await service.matchBook(1, 'tok', correctedBook);

      expect(result).toMatchObject({ hardcoverBookId: RIGHT_BOOK, matchMethod: 'isbn', replacedHardcoverBookId: WRONG_BOOK });
    });

    it('retries on a later sync instead of letting a weaker identifier decide when a lookup fails', async () => {
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: WRONG_BOOK,
        hardcoverEditionId: WRONG_EDITION,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(staleBook),
      });
      answer({
        'query FindBookBySlug': new Error('Hardcover unavailable'),
        FindBookByISBN13: rightBookAnswer,
        FindBookEditionMetricsById: wrongBookMetrics,
      });
      const service = makeService();
      silenceWarnings(service);

      const result = await service.matchBook(1, 'tok', correctedBook);

      expect(result).toMatchObject({ hardcoverBookId: WRONG_BOOK, matchMethod: 'cached' });
      expect(queryNames()).toEqual(['FindBookBySlug', 'FindBookEditionMetricsById']);
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
      expect(mockRepo.relinkBook).not.toHaveBeenCalled();
    });

    it('never lets a title search move a link', async () => {
      const before = { ...baseBook, isbn13: '9780000000001' };
      const cleared = { ...baseBook, isbn13: null };
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: 100,
        hardcoverEditionId: 200,
        matchError: null,
        matchBasis: buildHardcoverMatchBasis(before),
      });
      answer({ FindBookEditionMetricsById: { books: [{ id: 100, editions: [{ id: 200, pages: 320 }] }] } });

      const result = await makeService().matchBook(1, 'tok', cleared);

      expect(result).toMatchObject({ hardcoverBookId: 100, hardcoverEditionId: 200, matchMethod: 'cached' });
      expect(queryNames()).toEqual(['FindBookEditionMetricsById']);
      expect(mockRepo.relinkBook).not.toHaveBeenCalled();
    });
  });

  describe('metadata edition', () => {
    const editions = [
      { id: 900, pages: null, isbn_13: null, isbn_10: null, audio_seconds: 36000 },
      { id: 901, pages: 512, isbn_13: '9781234567890', isbn_10: null, audio_seconds: null },
      { id: 902, pages: 300, isbn_13: null, isbn_10: null, audio_seconds: null },
    ];

    it('wins over the best-guess edition on a fresh Hardcover ID match', async () => {
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockClient.query.mockResolvedValue({ books: [{ id: 700, editions }] });

      const result = await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverMetadataId: '700', hardcoverEditionId: '902', format: 'epub' });

      expect(result).toEqual({
        hardcoverBookId: 700,
        hardcoverEditionId: 902,
        editionPages: 300,
        editionAudioSeconds: null,
        matchMethod: 'metadata_id',
      });
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverBookId: 700, hardcoverEditionId: 902 }));
    });

    it('is looked up directly when it sits past the capped edition list', async () => {
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockClient.query.mockImplementation((_userId, _token, query: string) =>
        Promise.resolve(
          query.includes('FindBookEditionMetricsById')
            ? { books: [{ id: 700, editions: [{ id: 9999, pages: 250, isbn_13: null, isbn_10: null, audio_seconds: null }] }] }
            : { books: [{ id: 700, editions }] },
        ),
      );

      const result = await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverMetadataId: '700', hardcoverEditionId: '9999' });

      expect(result).toMatchObject({ hardcoverEditionId: 9999, editionPages: 250 });
      expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('FindBookEditionMetricsById'), { id: 700, editionId: 9999 });
    });

    it('is ignored when it belongs to another book', async () => {
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockClient.query.mockImplementation((_userId, _token, query: string) =>
        Promise.resolve(query.includes('FindBookEditionMetricsById') ? { books: [{ id: 700, editions: [] }] } : { books: [{ id: 700, editions }] }),
      );

      const result = await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverMetadataId: '700', hardcoverEditionId: '31616496' });

      expect(result).toMatchObject({ hardcoverBookId: 700, hardcoverEditionId: 901 });
    });

    it("wins over the ISBN's own edition on an ISBN match", async () => {
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockClient.query.mockImplementation((_userId, _token, query: string) =>
        Promise.resolve(
          query.includes('FindBookEditionMetricsById')
            ? { books: [{ id: 88, editions: [{ id: 12, pages: 350, isbn_13: null, isbn_10: null, audio_seconds: null }] }] }
            : { books: [{ id: 88, editions: [{ id: 11, pages: 200 }] }] },
        ),
      );

      const result = await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverEditionId: '12' });

      expect(result).toEqual({ hardcoverBookId: 88, hardcoverEditionId: 12, editionPages: 350, editionAudioSeconds: null, matchMethod: 'isbn' });
    });

    it('falls back without failing the match when its lookup fails', async () => {
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockClient.query.mockImplementation((_userId, _token, query: string) =>
        query.includes('FindBookEditionMetricsById') ? Promise.reject(new Error('boom')) : Promise.resolve({ books: [{ id: 700, editions }] }),
      );
      const service = makeService();
      const warn = vi.spyOn(Reflect.get(service, 'logger') as { warn: (message: string) => void }, 'warn').mockImplementation(() => undefined);

      const result = await service.matchBook(1, 'tok', { ...baseBook, hardcoverMetadataId: '700', hardcoverEditionId: '9999' });

      expect(result).toMatchObject({ hardcoverBookId: 700, hardcoverEditionId: 901, matchMethod: 'metadata_id' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('method=metadata_edition'));
    });

    it('fills a cached link that has no edition yet', async () => {
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 700, hardcoverEditionId: null, matchError: null, matchBasis: BASE_BASIS });
      mockClient.query.mockResolvedValue({ books: [{ id: 700, editions }] });

      const result = await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverEditionId: '902' });

      expect(result).toMatchObject({ hardcoverBookId: 700, hardcoverEditionId: 902, matchMethod: 'cached' });
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverEditionId: 902, matchMethod: 'cached' }));
    });

    it("leaves a user's cached edition alone", async () => {
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 700, hardcoverEditionId: 901, matchError: null, matchBasis: BASE_BASIS });
      mockClient.query.mockResolvedValue({ books: [{ id: 700, editions: [editions[1]] }] });

      const result = await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverEditionId: '902' });

      expect(result).toMatchObject({ hardcoverEditionId: 901, matchMethod: 'cached' });
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });
  });

  describe('listEditions', () => {
    it('maps editions for display, deriving a format label and published date', async () => {
      mockClient.query.mockResolvedValue({
        books: [
          {
            id: 100,
            editions: [
              {
                id: 200,
                title: 'Test Book',
                pages: 320,
                isbn_10: '0756404079',
                isbn_13: '9780756404079',
                publisher: { name: 'DAW Books' },
                language: { code2: 'en' },
                release_date: '2007-03-27',
                reading_format_id: 1,
                image: { url: 'https://assets.hardcover.app/cover.jpg' },
              },
              {
                id: 201,
                pages: null,
                reading_format_id: 2,
                audio_seconds: 50000,
              },
            ],
          },
        ],
      });

      const result = await makeService().listEditions(1, 'tok', 100);

      expect(result).toEqual({
        truncated: false,
        editions: [
          {
            id: 200,
            title: 'Test Book',
            format: 'Physical Book',
            pages: 320,
            isbn10: '0756404079',
            isbn13: '9780756404079',
            publisher: 'DAW Books',
            language: 'en',
            publishedDate: '2007-03-27',
            coverUrl: 'https://assets.hardcover.app/cover.jpg',
          },
          {
            id: 201,
            title: null,
            format: 'Audiobook',
            pages: null,
            isbn10: null,
            isbn13: null,
            publisher: null,
            language: null,
            publishedDate: null,
            coverUrl: null,
          },
        ],
      });
    });

    it('reports no published date when the release date is missing', async () => {
      mockClient.query.mockResolvedValue({
        books: [{ id: 100, editions: [{ id: 200, release_date: null, reading_format_id: 1 }] }],
      });

      const result = await makeService().listEditions(1, 'tok', 100);

      expect(result.editions[0].publishedDate).toBeNull();
    });

    it('requests a deterministic window so two calls agree on the same slice', async () => {
      mockClient.query.mockResolvedValue({ books: [] });
      await makeService().listEditions(1, 'tok', 100);

      const query = mockClient.query.mock.calls[0][2] as string;
      expect(query).toContain('order_by: { id: asc }');
    });

    it('reports truncation instead of silently dropping editions past the cap', async () => {
      const editions = Array.from({ length: EDITION_DISPLAY_LIMIT + 1 }, (_, index) => ({ id: index + 1, reading_format_id: 1 }));
      mockClient.query.mockResolvedValue({ books: [{ id: 100, editions }] });

      const result = await makeService().listEditions(1, 'tok', 100);

      expect(result.editions).toHaveLength(EDITION_DISPLAY_LIMIT);
      expect(result.truncated).toBe(true);
    });

    it('returns an empty result when the book is not found', async () => {
      mockClient.query.mockResolvedValue({ books: [] });
      expect(await makeService().listEditions(1, 'tok', 999)).toEqual({ editions: [], truncated: false });
    });

    it('throws instead of masking an upstream failure as an empty catalog', async () => {
      mockClient.query.mockRejectedValue(new Error('boom'));
      await expect(makeService().listEditions(1, 'tok', 100)).rejects.toThrow('Failed to load Hardcover editions');
    });
  });

  describe('findEditionForBook', () => {
    it('resolves an edition scoped to the book it must belong to', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 100, editions: [{ id: 200, reading_format_id: 4 }] }] });

      const result = await makeService().findEditionForBook(1, 'tok', 100, 200);

      expect(result).toMatchObject({ id: 200, format: 'E-Book' });
      expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('FindBookEditionById'), { id: 100, editionId: 200 });
    });

    it('resolves an edition that sits past the display cap', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 100, editions: [{ id: 9999, reading_format_id: 1 }] }] });

      await expect(makeService().findEditionForBook(1, 'tok', 100, 9999)).resolves.toMatchObject({ id: 9999 });
    });

    it('returns null when the edition does not belong to the book', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 100, editions: [] }] });
      expect(await makeService().findEditionForBook(1, 'tok', 100, 200)).toBeNull();
    });

    it('throws instead of reporting an upstream failure as a rejected edition', async () => {
      mockClient.query.mockRejectedValue(new Error('boom'));
      await expect(makeService().findEditionForBook(1, 'tok', 100, 200)).rejects.toThrow('Failed to load Hardcover editions');
    });
  });
});
