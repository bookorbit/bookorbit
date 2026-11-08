import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import type { BookCard } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BookService } from '../book/book.service';
import type { VisualMatchCandidate } from './visual-match.core';
import type { VisualMatchRepository } from './visual-match.repository';
import { VisualMatchService } from './visual-match.service';

const USER = { id: 7, isSuperuser: false } as RequestUser;
const SCOPE = sql`scope`;

const card = (id: number, title: string): BookCard => ({ id, title }) as BookCard;

const LIBRARY: VisualMatchCandidate[] = [
  { bookId: 1, title: 'The Name of the Wind', subtitle: null, authors: ['Patrick Rothfuss'] },
  { bookId: 2, title: "The Wise Man's Fear", subtitle: null, authors: ['Patrick Rothfuss'] },
  { bookId: 3, title: 'The Name of the Wind', subtitle: null, authors: ['Patrick Rothfuss'] },
];

function makeService(options: { isbnIds?: number[]; titleIds?: number[]; authorIds?: number[]; visible?: number[] } = {}) {
  const visible = new Set(options.visible ?? [1, 2, 3]);
  const books = {
    accessibleBooksWhere: vi.fn().mockResolvedValue(SCOPE),
    findCardsByIds: vi.fn((_user: RequestUser, ids: number[]) =>
      Promise.resolve(ids.filter((id) => visible.has(id)).map((id) => card(id, LIBRARY.find((book) => book.bookId === id)?.title ?? ''))),
    ),
  };
  const repo = {
    findByIsbn: vi.fn().mockResolvedValue(options.isbnIds ?? []),
    findByTitle: vi.fn().mockResolvedValue(options.titleIds ?? [1, 2, 3]),
    findByAuthor: vi.fn().mockResolvedValue({ bookIds: options.authorIds ?? [1, 2, 3], names: ['Patrick Rothfuss'] }),
    loadCandidates: vi.fn((ids: number[]) => Promise.resolve(LIBRARY.filter((book) => ids.includes(book.bookId)).reverse())),
    countHighlights: vi.fn().mockResolvedValue(new Map([[1, 23]])),
  };
  return {
    books,
    repo,
    service: new VisualMatchService(books as unknown as BookService, repo as unknown as VisualMatchRepository),
  };
}

describe('VisualMatchService', () => {
  it('names the books a cover shows, with the reader’s highlights', async () => {
    const { service, books, repo } = makeService();
    const response = await service.match(USER, { lines: ['THE NAME OF THE WIND', 'PATRICK ROTHFUSS'] });

    expect(response.matches.map((match) => match.book.id)).toEqual([1, 3]);
    expect(response.matches[0]).toMatchObject({ matchedBy: 'text', highlightCount: 23 });
    expect(response.matches[0].confidence).toBeGreaterThan(0.9);
    expect(response.matches[1].highlightCount).toBe(0);
    expect(response.author).toBe('Patrick Rothfuss');
    expect(books.accessibleBooksWhere).toHaveBeenCalledWith(USER);
    expect(repo.findByTitle).toHaveBeenCalledWith(SCOPE, expect.arrayContaining(['the name of the wind']), expect.any(Array), expect.any(Number));
    expect(repo.countHighlights).toHaveBeenCalledWith(7, [1, 3]);
  });

  it('puts a barcode match first and adds other copies of the title after it', async () => {
    const { service, repo } = makeService({ isbnIds: [3] });
    const response = await service.match(USER, { lines: ['THE NAME OF THE WIND', 'PATRICK ROTHFUSS'], isbn: '978-0-7564-0474-1' });

    expect(repo.findByIsbn).toHaveBeenCalledWith(SCOPE, { isbn13: '9780756404741', isbn10: '0756404746' }, 4);
    expect(response.matches.map((match) => [match.book.id, match.matchedBy])).toEqual([
      [3, 'isbn'],
      [1, 'text'],
    ]);
  });

  it('answers a barcode alone without reading titles', async () => {
    const { service, repo } = makeService({ isbnIds: [2] });
    const response = await service.match(USER, { lines: [], isbn: '0756404746' });

    expect(response.matches.map((match) => match.book.id)).toEqual([2]);
    expect(repo.findByTitle).not.toHaveBeenCalled();
    expect(response.author).toBeNull();
  });

  it('leaves out a book the reader may not see', async () => {
    const { service } = makeService({ visible: [3] });
    const response = await service.match(USER, { lines: ['THE NAME OF THE WIND', 'PATRICK ROTHFUSS'] });
    expect(response.matches.map((match) => match.book.id)).toEqual([3]);
  });

  it('returns no matches and touches nothing when no line is readable', async () => {
    const { service, books } = makeService();
    await expect(service.match(USER, { lines: ['', '12', '*'], isbn: 'abc' })).resolves.toEqual({ matches: [], author: null });
    expect(books.accessibleBooksWhere).not.toHaveBeenCalled();
  });

  it('returns no matches when nothing in the library is like the cover', async () => {
    const { service } = makeService();
    const response = await service.match(USER, { lines: ['FRESH COFFEE', 'OPEN 7 DAYS'] });
    expect(response).toEqual({ matches: [], author: null });
  });

  it('passes a repository failure on', async () => {
    const { service, repo } = makeService();
    repo.findByTitle.mockRejectedValue(new Error('db down'));
    await expect(service.match(USER, { lines: ['THE NAME OF THE WIND'] })).rejects.toThrow('db down');
  });
});
