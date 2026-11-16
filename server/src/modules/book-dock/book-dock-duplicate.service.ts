import { Injectable } from '@nestjs/common';
import { normalizeWorkToken, type BookDockMetadata, type ContentFilterRules } from '@bookorbit/types';

import { normalizeMetadataIsbn } from '../../common/text-match/isbn-normalize';
import { acceptsFormats, hasFolderOfItsOwn, joinKeysFor } from './book-dock-join.service';
import { BookDockRepository, type BookDockJoinCandidateRow, type EditionIdKeys } from './book-dock.repository';

/** Why a docked file is taken to be a book a library already holds, strongest first. */
export type DuplicateMatchReason = 'isbn' | 'edition_id' | 'work_id' | 'title_author';

/** Reasons that name the same edition or work. A title with an agreeing author does not. */
export const IDENTIFIER_MATCH_REASONS: ReadonlySet<DuplicateMatchReason> = new Set(['isbn', 'edition_id', 'work_id']);

export interface DuplicateCheckInput {
  fileId: number;
  metadata: BookDockMetadata | null;
  /** Every content format the file would place, lowercased. */
  formats: string[];
}

export interface DuplicateMatch {
  bookId: number;
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
  storedAsFile: boolean;
  title: string | null;
  reason: DuplicateMatchReason;
  /** The book lacks the file's formats and has a folder of its own, so the file could join it as another format. */
  canTakeFormat: boolean;
}

interface MatchKeys {
  isbn13s: string[];
  isbn10s: string[];
  hardcoverIds: string[];
  openLibraryIds: string[];
  edition: EditionIdKeys;
  titleKeys: string[];
  authorTokens: Set<string>;
}

const REASON_ORDER: DuplicateMatchReason[] = ['isbn', 'edition_id', 'work_id', 'title_author'];

/**
 * Whether a docked file is a book a library already holds (D29). Matches the same way the join
 * suggestions do, plus edition ids, and keeps every library a file matches in so a caller can tell
 * the library it is headed for from the others. A few indexed lookups per batch, never per file.
 */
@Injectable()
export class BookDockDuplicateService {
  constructor(private readonly repo: BookDockRepository) {}

  /**
   * For each file, its best match in each of `libraryIds`, strongest reason first. Content filters
   * hide books the viewer may not see; the system checks every book.
   */
  async findMatches(
    inputs: DuplicateCheckInput[],
    libraryIds: number[],
    contentFilters?: ContentFilterRules,
  ): Promise<Map<number, DuplicateMatch[]>> {
    const result = new Map<number, DuplicateMatch[]>();
    if (inputs.length === 0 || libraryIds.length === 0) return result;

    const keyed = inputs.map((input) => ({ input, keys: matchKeysFor(input.metadata) }));
    const all = keyed.map((entry) => entry.keys);
    const [byIsbn, byEdition, byWork, byTitle] = await Promise.all([
      this.repo.findJoinCandidatesByIsbn(libraryIds, unique(all.flatMap((k) => k.isbn13s)), unique(all.flatMap((k) => k.isbn10s)), contentFilters),
      this.repo.findJoinCandidatesByEditionId(
        libraryIds,
        {
          amazonIds: unique(all.flatMap((k) => k.edition.amazonIds)),
          audibleIds: unique(all.flatMap((k) => k.edition.audibleIds)),
          googleBooksIds: unique(all.flatMap((k) => k.edition.googleBooksIds)),
          goodreadsIds: unique(all.flatMap((k) => k.edition.goodreadsIds)),
        },
        contentFilters,
      ),
      this.repo.findJoinCandidatesByWorkId(
        libraryIds,
        unique(all.flatMap((k) => k.hardcoverIds)),
        unique(all.flatMap((k) => k.openLibraryIds)),
        contentFilters,
      ),
      this.repo.findJoinCandidatesByTitle(libraryIds, unique(all.flatMap((k) => k.titleKeys)), contentFilters),
    ]);
    const candidates: Record<DuplicateMatchReason, BookDockJoinCandidateRow[]> = {
      isbn: byIsbn,
      edition_id: byEdition,
      work_id: byWork,
      title_author: byTitle,
    };
    const bookIds = unique(REASON_ORDER.flatMap((reason) => candidates[reason].map((row) => row.bookId)));
    if (bookIds.length === 0) return result;
    const [authorsByBook, formatsByBook] = await Promise.all([
      byTitle.length ? this.repo.findAuthorNamesByBookIds(unique(byTitle.map((row) => row.bookId))) : Promise.resolve(new Map<number, string[]>()),
      this.repo.findContentFormatsByBookIds(bookIds),
    ]);

    for (const { input, keys } of keyed) {
      const best = new Map<number, DuplicateMatch>();
      for (const reason of REASON_ORDER) {
        for (const row of candidates[reason]) {
          if (best.has(row.libraryId) || !matches(reason, row, keys, authorsByBook.get(row.bookId) ?? [])) continue;
          best.set(row.libraryId, {
            bookId: row.bookId,
            libraryId: row.libraryId,
            libraryFolderId: row.libraryFolderId,
            folderPath: row.folderPath,
            storedAsFile: row.storedAsFile,
            title: row.title,
            reason,
            canTakeFormat: acceptsFormats(formatsByBook.get(row.bookId) ?? [], input.formats) && hasFolderOfItsOwn(row, row.libraryFolderPath),
          });
        }
      }
      if (best.size > 0)
        result.set(
          input.fileId,
          [...best.values()].sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason)),
        );
    }
    return result;
  }

  /**
   * For each file, the other libraries among `libraryIds` that already hold it (D29): a note on the
   * list, never a hold. The library a file is headed for is left out, because that match holds it.
   * At most `limit` names per file, strongest match first.
   */
  async otherLibraryNames(
    files: Array<{ fileId: number; metadata: BookDockMetadata | null; targetLibraryId: number | null }>,
    libraryIds: number[],
    contentFilters?: ContentFilterRules,
    limit = 3,
  ): Promise<Map<number, string[]>> {
    const matches = await this.findMatches(
      files.map((file) => ({ fileId: file.fileId, metadata: file.metadata, formats: [] })),
      libraryIds,
      contentFilters,
    );
    const targetOf = new Map(files.map((file) => [file.fileId, file.targetLibraryId]));
    const others = new Map<number, number[]>();
    for (const [fileId, found] of matches) {
      const ids = found
        .filter((match) => match.libraryId !== targetOf.get(fileId))
        .slice(0, limit)
        .map((match) => match.libraryId);
      if (ids.length > 0) others.set(fileId, ids);
    }

    const names = await this.repo.findLibraryNames(unique([...others.values()].flat()));
    const result = new Map<number, string[]>();
    for (const [fileId, ids] of others) {
      const named = ids.map((id) => names.get(id)).filter((name): name is string => name !== undefined);
      if (named.length > 0) result.set(fileId, named);
    }
    return result;
  }
}

function matches(reason: DuplicateMatchReason, row: BookDockJoinCandidateRow, keys: MatchKeys, authors: string[]): boolean {
  switch (reason) {
    case 'isbn':
      return keys.isbn13s.includes(normalizeMetadataIsbn(row.isbn13)) || keys.isbn10s.includes(normalizeMetadataIsbn(row.isbn10));
    case 'edition_id':
      return (
        sameId(row.amazonId, keys.edition.amazonIds) ||
        sameId(row.audibleId, keys.edition.audibleIds) ||
        sameId(row.googleBooksId, keys.edition.googleBooksIds) ||
        sameId(row.goodreadsId, keys.edition.goodreadsIds)
      );
    case 'work_id':
      return sameId(row.hardcoverId, keys.hardcoverIds) || sameId(row.openLibraryId, keys.openLibraryIds);
    case 'title_author':
      // A shared title is not a shared book: an author has to agree too.
      return (
        row.titleKey !== null && keys.titleKeys.includes(row.titleKey) && authors.some((name) => keys.authorTokens.has(normalizeWorkToken(name)))
      );
  }
}

function matchKeysFor(metadata: BookDockMetadata | null): MatchKeys {
  const join = joinKeysFor(metadata);
  return {
    ...join,
    edition: {
      // ASINs are upper case wherever they come from; the other ids are compared as stored.
      amazonIds: idVariants(metadata?.amazonId, true),
      audibleIds: idVariants(metadata?.audibleId, true),
      googleBooksIds: idVariants(metadata?.googleBooksId, false),
      goodreadsIds: idVariants(metadata?.goodreadsId, false),
    },
  };
}

/** The id as tagged, and upper-cased where the id is case-insensitive, so the exact index finds either spelling. */
function idVariants(value: unknown, caseInsensitive: boolean): string[] {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) return [];
  return caseInsensitive ? unique([id, id.toUpperCase()]) : [id];
}

function sameId(stored: string | null, ids: string[]): boolean {
  const id = stored?.trim().toLowerCase();
  return !!id && ids.some((candidate) => candidate.toLowerCase() === id);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}
