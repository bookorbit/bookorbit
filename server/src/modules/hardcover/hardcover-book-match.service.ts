import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { HardcoverEdition as HardcoverEditionSummary } from '@bookorbit/types';

import { parsePublishedDateKey } from '../../common/utils/published-date.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookSyncData } from './hardcover.repository';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverRepository } from './hardcover.repository';

export interface HardcoverBookMatch {
  hardcoverBookId: number;
  hardcoverEditionId: number | null;
  editionPages: number | null;
  matchMethod: 'isbn' | 'title' | 'cached' | 'metadata_id';
}

const FIND_BOOK_BY_ISBN13_QUERY = `
query FindBookByISBN13($isbn: String!) {
  books(where: { editions: { isbn_13: { _eq: $isbn } } }, limit: 1) {
    id
    editions(where: { isbn_13: { _eq: $isbn } }, limit: 1) {
      id
      pages
    }
  }
}`;

const FIND_BOOK_BY_ISBN10_QUERY = `
query FindBookByISBN10($isbn: String!) {
  books(where: { editions: { isbn_10: { _eq: $isbn } } }, limit: 1) {
    id
    editions(where: { isbn_10: { _eq: $isbn } }, limit: 1) {
      id
      pages
    }
  }
}`;

const SEARCH_BOOKS_QUERY = `
query SearchBooks($query: String!) {
  search(
    query: $query
    query_type: "Book"
    per_page: 5
    page: 1
    fields: "title,author_names,alternative_titles"
    weights: "5,2,1"
  ) {
    ids
  }
}`;

const EDITION_SELECTION_LIMIT = 50;
const EDITION_FIELDS = `
      id
      pages
      isbn_10
      isbn_13
      audio_seconds`;

const FIND_BOOKS_BY_IDS_QUERY = `
query FindBooksByIds($ids: [Int!]!) {
  books(where: { id: { _in: $ids } }, limit: 5) {
    id
    editions(limit: ${EDITION_SELECTION_LIMIT}) {${EDITION_FIELDS}
    }
  }
}`;

const FIND_BOOK_BY_HARDCOVER_ID_QUERY = `
query FindBookById($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id
    editions(limit: ${EDITION_SELECTION_LIMIT}) {${EDITION_FIELDS}
    }
  }
}`;

const FIND_BOOK_BY_HARDCOVER_SLUG_QUERY = `
query FindBookBySlug($slug: String!) {
  books(where: { slug: { _eq: $slug } }, limit: 1) {
    id
    editions(limit: ${EDITION_SELECTION_LIMIT}) {${EDITION_FIELDS}
    }
  }
}`;

const FIND_BOOK_EDITIONS_BY_HARDCOVER_ID_QUERY = `
query FindBookEditionsById($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id
    editions(limit: ${EDITION_SELECTION_LIMIT}) {${EDITION_FIELDS}
    }
  }
}`;

const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'aax', 'aacx', 'aac', 'flac', 'ogg', 'opus', 'wma', 'mka']);

interface HardcoverEdition {
  id: number;
  pages?: number | null;
  isbn_10?: string | null;
  isbn_13?: string | null;
  audio_seconds?: number | null;
}

interface BooksQueryResult {
  books: Array<{
    id: number;
    editions?: HardcoverEdition[];
  }>;
}

// Hardcover reading_format_id: 1 = physical, 2 = audiobook, 4 = ebook.
const AUDIOBOOK_READING_FORMAT_ID = 2;
const EBOOK_READING_FORMAT_ID = 4;

const EDITION_DISPLAY_FIELDS = `
      id
      title
      pages
      isbn_10
      isbn_13
      publisher { name }
      language { code2 }
      release_date
      release_year
      reading_format_id
      audio_seconds
      image { url }`;

const FIND_BOOK_EDITIONS_FOR_DISPLAY_QUERY = `
query FindBookEditionsForDisplay($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id
    editions(limit: ${EDITION_SELECTION_LIMIT}) {${EDITION_DISPLAY_FIELDS}
    }
  }
}`;

interface HardcoverEditionDisplayRow {
  id: number;
  title?: string | null;
  pages?: number | null;
  isbn_10?: string | null;
  isbn_13?: string | null;
  publisher?: { name?: string | null } | null;
  language?: { code2?: string | null } | null;
  release_date?: string | null;
  release_year?: number | null;
  reading_format_id?: number | null;
  audio_seconds?: number | null;
  image?: { url?: string | null } | null;
}

interface BooksDisplayQueryResult {
  books: Array<{
    id: number;
    editions?: HardcoverEditionDisplayRow[];
  }>;
}

function editionFormatLabel(edition: HardcoverEditionDisplayRow): string {
  if (edition.reading_format_id === AUDIOBOOK_READING_FORMAT_ID || (edition.audio_seconds ?? 0) > 0) return 'Audiobook';
  if (edition.reading_format_id === EBOOK_READING_FORMAT_ID) return 'E-Book';
  return 'Physical Book';
}

function mapEditionForDisplay(edition: HardcoverEditionDisplayRow): HardcoverEditionSummary {
  return {
    id: edition.id,
    title: edition.title ?? null,
    format: editionFormatLabel(edition),
    pages: typeof edition.pages === 'number' && edition.pages > 0 ? edition.pages : null,
    isbn10: edition.isbn_10 ?? null,
    isbn13: edition.isbn_13 ?? null,
    publisher: edition.publisher?.name ?? null,
    language: edition.language?.code2 ?? null,
    publishedDate: parsePublishedDateKey(edition.release_date) ?? null,
    coverUrl: edition.image?.url ?? null,
  };
}

interface SearchBooksResult {
  search?: {
    ids?: number[];
  } | null;
}

@Injectable()
export class HardcoverBookMatchService {
  private readonly logger = new Logger(HardcoverBookMatchService.name);

  constructor(
    private readonly repo: HardcoverRepository,
    private readonly client: HardcoverClientService,
  ) {}

  async matchBook(userId: number, token: string, book: BookSyncData): Promise<HardcoverBookMatch | null> {
    const cached = await this.repo.findBookState(userId, book.bookId);
    if (cached?.hardcoverBookId && !cached.matchError) {
      const cachedMatch = await this.resolveCachedMatch(userId, token, book, cached.hardcoverBookId, cached.hardcoverEditionId ?? null);

      if ((cached.hardcoverEditionId ?? null) !== cachedMatch.hardcoverEditionId) {
        await this.repo.upsertBookState({
          userId,
          bookId: book.bookId,
          hardcoverBookId: cached.hardcoverBookId,
          hardcoverEditionId: cachedMatch.hardcoverEditionId,
          matchMethod: 'cached',
          matchError: null,
        });
      }

      return {
        hardcoverBookId: cached.hardcoverBookId,
        hardcoverEditionId: cachedMatch.hardcoverEditionId,
        editionPages: cachedMatch.editionPages,
        matchMethod: 'cached',
      };
    }

    let match: HardcoverBookMatch | null = null;

    if (book.hardcoverMetadataId) {
      const id = parseInt(book.hardcoverMetadataId, 10);
      if (!isNaN(id)) {
        match = await this.matchByHardcoverId(userId, token, id, book);
      } else {
        match = await this.matchByHardcoverSlug(userId, token, book.hardcoverMetadataId, book);
      }
    }

    if (!match && book.isbn13) {
      match = await this.matchByIsbn(userId, token, book.isbn13, book.bookId, 13);
    }

    if (!match && book.isbn10) {
      match = await this.matchByIsbn(userId, token, book.isbn10, book.bookId, 10);
    }

    if (!match && book.title && book.authorName) {
      match = await this.matchByTitleAuthor(userId, token, book.title, book.authorName, book);
    }

    if (match) {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: match.hardcoverBookId,
        hardcoverEditionId: match.hardcoverEditionId ?? null,
        matchMethod: match.matchMethod,
        matchError: null,
      });
    } else {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: null,
        matchError: 'no_match',
      });
    }

    return match;
  }

  private async matchByHardcoverId(userId: number, token: string, id: number, book: BookSyncData): Promise<HardcoverBookMatch | null> {
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOK_BY_HARDCOVER_ID_QUERY, { id });
      const hardcoverBook = data.books?.[0];
      if (!hardcoverBook) return null;
      const edition = this.pickBestEdition(hardcoverBook.editions ?? [], book);
      return {
        hardcoverBookId: hardcoverBook.id,
        hardcoverEditionId: edition?.id ?? null,
        editionPages: this.normalizeEditionPages(edition?.pages),
        matchMethod: 'metadata_id',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${book.bookId} method=metadata_id error="${error}" - metadata_id lookup failed`,
      );
      return null;
    }
  }

  private async matchByHardcoverSlug(userId: number, token: string, slug: string, book: BookSyncData): Promise<HardcoverBookMatch | null> {
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOK_BY_HARDCOVER_SLUG_QUERY, { slug });
      const hardcoverBook = data.books?.[0];
      if (!hardcoverBook) return null;
      const edition = this.pickBestEdition(hardcoverBook.editions ?? [], book);
      return {
        hardcoverBookId: hardcoverBook.id,
        hardcoverEditionId: edition?.id ?? null,
        editionPages: this.normalizeEditionPages(edition?.pages),
        matchMethod: 'metadata_id',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${book.bookId} method=metadata_slug error="${error}" - metadata_slug lookup failed`,
      );
      return null;
    }
  }

  private async matchByIsbn(userId: number, token: string, isbn: string, bookId: number, version: 10 | 13): Promise<HardcoverBookMatch | null> {
    const query = version === 13 ? FIND_BOOK_BY_ISBN13_QUERY : FIND_BOOK_BY_ISBN10_QUERY;
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, query, { isbn });
      const hardcoverBook = data.books?.[0];
      if (!hardcoverBook) return null;
      const edition = hardcoverBook.editions?.[0];
      return {
        hardcoverBookId: hardcoverBook.id,
        hardcoverEditionId: edition?.id ?? null,
        editionPages: this.normalizeEditionPages(edition?.pages),
        matchMethod: 'isbn',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[hardcover.book_match] [fail] userId=${userId} bookId=${bookId} method=isbn${version} error="${error}" - ISBN lookup failed`);
      return null;
    }
  }

  private async matchByTitleAuthor(
    userId: number,
    token: string,
    title: string,
    author: string,
    book: BookSyncData,
  ): Promise<HardcoverBookMatch | null> {
    try {
      const searchData = await this.client.query<SearchBooksResult>(userId, token, SEARCH_BOOKS_QUERY, {
        query: `${title} ${author}`,
      });
      const ids = searchData.search?.ids?.filter((id) => Number.isInteger(id)).slice(0, 5) ?? [];
      if (ids.length === 0) return null;

      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOKS_BY_IDS_QUERY, { ids });
      const booksById = new Map((data.books ?? []).map((candidate) => [candidate.id, candidate]));
      const hardcoverBook = ids.map((id) => booksById.get(id)).find((candidate): candidate is BooksQueryResult['books'][number] => candidate != null);
      if (!hardcoverBook) return null;
      const edition = this.pickBestEdition(hardcoverBook.editions ?? [], book);
      return {
        hardcoverBookId: hardcoverBook.id,
        hardcoverEditionId: edition?.id ?? null,
        editionPages: this.normalizeEditionPages(edition?.pages),
        matchMethod: 'title',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${book.bookId} method=title_author error="${error}" - title lookup failed`,
      );
      return null;
    }
  }

  // A failed upstream lookup must not be reported as "no editions" - the caller (and the user)
  // needs to be able to tell an empty catalog apart from a provider outage and retry.
  async listEditions(userId: number, token: string, hardcoverBookId: number): Promise<HardcoverEditionSummary[]> {
    const startedAt = Date.now();
    let data: BooksDisplayQueryResult;
    try {
      data = await this.client.query<BooksDisplayQueryResult>(userId, token, FIND_BOOK_EDITIONS_FOR_DISPLAY_QUERY, { id: hardcoverBookId });
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.list_editions] [fail] userId=${userId} hardcoverBookId=${hardcoverBookId} durationMs=${Date.now() - startedAt} errorClass=${err?.constructor?.name ?? 'Error'} error="${error}" - edition list lookup failed`,
      );
      throw new InternalServerErrorException('Failed to load Hardcover editions');
    }

    const hardcoverBook = data.books?.[0];
    if (!hardcoverBook?.editions) return [];
    return hardcoverBook.editions.map(mapEditionForDisplay);
  }

  private async resolveCachedMatch(
    userId: number,
    token: string,
    book: BookSyncData,
    hardcoverBookId: number,
    cachedEditionId: number | null,
  ): Promise<{ hardcoverEditionId: number | null; editionPages: number | null }> {
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOK_EDITIONS_BY_HARDCOVER_ID_QUERY, {
        id: hardcoverBookId,
      });
      const hardcoverBook = data.books?.[0];
      if (!hardcoverBook) {
        return { hardcoverEditionId: cachedEditionId, editionPages: null };
      }

      const editions = hardcoverBook.editions ?? [];

      // A missing page count is not a reason to silently re-point the user's edition.
      if (cachedEditionId != null) {
        const cachedEdition = editions.find((edition) => edition.id === cachedEditionId);
        if (cachedEdition) {
          return { hardcoverEditionId: cachedEditionId, editionPages: this.normalizeEditionPages(cachedEdition.pages) };
        }
      }

      const edition = this.pickBestEdition(editions, book);
      if (!edition) {
        return { hardcoverEditionId: cachedEditionId, editionPages: null };
      }
      return { hardcoverEditionId: edition.id, editionPages: this.normalizeEditionPages(edition.pages) };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${book.bookId} method=cached_pages error="${error}" - cached edition pages lookup failed`,
      );
      return { hardcoverEditionId: cachedEditionId, editionPages: null };
    }
  }

  /**
   * Choose the edition that best represents the local book. Priority:
   * 1. exact ISBN match (strongest, most specific signal),
   * 2. format alignment (don't track an audiobook against a text file, etc.),
   * 3. closest page count to the local book,
   * 4. presence of a page count (needed for page-based progress),
   * 5. stable fallback to Hardcover's own ordering.
   */
  private pickBestEdition(editions: HardcoverEdition[], book: BookSyncData): HardcoverEdition | undefined {
    if (editions.length === 0) return undefined;

    if (book.isbn13) {
      const isbnMatch = editions.find((edition) => edition.isbn_13 && edition.isbn_13 === book.isbn13);
      if (isbnMatch) return isbnMatch;
    }
    if (book.isbn10) {
      const isbnMatch = editions.find((edition) => edition.isbn_10 && edition.isbn_10 === book.isbn10);
      if (isbnMatch) return isbnMatch;
    }

    let best = editions[0]!;
    for (let i = 1; i < editions.length; i++) {
      if (this.isBetterEdition(editions[i]!, best, book)) best = editions[i]!;
    }
    return best;
  }

  private isBetterEdition(candidate: HardcoverEdition, current: HardcoverEdition, book: BookSyncData): boolean {
    const wantAudio = this.localIsAudio(book.format);
    const candidateAligned = this.editionIsAudio(candidate) === wantAudio;
    const currentAligned = this.editionIsAudio(current) === wantAudio;
    if (candidateAligned !== currentAligned) return candidateAligned;

    const candidatePages = this.normalizeEditionPages(candidate.pages);
    const currentPages = this.normalizeEditionPages(current.pages);

    if (book.pageCount != null) {
      if ((candidatePages != null) !== (currentPages != null)) return candidatePages != null;
      if (candidatePages != null && currentPages != null) {
        const candidateDelta = Math.abs(candidatePages - book.pageCount);
        const currentDelta = Math.abs(currentPages - book.pageCount);
        if (candidateDelta !== currentDelta) return candidateDelta < currentDelta;
      }
      return false;
    }

    if ((candidatePages != null) !== (currentPages != null)) return candidatePages != null;
    return false;
  }

  private editionIsAudio(edition: HardcoverEdition): boolean {
    return typeof edition.audio_seconds === 'number' && edition.audio_seconds > 0;
  }

  private localIsAudio(format: string | null): boolean {
    if (!format) return false;
    return AUDIO_FORMATS.has(format.toLowerCase());
  }

  private normalizeEditionPages(pages: number | null | undefined): number | null {
    if (typeof pages !== 'number' || !Number.isFinite(pages) || pages <= 0) return null;
    return Math.round(pages);
  }
}
