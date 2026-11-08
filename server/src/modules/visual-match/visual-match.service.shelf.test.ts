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

const book = (bookId: number, title: string, authors: string[]): VisualMatchCandidate => ({ bookId, title, subtitle: null, authors });

const LIBRARY: VisualMatchCandidate[] = [
  book(1, 'The Name of the Wind', ['Patrick Rothfuss']),
  book(2, 'Dune', ['Frank Herbert']),
  book(3, 'Dune', ['Frank Herbert']),
  book(4, 'Circe', ['Madeline Miller']),
  book(5, 'Leviathan Wakes', ['James S. A. Corey']),
  ...Array.from({ length: 6 }, (_, index) => book(10 + index, 'Project Hail Mary', ['Andy Weir'])),
];

/**
 * Every lookup hands the whole library to scoring, so the real matcher decides; `visible` stands
 * in for the reader's libraries and content filters, which only `findCardsByIds` applies here.
 */
function makeService(options: { visible?: number[] } = {}) {
  const visible = new Set(options.visible ?? LIBRARY.map((candidate) => candidate.bookId));
  const allIds = LIBRARY.map((candidate) => candidate.bookId);
  const books = {
    accessibleBooksWhere: vi.fn().mockResolvedValue(SCOPE),
    findCardsByIds: vi.fn((_user: RequestUser, ids: number[]) =>
      Promise.resolve(
        ids
          .filter((id) => visible.has(id))
          .map((id) => ({ id, title: LIBRARY.find((candidate) => candidate.bookId === id)?.title ?? '' }) as BookCard),
      ),
    ),
  };
  const repo = {
    findByIsbn: vi.fn().mockResolvedValue([]),
    findByTitle: vi.fn().mockResolvedValue(allIds),
    findByAuthor: vi.fn().mockResolvedValue({ bookIds: allIds, names: [...new Set(LIBRARY.flatMap((candidate) => candidate.authors))] }),
    loadCandidates: vi.fn((ids: number[]) => Promise.resolve(LIBRARY.filter((candidate) => ids.includes(candidate.bookId)))),
    countHighlights: vi.fn().mockResolvedValue(new Map([[1, 12]])),
  };
  return {
    books,
    repo,
    service: new VisualMatchService(books as unknown as BookService, repo as unknown as VisualMatchRepository),
  };
}

const matchedIds = (result: { matches: { book: BookCard }[] }) => result.matches.map((match) => match.book.id);

describe('VisualMatchService.matchShelf', () => {
  it('answers every spine in the request’s order, matched, unmatched and unreadable alike', async () => {
    const { service } = makeService();
    const response = await service.matchShelf(USER, {
      spines: [
        { id: 'b', lines: ['DUNE', 'HERBERT', 'ACE'] },
        { id: 'a', lines: ['FRESH COFFEE', 'OPEN 7 DAYS'] },
        { id: 'z', lines: ['', '12', '*'] },
        { id: 'c', lines: ['THE NAME OF THE WIND ROTHFUSS'] },
        { id: 'd', lines: [] },
        { id: 'e', lines: ['CIRCE MADELINE MILLER'] },
      ],
    });

    expect(response.results.map((result) => result.id)).toEqual(['b', 'a', 'z', 'c', 'd', 'e']);
    expect(response.results.map(matchedIds)).toEqual([[2, 3], [], [], [1], [], [4]]);
    expect(response.results[1]).toEqual({ id: 'a', matches: [], author: null });
    expect(response.results[2]).toEqual({ id: 'z', matches: [], author: null });
    expect(response.results[4]).toEqual({ id: 'd', matches: [], author: null });
    expect(response.results[3].matches[0]).toMatchObject({ matchedBy: 'text', highlightCount: 12 });
    expect(response.results[3].matches[0].confidence).toBeGreaterThan(0.9);
    expect(response.results[5].author).toBe('Madeline Miller');
  });

  it('returns no results and touches nothing for an empty shelf', async () => {
    const { service, books, repo } = makeService();
    await expect(service.matchShelf(USER, { spines: [] })).resolves.toEqual({ results: [] });
    expect(books.accessibleBooksWhere).not.toHaveBeenCalled();
    expect(repo.findByTitle).not.toHaveBeenCalled();
    expect(books.findCardsByIds).not.toHaveBeenCalled();
  });

  it('answers spines with nothing readable without touching the database', async () => {
    const { service, books, repo } = makeService();
    const response = await service.matchShelf(USER, {
      spines: [
        { id: 's1', lines: ['', '7'] },
        { id: 's2', lines: [] },
      ],
    });

    expect(response).toEqual({
      results: [
        { id: 's1', matches: [], author: null },
        { id: 's2', matches: [], author: null },
      ],
    });
    expect(books.accessibleBooksWhere).not.toHaveBeenCalled();
    expect(repo.countHighlights).not.toHaveBeenCalled();
  });

  it('resolves the reader’s scope once and looks up every readable spine within it', async () => {
    const { service, books, repo } = makeService();
    await service.matchShelf(USER, {
      spines: [
        { id: 's1', lines: ['DUNE', 'HERBERT'] },
        { id: 's2', lines: [] },
        { id: 's3', lines: ['CIRCE', 'MILLER'] },
      ],
    });

    expect(books.accessibleBooksWhere).toHaveBeenCalledTimes(1);
    expect(books.accessibleBooksWhere).toHaveBeenCalledWith(USER);
    expect(repo.findByTitle).toHaveBeenCalledTimes(2);
    expect(repo.findByAuthor).toHaveBeenCalledTimes(2);
    for (const call of [...repo.findByTitle.mock.calls, ...repo.findByAuthor.mock.calls]) expect(call[0]).toBe(SCOPE);
  });

  it('loads cards and highlights once, for every book matched on any spine', async () => {
    const { service, books, repo } = makeService();
    const response = await service.matchShelf(USER, {
      spines: [
        { id: 's1', lines: ['DUNE', 'HERBERT'] },
        { id: 's2', lines: ['THE NAME OF THE WIND', 'ROTHFUSS'] },
        { id: 's3', lines: ['DUNE FRANK HERBERT'] },
      ],
    });

    expect(books.findCardsByIds).toHaveBeenCalledTimes(1);
    expect(books.findCardsByIds).toHaveBeenCalledWith(USER, [2, 3, 1]);
    expect(repo.countHighlights).toHaveBeenCalledTimes(1);
    expect(repo.countHighlights).toHaveBeenCalledWith(7, [2, 3, 1]);
    expect(response.results.map(matchedIds)).toEqual([[2, 3], [1], [2, 3]]);
  });

  it('names at most four books for one spine', async () => {
    const { service } = makeService();
    const response = await service.matchShelf(USER, { spines: [{ id: 's1', lines: ['PROJECT HAIL MARY', 'WEIR'] }] });
    expect(matchedIds(response.results[0])).toEqual([10, 11, 12, 13]);
  });

  it('leaves out a book the reader may not see', async () => {
    const { service } = makeService({ visible: [3, 4] });
    const response = await service.matchShelf(USER, {
      spines: [
        { id: 's1', lines: ['DUNE', 'HERBERT'] },
        { id: 's2', lines: ['LEVIATHAN WAKES', 'COREY', 'ORBIT'] },
      ],
    });
    expect(response.results.map(matchedIds)).toEqual([[3], []]);
  });

  it('keeps no more than four spines in flight', async () => {
    const { service, repo } = makeService();
    let inFlight = 0;
    let peak = 0;
    repo.findByTitle.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return [];
    });

    const spines = Array.from({ length: 40 }, (_, index) => ({ id: `s${index}`, lines: ['DUNE', 'HERBERT'] }));
    const response = await service.matchShelf(USER, { spines });

    expect(repo.findByTitle).toHaveBeenCalledTimes(40);
    expect(peak).toBe(4);
    expect(response.results).toHaveLength(40);
  });

  it('passes a repository failure on', async () => {
    const { service, repo } = makeService();
    repo.findByAuthor.mockRejectedValue(new Error('db down'));
    await expect(service.matchShelf(USER, { spines: [{ id: 's1', lines: ['DUNE', 'HERBERT'] }] })).rejects.toThrow('db down');
  });
});
