import { Injectable, Logger } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';

import {
  SHELF_MATCH_MAX_RESULTS,
  VISUAL_MATCH_MAX_RESULTS,
  type BookCard,
  type ShelfMatchRequest,
  type ShelfMatchResponse,
  type VisualMatch,
  type VisualMatchRequest,
  type VisualMatchResponse,
  type VisualMatchSource,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { bestAuthorName, coverLines, coverPhrases, normalizeIsbn, rankCandidates } from './visual-match.core';
import { VisualMatchRepository } from './visual-match.repository';

/** Lines, in reading order, that go into the index lookups. The scoring reads all of them. */
const SEARCH_LINES = 12;
/** Most books the title lookup hands to scoring. */
const TITLE_CANDIDATES = 120;
/** Most book and author pairs the author lookup hands to scoring. */
const AUTHOR_CANDIDATES = 300;
/** Spines matched at once. Each costs three queries, so a full shelf never floods the pool. */
const SHELF_CONCURRENCY = 4;

/** A phrase worth an index lookup: some letters beyond the small words every title shares. */
function isSearchable(phrase: string): boolean {
  return phrase.replace(/\b(?:the|a|an|of|and)\b/g, '').replace(/[^\p{L}\p{N}]/gu, '').length >= 4;
}

interface RankedBook {
  bookId: number;
  confidence: number;
  matchedBy: VisualMatchSource;
}

interface TextMatch {
  ranked: readonly RankedBook[];
  /** A library author the lines name, or null. */
  author: string | null;
  /** Books scored, after any already found another way are left out. */
  candidateCount: number;
}

const NO_TEXT_MATCH: TextMatch = { ranked: [], author: null, candidateCount: 0 };

/** The ranked books that have a card, with the reader's highlights in each. */
function toMatches(ranked: readonly RankedBook[], cardById: ReadonlyMap<number, BookCard>, highlights: ReadonlyMap<number, number>): VisualMatch[] {
  return ranked.flatMap((book) => {
    const card = cardById.get(book.bookId);
    return card ? [{ book: card, confidence: book.confidence, matchedBy: book.matchedBy, highlightCount: highlights.get(book.bookId) ?? 0 }] : [];
  });
}

@Injectable()
export class VisualMatchService {
  private readonly logger = new Logger(VisualMatchService.name);

  constructor(
    private readonly books: BookService,
    private readonly repo: VisualMatchRepository,
  ) {}

  /**
   * The books in the user's libraries that a photographed cover or spine shows. A barcode's ISBN
   * wins outright; the cover's words then add any other copy of the same title, such as the
   * audiobook beside the ebook. Only books the user may see are ever returned.
   */
  async match(user: RequestUser, request: VisualMatchRequest): Promise<VisualMatchResponse> {
    const event = 'visual_match.match';
    const startedAt = Date.now();
    try {
      const isbn = normalizeIsbn(request.isbn);
      const lines = coverLines(request.lines);
      if (!isbn && lines.length === 0) return { matches: [], author: null };

      const scope = await this.books.accessibleBooksWhere(user);
      const ranked: RankedBook[] = [];
      if (isbn) {
        const ids = await this.repo.findByIsbn(scope, isbn, VISUAL_MATCH_MAX_RESULTS);
        ranked.push(...ids.map((bookId) => ({ bookId, confidence: 1, matchedBy: 'isbn' as const })));
      }

      const text =
        lines.length > 0
          ? await this.matchText(scope, request.lines, lines, new Set(ranked.map((book) => book.bookId)), VISUAL_MATCH_MAX_RESULTS)
          : NO_TEXT_MATCH;
      ranked.push(...text.ranked);
      const { author, candidateCount } = text;

      const top = ranked.slice(0, VISUAL_MATCH_MAX_RESULTS);
      const ids = top.map((book) => book.bookId);
      const [cards, highlights] = await Promise.all([this.books.findCardsByIds(user, ids), this.repo.countHighlights(user.id, ids)]);
      const matches = toMatches(top, new Map(cards.map((card) => [card.id, card])), highlights);

      this.logger.log(
        `[${event}] [end] userId=${user.id} lines=${lines.length} isbn=${isbn ? 'yes' : 'no'} candidates=${candidateCount} matches=${matches.length} durationMs=${Date.now() - startedAt} - visual match finished`,
      );
      return { matches, author };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[${event}] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - visual match failed`,
      );
      throw error;
    }
  }

  /**
   * For each spine of a photographed shelf, the books in the user's libraries it shows, one result
   * per spine in the request's order, a spine with nothing readable or nothing matched included. The
   * spines share one visibility scope and are matched a few at a time; the cards and highlight
   * counts for every book matched on any spine then load in one pass.
   */
  async matchShelf(user: RequestUser, request: ShelfMatchRequest): Promise<ShelfMatchResponse> {
    const event = 'shelf_match.match';
    const startedAt = Date.now();
    try {
      const spines = request.spines.map((spine) => ({ id: spine.id, rawLines: spine.lines, lines: coverLines(spine.lines) }));
      const readable = spines.filter((spine) => spine.lines.length > 0).length;
      if (readable === 0) return { results: spines.map((spine) => ({ id: spine.id, matches: [], author: null })) };

      const scope = await this.books.accessibleBooksWhere(user);
      const texts = await mapWithConcurrency(spines, SHELF_CONCURRENCY, (spine) =>
        spine.lines.length > 0
          ? this.matchText(scope, spine.rawLines, spine.lines, new Set(), SHELF_MATCH_MAX_RESULTS)
          : Promise.resolve(NO_TEXT_MATCH),
      );

      const ids = [...new Set(texts.flatMap((text) => text.ranked.map((book) => book.bookId)))];
      const [cards, highlights] = await Promise.all([this.books.findCardsByIds(user, ids), this.repo.countHighlights(user.id, ids)]);
      const cardById = new Map(cards.map((card) => [card.id, card]));
      const results = spines.map((spine, index) => ({
        id: spine.id,
        matches: toMatches(texts[index].ranked.slice(0, SHELF_MATCH_MAX_RESULTS), cardById, highlights),
        author: texts[index].author,
      }));

      const matched = results.filter((result) => result.matches.length > 0).length;
      this.logger.log(
        `[${event}] [end] userId=${user.id} spines=${spines.length} readable=${readable} candidates=${texts.reduce((sum, text) => sum + text.candidateCount, 0)} matchedSpines=${matched} books=${cards.length} durationMs=${Date.now() - startedAt} - shelf match finished`,
      );
      return { results };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[${event}] [fail] userId=${user.id} spines=${request.spines.length} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - shelf match failed`,
      );
      throw error;
    }
  }

  /**
   * The books one cover's or spine's words name, best first, at most `limit`. `lines` are the
   * readable `coverLines` of `rawLines` and never empty; `exclude` holds books already found
   * another way, such as by barcode.
   */
  private async matchText(
    scope: SQL | undefined,
    rawLines: readonly string[],
    lines: readonly string[],
    exclude: ReadonlySet<number>,
    limit: number,
  ): Promise<TextMatch> {
    const searchLines = lines.slice(0, SEARCH_LINES);
    const phrases = coverPhrases(searchLines, 2)
      .map((phrase) => phrase.text)
      .filter(isSearchable);
    const fragments = searchLines.filter((line) => line.includes(' ') && isSearchable(line));
    const [titleIds, byAuthor] = await Promise.all([
      this.repo.findByTitle(scope, phrases, fragments, TITLE_CANDIDATES),
      this.repo.findByAuthor(
        scope,
        searchLines.filter((line) => line.replace(/\s/g, '').length >= 4),
        AUTHOR_CANDIDATES,
      ),
    ]);
    const author = bestAuthorName(byAuthor.names, rawLines);

    const ids = [...new Set([...titleIds, ...byAuthor.bookIds])].filter((id) => !exclude.has(id));
    const order = new Map(ids.map((id, index) => [id, index]));
    const candidates = (await this.repo.loadCandidates(ids)).sort((a, b) => (order.get(a.bookId) ?? 0) - (order.get(b.bookId) ?? 0));
    const scores = rankCandidates(candidates, rawLines, limit);
    return {
      ranked: scores.map((score) => ({ bookId: score.bookId, confidence: Math.round(score.score * 100) / 100, matchedBy: 'text' as const })),
      author,
      candidateCount: ids.length,
    };
  }
}
