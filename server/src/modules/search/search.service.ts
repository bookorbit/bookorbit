import { Injectable } from '@nestjs/common';

import type { AuthorSummary, BookCard, GlobalSearchHit, GlobalSearchMatchField, GlobalSearchResponse, SeriesSummary } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { AuthorsService } from '../authors/authors.service';
import { BookService } from '../book/book.service';
import { SeriesService } from '../series/series.service';
import { GlobalSearchDto } from './dto/global-search.dto';

type MatchCandidate = {
  field: GlobalSearchMatchField;
  text: string | null;
  weight: number;
};

@Injectable()
export class SearchService {
  constructor(
    private readonly bookService: BookService,
    private readonly authorsService: AuthorsService,
    private readonly seriesService: SeriesService,
  ) {}

  async search(user: RequestUser, dto: GlobalSearchDto): Promise<GlobalSearchResponse> {
    const query = dto.q.trim();
    const limit = dto.limit ?? 5;
    const bookQuery = {
      q: query,
      sort: [{ field: 'relevance' as const, dir: 'desc' as const }],
      pagination: { page: 0, size: limit },
    };

    const [books, authors, series] = await Promise.all([
      dto.libraryId ? this.bookService.queryForLibrary(user, dto.libraryId, bookQuery) : this.bookService.globalQuery(user, bookQuery),
      this.authorsService.findAll(user, {
        q: query,
        page: 0,
        size: limit,
        sort: 'relevance',
        order: 'desc',
        libraryId: dto.libraryId,
      }),
      this.seriesService.findAll(user, {
        q: query,
        page: 0,
        size: limit,
        sort: 'relevance',
        order: 'desc',
        libraryId: dto.libraryId,
      }),
    ]);

    return {
      query,
      books: {
        items: books.items.map((book) => this.bookHit(book, query)),
        total: books.total,
      },
      authors: {
        items: authors.items.map((author) => this.authorHit(author, query)),
        total: authors.total,
      },
      series: {
        items: series.items.map((item) => this.seriesHit(item, query)),
        total: series.total,
      },
    };
  }

  private bookHit(book: BookCard, query: string): GlobalSearchHit<BookCard> {
    return hitFromCandidates(
      query,
      [
        { field: 'title', text: book.title, weight: 1 },
        ...book.authors.map((text) => ({ field: 'author' as const, text, weight: 0.8 })),
        { field: 'series', text: book.seriesName, weight: 0.7 },
        ...(book.seriesMemberships ?? []).map((membership) => ({ field: 'series' as const, text: membership.seriesName, weight: 0.7 })),
        ...book.narrators.map((text) => ({ field: 'narrator' as const, text, weight: 0.5 })),
      ],
      book,
    );
  }

  private authorHit(author: AuthorSummary, query: string): GlobalSearchHit<AuthorSummary> {
    return hitFromCandidates(query, [{ field: 'name', text: author.name, weight: 1 }], author);
  }

  private seriesHit(series: SeriesSummary, query: string): GlobalSearchHit<SeriesSummary> {
    return hitFromCandidates(
      query,
      [{ field: 'name', text: series.name, weight: 1 }, ...series.authors.map((text) => ({ field: 'author' as const, text, weight: 0.8 }))],
      series,
    );
  }
}

function hitFromCandidates<T>(query: string, candidates: MatchCandidate[], item: T): GlobalSearchHit<T> {
  const best = candidates
    .filter((candidate): candidate is MatchCandidate & { text: string } => Boolean(candidate.text))
    .map((candidate) => ({ candidate, score: textScore(candidate.text, query) * candidate.weight }))
    .sort((a, b) => b.score - a.score)[0]?.candidate;

  return {
    item,
    matchedField: best?.field ?? 'name',
    matchedText: best?.text ?? null,
  };
}

function textScore(value: string, query: string): number {
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  if (normalizedValue === normalizedQuery) return 1;
  if (normalizedValue.startsWith(normalizedQuery)) return 0.85;
  if (normalizedValue.includes(normalizedQuery)) return 0.65;
  return trigramSimilarity(normalizedValue, normalizedQuery) * 0.4;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) shared += 1;
  }
  return (2 * shared) / (a.size + b.size);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const result = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}
