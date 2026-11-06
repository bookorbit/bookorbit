import { Injectable, Logger } from '@nestjs/common';

import {
  VISUAL_MATCH_MAX_RESULTS,
  type VisualMatch,
  type VisualMatchRequest,
  type VisualMatchResponse,
  type VisualMatchSource,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
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

/** A phrase worth an index lookup: some letters beyond the small words every title shares. */
function isSearchable(phrase: string): boolean {
  return phrase.replace(/\b(?:the|a|an|of|and)\b/g, '').replace(/[^\p{L}\p{N}]/gu, '').length >= 4;
}

interface RankedBook {
  bookId: number;
  confidence: number;
  matchedBy: VisualMatchSource;
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

      let author: string | null = null;
      let candidateCount = 0;
      if (lines.length > 0) {
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
        author = bestAuthorName(byAuthor.names, request.lines);

        const known = new Set(ranked.map((book) => book.bookId));
        const ids = [...new Set([...titleIds, ...byAuthor.bookIds])].filter((id) => !known.has(id));
        candidateCount = ids.length;
        const order = new Map(ids.map((id, index) => [id, index]));
        const candidates = (await this.repo.loadCandidates(ids)).sort((a, b) => (order.get(a.bookId) ?? 0) - (order.get(b.bookId) ?? 0));
        const scores = rankCandidates(candidates, request.lines, VISUAL_MATCH_MAX_RESULTS);
        ranked.push(
          ...scores.map((score) => ({ bookId: score.bookId, confidence: Math.round(score.score * 100) / 100, matchedBy: 'text' as const })),
        );
      }

      const top = ranked.slice(0, VISUAL_MATCH_MAX_RESULTS);
      const ids = top.map((book) => book.bookId);
      const [cards, highlights] = await Promise.all([this.books.findCardsByIds(user, ids), this.repo.countHighlights(user.id, ids)]);
      const cardById = new Map(cards.map((card) => [card.id, card]));
      const matches: VisualMatch[] = top.flatMap((book) => {
        const card = cardById.get(book.bookId);
        return card ? [{ book: card, confidence: book.confidence, matchedBy: book.matchedBy, highlightCount: highlights.get(book.bookId) ?? 0 }] : [];
      });

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
}
