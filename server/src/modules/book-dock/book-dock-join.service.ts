import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { resolve, sep } from 'path';
import {
  isAudioFormat,
  isBookDockJoinErrorCode,
  normalizeWorkToken,
  type BookDockJoinBook,
  type BookDockJoinErrorCode,
  type BookDockJoinSuggestion,
  type BookDockMetadata,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { canonicalIsbn13, isValidIsbn10, normalizeMetadataIsbn } from '../../common/text-match/isbn-normalize';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { BookDockRepository, type BookDockJoinCandidateRow } from './book-dock.repository';

/** The book a person asked a docked file to join, once it passed every check that needs no destination. */
export interface ResolvedJoinTarget {
  bookId: number;
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
  /** The book is its own file rather than a folder; see {@link hasFolderOfItsOwn}. */
  storedAsFile: boolean;
  summary: BookDockJoinBook;
}

/** One docked file that could become another format of a book already in `libraryId`. */
export interface JoinSuggestionInput {
  fileId: number;
  libraryId: number;
  metadata: BookDockMetadata | null;
  /** Every content format the file would place, lowercased. */
  formats: string[];
}

/** What a docked file is matched on. Each probe reads one indexed lookup for the whole batch. */
interface JoinKeys {
  isbn13s: string[];
  isbn10s: string[];
  /** Work-level provider ids as tagged and lowercased: the index compares exactly, the match does not. */
  hardcoverIds: string[];
  openLibraryIds: string[];
  titleKeys: string[];
  authorTokens: Set<string>;
}

interface JoinProbe {
  reason: BookDockJoinSuggestion['reason'];
  find: (libraryIds: number[], keys: JoinKeys[], requester: RequestUser) => Promise<BookDockJoinCandidateRow[]>;
  matches: (row: BookDockJoinCandidateRow, keys: JoinKeys, authors: string[]) => boolean;
}

const AUDIO_TITLE_MARKER =
  /\s*(?:[([]\s*(?:unabridged|audiobook|audio book)(?:\s+edition)?\s*[)\]]|[-:,]\s*(?:unabridged|audiobook)(?:\s+edition)?)\s*$/i;

export function joinError(code: BookDockJoinErrorCode, message: string): HttpException {
  if (code === 'BOOK_DOCK_JOIN_FORBIDDEN') return new ForbiddenException({ message, errorCode: code });
  if (code === 'BOOK_DOCK_JOIN_BOOK_NOT_FOUND') return new NotFoundException({ message, errorCode: code });
  return new BadRequestException({ message, errorCode: code });
}

/**
 * Whether another format can go into the book's folder: a real folder inside the library folder the
 * book is kept under. A book sitting loose at that folder's root is its own file, `folderPath` being
 * that file's path (or, for older rows, the root itself), so a format placed beside it would be a
 * book of its own. Finalize refuses a join by this rule and suggestions are filtered by it, so a
 * suggestion never names a book the join would refuse. `storedAsFile` is unknown, so left out, only
 * for a join another module resolved.
 */
export function hasFolderOfItsOwn(book: { folderPath: string; storedAsFile?: boolean }, libraryFolderPath: string): boolean {
  if (book.storedAsFile) return false;
  const root = resolve(libraryFolderPath);
  const bookFolder = resolve(book.folderPath);
  return bookFolder !== root && bookFolder.startsWith(root + sep);
}

export function joinErrorCodeOf(error: unknown): BookDockJoinErrorCode | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) return undefined;
  const code = (response as { errorCode?: unknown }).errorCode;
  return isBookDockJoinErrorCode(code) ? code : undefined;
}

/**
 * The lowercased titles a docked file could be filed under on a shelf: as tagged, without the audio
 * markers an audiobook's tags add ("Dune (Unabridged)"), and without a subtitle after a colon. Exact
 * keys, because `bm_title_lower_idx` serves only an exact `lower(title)`.
 */
export function joinTitleKeys(title: string | null | undefined): string[] {
  const base = (title ?? '').trim().toLowerCase();
  if (!base) return [];
  const keys = new Set([base]);
  const unmarked = base.replace(AUDIO_TITLE_MARKER, '').trim();
  if (unmarked) keys.add(unmarked);
  const colon = unmarked.indexOf(':');
  if (colon > 0) keys.add(unmarked.slice(0, colon).trim());
  return [...keys].filter(Boolean);
}

function isbn13To10(isbn13: string): string | null {
  if (!isbn13.startsWith('978')) return null;
  const body = isbn13.slice(3, 12);
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const check = (11 - (sum % 11)) % 11;
  return `${body}${check === 10 ? 'X' : String(check)}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function providerIdVariants(value: unknown): string[] {
  const id = text(value)?.trim();
  return id ? unique([id, id.toLowerCase()]) : [];
}

function sameProviderId(stored: string | null, ids: string[]): boolean {
  const id = stored?.trim().toLowerCase();
  return !!id && ids.some((candidate) => candidate.toLowerCase() === id);
}

/** Stored metadata is whatever a file's tags said, so every field is checked for its shape first. */
export function joinKeysFor(metadata: BookDockMetadata | null): JoinKeys {
  const isbn13s = new Set<string>();
  const isbn10s = new Set<string>();
  for (const value of [text(metadata?.isbn13), text(metadata?.isbn10)]) {
    const canonical = canonicalIsbn13(value);
    if (!canonical) continue;
    isbn13s.add(canonical);
    const short = isbn13To10(canonical);
    if (short) isbn10s.add(short);
  }
  const isbn10 = normalizeMetadataIsbn(text(metadata?.isbn10));
  if (isValidIsbn10(isbn10)) isbn10s.add(isbn10);

  const authors = Array.isArray(metadata?.authors) ? metadata.authors.filter((name): name is string => typeof name === 'string') : [];
  return {
    isbn13s: [...isbn13s],
    isbn10s: [...isbn10s],
    hardcoverIds: providerIdVariants(metadata?.hardcoverId),
    openLibraryIds: providerIdVariants(metadata?.openLibraryId),
    titleKeys: joinTitleKeys(text(metadata?.title)),
    authorTokens: new Set(authors.map((name) => normalizeWorkToken(name)).filter(Boolean)),
  };
}

/** Whether a book could take the file as another format: never a second copy of a format, never a second audio set. */
function acceptsFormats(bookFormats: string[], fileFormats: string[]): boolean {
  if (fileFormats.some((format) => bookFormats.includes(format))) return false;
  return !(fileFormats.some((format) => isAudioFormat(format)) && bookFormats.some((format) => isAudioFormat(format)));
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/**
 * Adding a docked file to a book already on the shelf: checking a book a person picked, and
 * suggesting one when the file looks like another format of it. Suggestions are bounded indexed
 * lookups per batch of files, never a walk over the library.
 */
@Injectable()
export class BookDockJoinService {
  private readonly probes: JoinProbe[] = [
    {
      reason: 'isbn',
      find: (libraryIds, keys, requester) =>
        this.repo.findJoinCandidatesByIsbn(
          libraryIds,
          unique(keys.flatMap((key) => key.isbn13s)),
          unique(keys.flatMap((key) => key.isbn10s)),
          this.contentFiltersFor(requester),
        ),
      matches: (row, keys) => keys.isbn13s.includes(normalizeMetadataIsbn(row.isbn13)) || keys.isbn10s.includes(normalizeMetadataIsbn(row.isbn10)),
    },
    {
      // Hardcover and Open Library ids name the work, so they hold across editions and media.
      reason: 'work_id',
      find: (libraryIds, keys, requester) =>
        this.repo.findJoinCandidatesByWorkId(
          libraryIds,
          unique(keys.flatMap((key) => key.hardcoverIds)),
          unique(keys.flatMap((key) => key.openLibraryIds)),
          this.contentFiltersFor(requester),
        ),
      matches: (row, keys) => sameProviderId(row.hardcoverId, keys.hardcoverIds) || sameProviderId(row.openLibraryId, keys.openLibraryIds),
    },
    {
      reason: 'title_author',
      find: (libraryIds, keys, requester) =>
        this.repo.findJoinCandidatesByTitle(libraryIds, unique(keys.flatMap((key) => key.titleKeys)), this.contentFiltersFor(requester)),
      // A shared title is not a shared book: an author has to agree too.
      matches: (row, keys, authors) =>
        row.titleKey !== null && keys.titleKeys.includes(row.titleKey) && authors.some((name) => keys.authorTokens.has(normalizeWorkToken(name))),
    },
  ];

  constructor(
    private readonly repo: BookDockRepository,
    private readonly bookService: BookService,
    private readonly libraryService: LibraryService,
  ) {}

  /**
   * The book a person picked, if they may add to it. Which library it must be in, and whether that
   * library keeps a folder per book, is for the caller, who knows where the file is headed.
   */
  async resolveRequested(bookId: number, requester: RequestUser | undefined, fileFormats: string[]): Promise<ResolvedJoinTarget> {
    if (!requester) throw joinError('BOOK_DOCK_JOIN_FORBIDDEN', 'Only a person can add a file to an existing book');
    try {
      await this.bookService.verifyBookAccess(bookId, requester, 'editor');
    } catch (error) {
      if (error instanceof ForbiddenException) throw joinError('BOOK_DOCK_JOIN_FORBIDDEN', 'You cannot edit the book this file was meant to join');
      if (error instanceof NotFoundException) throw joinError('BOOK_DOCK_JOIN_BOOK_NOT_FOUND', 'The book this file was meant to join was not found');
      throw error;
    }

    const target = await this.repo.findJoinTarget(bookId);
    if (!target) throw joinError('BOOK_DOCK_JOIN_BOOK_NOT_FOUND', 'The book this file was meant to join was not found');
    if (target.status !== 'present') throw joinError('BOOK_DOCK_JOIN_BOOK_MISSING', 'The book this file was meant to join is missing from disk');

    if (fileFormats.some((format) => isAudioFormat(format))) {
      const bookFormats = (await this.repo.findContentFormatsByBookIds([bookId])).get(bookId) ?? [];
      if (bookFormats.some((format) => isAudioFormat(format))) {
        throw joinError('BOOK_DOCK_JOIN_AUDIO_CONFLICT', 'The book this file was meant to join already has an audiobook');
      }
    }

    const authors = (await this.repo.findAuthorNamesByBookIds([bookId])).get(bookId) ?? [];
    return {
      bookId,
      libraryId: target.libraryId,
      libraryFolderId: target.libraryFolderId,
      folderPath: target.folderPath,
      storedAsFile: target.storedAsFile,
      summary: { bookId, title: target.title, authors },
    };
  }

  /** Whether the requester may add files to existing books in this library. Cached per call site through `cache`. */
  async canJoinIn(
    library: { id: number; organizationMode: string | null },
    requester: RequestUser,
    cache: Map<number, Promise<boolean>>,
  ): Promise<boolean> {
    if (library.organizationMode !== 'book_per_folder') return false;
    let answer = cache.get(library.id);
    if (!answer) {
      answer = this.libraryService.verifyAccessLevel(requester, library.id, 'editor').then(
        () => true,
        (error: unknown) => {
          if (error instanceof ForbiddenException) return false;
          throw error;
        },
      );
      cache.set(library.id, answer);
    }
    return answer;
  }

  /**
   * At most one book per file: ISBN first, then a shared work id, then the same title with an agreeing author. Books that
   * already hold one of the file's formats, or audio when the file is audio, are never suggested, and nor are books with
   * no folder of their own to share.
   */
  async suggest(inputs: JoinSuggestionInput[], requester: RequestUser): Promise<Map<number, BookDockJoinSuggestion>> {
    const suggestions = new Map<number, BookDockJoinSuggestion>();
    if (inputs.length === 0) return suggestions;

    const keyed = inputs.map((input) => ({ input, keys: joinKeysFor(input.metadata) }));
    const libraryIds = unique(inputs.map((input) => input.libraryId));
    const keys = keyed.map((entry) => entry.keys);
    // A book with no folder of its own cannot take another format, so it is never suggested.
    const found = (await Promise.all(this.probes.map((probe) => probe.find(libraryIds, keys, requester)))).map((rows) =>
      rows.filter((row) => hasFolderOfItsOwn(row, row.libraryFolderPath)),
    );

    const candidateIds = unique(found.flat().map((row) => row.bookId));
    if (candidateIds.length === 0) return suggestions;
    const [authorsByBook, formatsByBook] = await Promise.all([
      this.repo.findAuthorNamesByBookIds(candidateIds),
      this.repo.findContentFormatsByBookIds(candidateIds),
    ]);

    for (const { input, keys: fileKeys } of keyed) {
      for (const [index, probe] of this.probes.entries()) {
        const match = found[index]!.find(
          (row) =>
            row.libraryId === input.libraryId &&
            acceptsFormats(formatsByBook.get(row.bookId) ?? [], input.formats) &&
            probe.matches(row, fileKeys, authorsByBook.get(row.bookId) ?? []),
        );
        if (!match) continue;
        suggestions.set(input.fileId, {
          bookId: match.bookId,
          title: match.title,
          authors: authorsByBook.get(match.bookId) ?? [],
          reason: probe.reason,
        });
        break;
      }
    }
    return suggestions;
  }

  private contentFiltersFor(requester: RequestUser) {
    return requester.isSuperuser ? undefined : requester.contentFilters;
  }
}
