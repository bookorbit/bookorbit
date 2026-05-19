import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverBookMatchService } from './hardcover-book-match.service';

const mockRepo = {
  findBookState: vi.fn(),
  upsertBookState: vi.fn(),
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
};

describe('HardcoverBookMatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.upsertBookState.mockResolvedValue({});
  });

  it('returns cached match when state exists and no error', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 200, pages: 320 }] }],
    });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result).toEqual({ hardcoverBookId: 100, hardcoverEditionId: 200, editionPages: 320, matchMethod: 'cached' });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('updates cached edition when the current cached edition has no pages', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
    });
    mockClient.query.mockResolvedValue({
      books: [
        {
          id: 100,
          editions: [
            { id: 200, pages: null },
            { id: 201, pages: 544 },
          ],
        },
      ],
    });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result).toEqual({ hardcoverBookId: 100, hardcoverEditionId: 201, editionPages: 544, matchMethod: 'cached' });
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        bookId: 42,
        hardcoverBookId: 100,
        hardcoverEditionId: 201,
        matchMethod: 'cached',
        matchError: null,
      }),
    );
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

    expect(result).toEqual({ hardcoverBookId: 123, hardcoverEditionId: 30, editionPages: null, matchMethod: 'title' });
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
});
