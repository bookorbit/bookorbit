import type { StorygraphEdition } from '@bookorbit/types';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { STORYGRAPH_BASE_URL } from './storygraph.constants';
import { StorygraphClientService, type StorygraphCookies } from './storygraph-client.service';
import type { BookSyncData } from './storygraph.repository';
import { StorygraphRepository } from './storygraph.repository';

export interface StorygraphBookMatch {
  storygraphBookId: string;
  matchMethod: 'isbn' | 'title' | 'cached';
}

interface CandidateQuality {
  editionCount: number;
  isUserAdded: boolean;
  isAudio: boolean;
}

// StoryGraph's search results can surface sparse, user-submitted duplicate entries (or a
// differently-formatted entry, e.g. an audiobook when the local file is text) above the entry
// that actually matches what's in the user's library. We can't tell candidates apart from the
// search listing alone, so we fetch a few top candidates' own pages and pick the best one.
const MAX_MATCH_CANDIDATES = 3;

const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'aax', 'aacx', 'aac', 'flac', 'ogg', 'opus', 'wma', 'mka']);

@Injectable()
export class StorygraphBookMatchService {
  private readonly logger = new Logger(StorygraphBookMatchService.name);

  constructor(
    private readonly repo: StorygraphRepository,
    private readonly client: StorygraphClientService,
  ) {}

  async matchBook(userId: number, cookies: StorygraphCookies, book: BookSyncData): Promise<StorygraphBookMatch | null> {
    const cached = await this.repo.findBookState(userId, book.bookId);
    if (cached?.storygraphBookId && !cached.matchError) {
      return { storygraphBookId: cached.storygraphBookId, matchMethod: 'cached' };
    }

    let match: StorygraphBookMatch | null = null;

    if (book.isbn13) {
      match = await this.searchForBook(userId, cookies, book.isbn13, book, 'isbn');
    }

    if (!match && book.isbn10) {
      match = await this.searchForBook(userId, cookies, book.isbn10, book, 'isbn');
    }

    if (!match && book.title && book.authorName) {
      match = await this.searchForBook(userId, cookies, `${book.title} ${book.authorName}`, book, 'title');
    }

    if (match) {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: match.storygraphBookId,
        matchMethod: match.matchMethod,
        matchError: null,
      });
    } else {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: null,
        matchError: 'no_match',
      });
    }

    return match;
  }

  private async searchForBook(
    userId: number,
    cookies: StorygraphCookies,
    searchTerm: string,
    book: BookSyncData,
    matchMethod: 'isbn' | 'title',
  ): Promise<StorygraphBookMatch | null> {
    const startedAt = Date.now();
    try {
      const response = await this.client.get(userId, cookies, `/browse?search_term=${encodeURIComponent(searchTerm)}`);
      if (response.redirectedToSignIn || response.status !== 200) return null;

      const candidateIds = this.parseResultIds(response.html, MAX_MATCH_CANDIDATES);
      if (candidateIds.length === 0) return null;

      const bookId = await this.pickBestCandidate(userId, cookies, candidateIds, this.localIsAudio(book.format));

      return { storygraphBookId: bookId, matchMethod };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.book_match] [fail] userId=${userId} bookId=${book.bookId} method=${matchMethod} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - search failed`,
      );
      return null;
    }
  }

  private parseResultIds(html: string, limit: number): string[] {
    const $ = cheerio.load(html);
    const blocks = $('.book-title-author-and-series');
    const ids: string[] = [];

    for (let i = 0; i < blocks.length && ids.length < limit; i++) {
      const titleLink = $(blocks[i]).find("a[href^='/books/']").first();
      const href = titleLink.attr('href');
      if (!href) continue;

      const idMatch = /\/books\/([^/?]+)/.exec(href);
      if (!idMatch?.[1]) continue;

      ids.push(idMatch[1]);
    }

    return ids;
  }

  /**
   * Fetches each candidate's own book page and picks the best one: matching the local file's
   * format (text vs. audio) first, then preferring a canonical entry (not "user-added") with
   * more tracked editions. Falls back to the first candidate if every fetch fails.
   */
  private async pickBestCandidate(userId: number, cookies: StorygraphCookies, candidateIds: string[], wantAudio: boolean): Promise<string> {
    let best: { id: string; score: number } | null = null;

    for (const id of candidateIds) {
      try {
        const response = await this.client.get(userId, cookies, `/books/${id}`);
        if (response.redirectedToSignIn || response.status !== 200) continue;

        const score = this.scoreCandidateQuality(this.parseCandidateQuality(response.html), wantAudio);
        if (!best || score > best.score) best = { id, score };
      } catch {
        continue;
      }
    }

    return best?.id ?? candidateIds[0]!;
  }

  private parseCandidateQuality(html: string): CandidateQuality {
    const text = cheerio.load(html)('body').text();
    const editionMatch = /(\d+)\s+editions?\b/i.exec(text);
    const formatMatch = /Format:\s*([^\n•·|]+)/i.exec(text);
    return {
      editionCount: editionMatch ? parseInt(editionMatch[1]!, 10) : 1,
      isUserAdded: /user-added/i.test(text),
      isAudio: formatMatch ? /audio/i.test(formatMatch[1]!) : false,
    };
  }

  private scoreCandidateQuality(quality: CandidateQuality, wantAudio: boolean): number {
    const formatAligned = quality.isAudio === wantAudio;
    return (formatAligned ? 10_000_000 : 0) + (quality.isUserAdded ? 0 : 1_000_000) + quality.editionCount;
  }

  private localIsAudio(format: string | null): boolean {
    if (!format) return false;
    return AUDIO_FORMATS.has(format.toLowerCase());
  }

  /**
   * Resolves a manually-provided StoryGraph URL or book id directly, with no search/scoring
   * involved - the user is telling us exactly which book is correct, so we just verify it exists.
   */
  async resolveManualInput(userId: number, cookies: StorygraphCookies, input: string): Promise<{ storygraphBookId: string; title: string } | null> {
    const startedAt = Date.now();
    const bookId = this.extractBookIdFromInput(input);
    if (!bookId) return null;

    try {
      // The id can be pasted directly by the user, so encode it before putting it in the path.
      // A stray ?, #, or / would otherwise change which URL we request.
      const response = await this.client.get(userId, cookies, `/books/${encodeURIComponent(bookId)}`);
      if (response.redirectedToSignIn || response.status !== 200) return null;

      return { storygraphBookId: bookId, title: this.parseBookTitle(response.html) };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.manual_link] [fail] userId=${userId} input="${sanitizeLogValue(input)}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - resolve failed`,
      );
      return null;
    }
  }

  private extractBookIdFromInput(input: string): string {
    const value = input.trim();
    if (!value) return '';

    const urlMatch = /\/books\/([^/?#]+)/.exec(value);
    if (urlMatch?.[1]) return urlMatch[1];

    return value;
  }

  private parseBookTitle(html: string): string {
    const $ = cheerio.load(html);
    for (const selector of ['h1', "[data-testid='book-title']", '.book-title']) {
      const text = $(selector).first().text().trim();
      if (text) return text;
    }
    return '';
  }

  /**
   * Lists the editions tracked against a StoryGraph book (e.g. paperback, ebook, audiobook),
   * scraped from the book's dedicated /editions page.
   */
  async getEditions(userId: number, cookies: StorygraphCookies, storygraphBookId: string): Promise<StorygraphEdition[]> {
    const startedAt = Date.now();
    try {
      const response = await this.client.get(userId, cookies, `/books/${storygraphBookId}/editions`);
      if (response.redirectedToSignIn || response.status !== 200) return [];

      return this.parseEditions(response.html);
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.editions] [fail] userId=${userId} storygraphBookId=${storygraphBookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - failed to fetch editions`,
      );
      return [];
    }
  }

  private parseEditions(html: string): StorygraphEdition[] {
    const $ = cheerio.load(html);
    const editions: StorygraphEdition[] = [];

    $('.book-pane').each((_, el) => {
      const pane = $(el);
      const id = pane.attr('data-book-id');
      if (!id) return;

      const title = pane.find("a[href^='/books/']").first().text().trim();

      let format = '';
      let language = '';
      let isbn = '';
      let publisher = '';
      let publicationDate = '';
      pane.find('.edition-info p').each((_, p) => {
        const text = $(p).text().trim();
        if (text.includes('Format:')) format = text.replace(/.*Format:\s*/, '').trim();
        else if (text.includes('Language:')) language = text.replace(/.*Language:\s*/, '').trim();
        else if (/ISBN/i.test(text)) isbn = text.replace(/.*ISBN[^:]*:\s*/i, '').trim();
        else if (text.includes('Publisher:')) publisher = text.replace(/.*Publisher:\s*/, '').trim();
        else if (/publication date/i.test(text)) publicationDate = text.replace(/.*publication date:\s*/i, '').trim();
      });

      const detailText = pane.find('p.text-xs.font-light').first().text().trim();
      const pagesMatch = /(\d+)\s*pages?/i.exec(detailText);

      const coverSrc = pane.find('img').first().attr('src') ?? null;
      const coverUrl = coverSrc ? (coverSrc.startsWith('http') ? coverSrc : `${STORYGRAPH_BASE_URL}${coverSrc}`) : null;

      editions.push({
        id,
        title,
        format: format || 'Unknown',
        pages: pagesMatch ? parseInt(pagesMatch[1]!, 10) : null,
        isAudio: /audio/i.test(format),
        language: language || null,
        isbn: isbn || null,
        publisher: publisher || null,
        publicationDate: publicationDate || null,
        coverUrl,
      });
    });

    return editions;
  }

  /** Switches the StoryGraph book/edition currently tracked for this user, mirroring the site's own "switch editions" action. */
  async switchEdition(userId: number, cookies: StorygraphCookies, fromStorygraphBookId: string, toStorygraphBookId: string): Promise<boolean> {
    if (!fromStorygraphBookId || !toStorygraphBookId || fromStorygraphBookId === toStorygraphBookId) return true;

    const startedAt = Date.now();
    try {
      const page = await this.client.get(userId, cookies, `/books/${fromStorygraphBookId}/editions`);
      if (page.redirectedToSignIn || page.status !== 200) return false;

      const csrf = this.client.extractCsrfToken(page.html);
      if (!csrf) return false;

      const response = await this.client.post(
        userId,
        cookies,
        '/switch-editions',
        { from_book_id: fromStorygraphBookId, to_book_id: toStorygraphBookId },
        csrf,
      );

      return (response.status >= 200 && response.status < 300) || response.status === 302 || response.status === 303;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.switch_edition] [fail] userId=${userId} from=${fromStorygraphBookId} to=${toStorygraphBookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - switch failed`,
      );
      return false;
    }
  }
}
