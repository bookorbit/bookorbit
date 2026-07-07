import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StorygraphBookMatchService } from './storygraph-book-match.service';

const mockRepo = {
  findBookState: vi.fn(),
  upsertBookState: vi.fn(),
};

const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  extractCsrfToken: vi.fn(),
};

function makeService() {
  return new StorygraphBookMatchService(mockRepo as any, mockClient as any);
}

const cookies = { sessionCookie: 'sess', rememberToken: 'remember' };

const baseBook = {
  bookId: 42,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Test Book',
  authorName: 'Test Author',
  format: 'epub',
  status: 'reading',
  progress: null,
};

function searchHtml(...bookIds: string[]): string {
  return bookIds
    .map(
      (id) => `
    <div class="pane">
      <div class="book-title-author-and-series">
        <a href="/books/${id}">Test Book</a>
      </div>
    </div>
  `,
    )
    .join('');
}

function bookPageHtml(opts: { editions?: number; userAdded?: boolean; audio?: boolean } = {}): string {
  const editions = opts.editions ?? 1;
  return `<html><body><p>${editions} edition${editions === 1 ? '' : 's'}</p><p>Format: ${opts.audio ? 'Audio' : 'Hardcover'}</p>${
    opts.userAdded ? '<span>user-added</span>' : ''
  }</body></html>`;
}

/** Configures mockClient.get to answer /browse with searchHtml and /books/:id from candidatePages, defaulting to a plain text, non-user-added, 1-edition page. */
function mockSearchAndCandidates(searchResultsHtml: string, candidatePages: Record<string, string> = {}) {
  mockClient.get.mockImplementation((_userId: number, _cookies: unknown, path: string) => {
    if (path.startsWith('/browse')) return Promise.resolve({ status: 200, redirectedToSignIn: false, html: searchResultsHtml });
    const id = path.replace('/books/', '');
    return Promise.resolve({ status: 200, redirectedToSignIn: false, html: candidatePages[id] ?? bookPageHtml() });
  });
}

describe('StorygraphBookMatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.upsertBookState.mockResolvedValue({});
  });

  it('returns the cached match without making a request when state has no error', async () => {
    mockRepo.findBookState.mockResolvedValue({ storygraphBookId: 'abc-123', matchError: null });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'abc-123', matchMethod: 'cached' });
    expect(mockClient.get).not.toHaveBeenCalled();
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('re-searches when cached state has a match error', async () => {
    mockRepo.findBookState.mockResolvedValue({ storygraphBookId: null, matchError: 'no_match' });
    mockSearchAndCandidates(searchHtml('abc-123'));
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
  });

  it('searches by isbn13 first', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('isbn-match'));
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'isbn-match', matchMethod: 'isbn' });
    expect(mockClient.get).toHaveBeenCalledWith(1, cookies, expect.stringContaining(encodeURIComponent(baseBook.isbn13!)));
  });

  it('falls back to isbn10 when isbn13 search finds nothing', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: '<html></html>' })
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: searchHtml('isbn10-match') })
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: bookPageHtml() });
    const book = { ...baseBook, isbn10: '1234567890' };
    const result = await makeService().matchBook(1, cookies, book);
    expect(result).toEqual({ storygraphBookId: 'isbn10-match', matchMethod: 'isbn' });
  });

  it('falls back to title+author search when no isbn is available', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('title-match'));
    const book = { ...baseBook, isbn13: null, isbn10: null };
    const result = await makeService().matchBook(1, cookies, book);
    expect(result).toEqual({ storygraphBookId: 'title-match', matchMethod: 'title' });
    expect(mockClient.get).toHaveBeenCalledWith(1, cookies, expect.stringContaining(encodeURIComponent('Test Book Test Author')));
  });

  it('returns null and records no_match when the session is invalid', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: true, html: '' });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toBeNull();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ matchError: 'no_match' }));
  });

  it('returns null and records no_match when no results are found anywhere', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html></html>' });
    const book = { ...baseBook, isbn13: null, isbn10: null, title: null };
    const result = await makeService().matchBook(1, cookies, book);
    expect(result).toBeNull();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, bookId: 42, storygraphBookId: null, matchError: 'no_match' }),
    );
  });

  it('stores the match result to cache on success', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('cached-result'));
    await makeService().matchBook(1, cookies, baseBook);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, bookId: 42, storygraphBookId: 'cached-result', matchMethod: 'isbn', matchError: null }),
    );
  });

  it('prefers a canonical multi-edition entry over a user-added single-edition duplicate', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('user-added-id', 'canonical-id'), {
      'user-added-id': bookPageHtml({ editions: 1, userAdded: true }),
      'canonical-id': bookPageHtml({ editions: 17 }),
    });

    const result = await makeService().matchBook(1, cookies, baseBook);

    expect(result).toEqual({ storygraphBookId: 'canonical-id', matchMethod: 'isbn' });
    expect(mockClient.get).toHaveBeenCalledTimes(3);
    expect(mockClient.get).toHaveBeenNthCalledWith(2, 1, cookies, '/books/user-added-id');
    expect(mockClient.get).toHaveBeenNthCalledWith(3, 1, cookies, '/books/canonical-id');
  });

  it('prefers the text edition for a text book even when the audio edition has more editions', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('audio-id', 'text-id'), {
      'audio-id': bookPageHtml({ editions: 20, audio: true }),
      'text-id': bookPageHtml({ editions: 3, audio: false }),
    });

    const book = { ...baseBook, format: 'epub' };
    const result = await makeService().matchBook(1, cookies, book);

    expect(result).toEqual({ storygraphBookId: 'text-id', matchMethod: 'isbn' });
  });

  it('prefers the audio edition when the local file is an audiobook', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('text-id', 'audio-id'), {
      'text-id': bookPageHtml({ editions: 10, audio: false }),
      'audio-id': bookPageHtml({ editions: 2, audio: true }),
    });

    const book = { ...baseBook, format: 'm4b' };
    const result = await makeService().matchBook(1, cookies, book);

    expect(result).toEqual({ storygraphBookId: 'audio-id', matchMethod: 'isbn' });
  });

  it('falls back to the first candidate when every candidate page fetch fails', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    const searchResultsHtml = searchHtml('first-id', 'second-id');
    mockClient.get
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: searchResultsHtml })
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'));

    const result = await makeService().matchBook(1, cookies, baseBook);

    expect(result).toEqual({ storygraphBookId: 'first-id', matchMethod: 'isbn' });
  });

  it('caps candidate evaluation at the configured maximum', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockSearchAndCandidates(searchHtml('id-1', 'id-2', 'id-3', 'id-4'));

    await makeService().matchBook(1, cookies, baseBook);

    // 1 search request + at most 3 candidate page fetches (MAX_MATCH_CANDIDATES), not 4
    expect(mockClient.get).toHaveBeenCalledTimes(4);
  });

  describe('resolveManualInput', () => {
    it('extracts the book id from a full StoryGraph URL and resolves its title', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html><body><h1>Real Title</h1></body></html>' });

      const result = await makeService().resolveManualInput(1, cookies, 'https://app.thestorygraph.com/books/canonical-id');

      expect(result).toEqual({ storygraphBookId: 'canonical-id', title: 'Real Title' });
      expect(mockClient.get).toHaveBeenCalledWith(1, cookies, '/books/canonical-id');
    });

    it('treats a bare id as the book id directly', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html><body><h1>Real Title</h1></body></html>' });

      const result = await makeService().resolveManualInput(1, cookies, 'canonical-id');

      expect(result).toEqual({ storygraphBookId: 'canonical-id', title: 'Real Title' });
    });

    it('returns null for empty input', async () => {
      const result = await makeService().resolveManualInput(1, cookies, '   ');
      expect(result).toBeNull();
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('returns null when the session is invalid', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: true, html: '' });
      const result = await makeService().resolveManualInput(1, cookies, 'canonical-id');
      expect(result).toBeNull();
    });

    it('returns null when the book page does not exist', async () => {
      mockClient.get.mockResolvedValue({ status: 404, redirectedToSignIn: false, html: '' });
      const result = await makeService().resolveManualInput(1, cookies, 'missing-id');
      expect(result).toBeNull();
    });

    it('returns null when the request throws', async () => {
      mockClient.get.mockRejectedValue(new Error('network error'));
      const result = await makeService().resolveManualInput(1, cookies, 'canonical-id');
      expect(result).toBeNull();
    });
  });

  describe('getEditions', () => {
    function editionPaneHtml(opts: {
      id: string;
      title?: string;
      format?: string;
      pages?: number;
      language?: string;
      isbn?: string;
      publisher?: string;
      publicationDate?: string;
      coverSrc?: string;
    }): string {
      return `
        <div class="book-pane" data-book-id="${opts.id}">
          ${opts.coverSrc ? `<img src="${opts.coverSrc}" />` : ''}
          <a href="/books/${opts.id}">${opts.title ?? 'Edition Title'}</a>
          <div class="edition-info">
            <p>Format: ${opts.format ?? 'Hardcover'}</p>
            <p>Language: ${opts.language ?? 'English'}</p>
            ${opts.isbn ? `<p>ISBN/UID: ${opts.isbn}</p>` : ''}
            ${opts.publisher ? `<p>Publisher: ${opts.publisher}</p>` : ''}
            ${opts.publicationDate ? `<p>Edition Publication Date: ${opts.publicationDate}</p>` : ''}
          </div>
          <p class="text-xs font-light">${opts.pages != null ? `${opts.pages} pages` : ''}</p>
        </div>
      `;
    }

    it('parses editions with format, pages, audio flag, and language', async () => {
      const html =
        editionPaneHtml({ id: 'ed-1', title: 'Hardcover Edition', format: 'Hardcover', pages: 688, language: 'English' }) +
        editionPaneHtml({ id: 'ed-2', title: 'Audiobook Edition', format: 'Audio', pages: undefined, language: 'English' });
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html });

      const result = await makeService().getEditions(1, cookies, 'canonical-id');

      expect(result).toEqual([
        {
          id: 'ed-1',
          title: 'Hardcover Edition',
          format: 'Hardcover',
          pages: 688,
          isAudio: false,
          language: 'English',
          isbn: null,
          publisher: null,
          publicationDate: null,
          coverUrl: null,
        },
        {
          id: 'ed-2',
          title: 'Audiobook Edition',
          format: 'Audio',
          pages: null,
          isAudio: true,
          language: 'English',
          isbn: null,
          publisher: null,
          publicationDate: null,
          coverUrl: null,
        },
      ]);
      expect(mockClient.get).toHaveBeenCalledWith(1, cookies, '/books/canonical-id/editions');
    });

    it('parses distinguishing identifiers: isbn, publisher, publication date, and cover', async () => {
      const html =
        editionPaneHtml({
          id: 'ed-1',
          format: 'Hardcover',
          pages: 478,
          isbn: '9781234567890',
          publisher: 'Ace Books',
          publicationDate: '12 March 2024',
          coverSrc: '/covers/ed-1.jpg',
        }) +
        editionPaneHtml({
          id: 'ed-2',
          format: 'Hardcover',
          pages: 478,
          isbn: '9780987654321',
          coverSrc: 'https://cdn.thestorygraph.com/covers/ed-2.jpg',
        });
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html });

      const result = await makeService().getEditions(1, cookies, 'canonical-id');

      expect(result[0]).toMatchObject({
        id: 'ed-1',
        isbn: '9781234567890',
        publisher: 'Ace Books',
        publicationDate: '12 March 2024',
        coverUrl: 'https://app.thestorygraph.com/covers/ed-1.jpg',
      });
      expect(result[1]).toMatchObject({
        id: 'ed-2',
        isbn: '9780987654321',
        publisher: null,
        coverUrl: 'https://cdn.thestorygraph.com/covers/ed-2.jpg',
      });
    });

    it('returns an empty list when the session is invalid', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: true, html: '' });
      const result = await makeService().getEditions(1, cookies, 'canonical-id');
      expect(result).toEqual([]);
    });

    it('returns an empty list when the request throws', async () => {
      mockClient.get.mockRejectedValue(new Error('network error'));
      const result = await makeService().getEditions(1, cookies, 'canonical-id');
      expect(result).toEqual([]);
    });
  });

  describe('switchEdition', () => {
    it('returns true without making requests when the ids are the same', async () => {
      const result = await makeService().switchEdition(1, cookies, 'same-id', 'same-id');
      expect(result).toBe(true);
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('fetches a fresh CSRF token and posts the switch', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html></html>' });
      mockClient.extractCsrfToken.mockReturnValue('csrf-token');
      mockClient.post.mockResolvedValue({ status: 302, redirectedToSignIn: false, html: '' });

      const result = await makeService().switchEdition(1, cookies, 'from-id', 'to-id');

      expect(result).toBe(true);
      expect(mockClient.get).toHaveBeenCalledWith(1, cookies, '/books/from-id/editions');
      expect(mockClient.post).toHaveBeenCalledWith(1, cookies, '/switch-editions', { from_book_id: 'from-id', to_book_id: 'to-id' }, 'csrf-token');
    });

    it('returns false when the editions page is not reachable', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: true, html: '' });
      const result = await makeService().switchEdition(1, cookies, 'from-id', 'to-id');
      expect(result).toBe(false);
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('returns false when no CSRF token can be extracted', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html></html>' });
      mockClient.extractCsrfToken.mockReturnValue(null);
      const result = await makeService().switchEdition(1, cookies, 'from-id', 'to-id');
      expect(result).toBe(false);
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('returns false when the switch request fails', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html></html>' });
      mockClient.extractCsrfToken.mockReturnValue('csrf-token');
      mockClient.post.mockResolvedValue({ status: 500, redirectedToSignIn: false, html: '' });
      const result = await makeService().switchEdition(1, cookies, 'from-id', 'to-id');
      expect(result).toBe(false);
    });

    it('returns false when the request throws', async () => {
      mockClient.get.mockRejectedValue(new Error('network error'));
      const result = await makeService().switchEdition(1, cookies, 'from-id', 'to-id');
      expect(result).toBe(false);
    });
  });
});
