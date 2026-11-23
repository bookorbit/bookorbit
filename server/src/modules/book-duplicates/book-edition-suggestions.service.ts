import { Injectable } from '@nestjs/common';
import type { BookEditionSuggestion, BookEditionSuggestions, EditionSuggestionReason } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { differsAsEdition, toEditionFacts } from './book-duplicate-editions';
import { canonicalSeriesIndex, crossFormatPersonKey, crossFormatTitleKey } from './book-duplicate-normalize';
import { BookEditionSuggestionsRepository, type EditionSuggestionRow } from './book-edition-suggestions.repository';

/** Rows the search narrows to before judging; a common title can bring several look-alikes that are not editions. */
const CANDIDATE_LIMIT = 40;
/** Suggestions shown at once. The picker searches for anything further. */
const SUGGESTION_LIMIT = 8;

export type EditionSuggestionVerdict = Pick<BookEditionSuggestion, 'kind' | 'reasons'>;

function onlyOneMedium(facts: { ebook: boolean; audio: boolean }): boolean {
  return facts.ebook !== facts.audio;
}

/**
 * Judges one candidate the way a duplicate scan would. An ebook and an audiobook of one work are
 * another format. Two records of one medium are another edition only when a fact both carry
 * differs; a shared ISBN, or nothing that differs, is a duplicate copy, which is not offered. Two
 * positions in one series are different volumes whatever their titles say.
 */
export function judgeEditionSuggestion(source: EditionSuggestionRow, candidate: EditionSuggestionRow): EditionSuggestionVerdict | null {
  const sourceIndex = canonicalSeriesIndex(source.series_index);
  const candidateIndex = canonicalSeriesIndex(candidate.series_index);
  if (source.series_id !== null && source.series_id === candidate.series_id && sourceIndex && candidateIndex && sourceIndex !== candidateIndex) {
    return null;
  }

  const a = toEditionFacts(source);
  const b = toEditionFacts(candidate);
  const sameWork = a.workIds.some((id) => b.workIds.includes(id));
  const titleKey = crossFormatTitleKey(source.title);
  const people = new Set([...source.authors, ...source.narrators].map(crossFormatPersonKey).filter((key) => key.length > 0));
  const titleAuthor =
    titleKey.length > 0 &&
    titleKey === crossFormatTitleKey(candidate.title) &&
    [...candidate.authors, ...candidate.narrators].some((name) => people.has(crossFormatPersonKey(name)));
  if (!sameWork && !titleAuthor) return null;
  const reasons: EditionSuggestionReason[] = [...(sameWork ? ['same_work' as const] : []), ...(titleAuthor ? ['title_author' as const] : [])];

  if (onlyOneMedium(a) && onlyOneMedium(b) && a.audio !== b.audio) return { kind: 'other_format', reasons };
  const sameMedium = (a.audio && b.audio) || (a.ebook && b.ebook);
  if (!sameMedium || (a.isbn !== null && a.isbn === b.isbn) || !differsAsEdition(a, b)) return null;
  return { kind: 'other_edition', reasons };
}

@Injectable()
export class BookEditionSuggestionsService {
  constructor(
    private readonly repo: BookEditionSuggestionsRepository,
    private readonly bookService: BookService,
    private readonly libraryService: LibraryService,
  ) {}

  /**
   * Books in libraries this user may edit that look like other editions of this one, strongest
   * first. Only books the user could add are offered, and none they dismissed in Duplicate Books.
   */
  async suggest(bookId: number, user: RequestUser): Promise<BookEditionSuggestions> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const source = await this.repo.findSource(bookId);
    if (!source) return { items: [] };

    const libraryIds = await this.libraryService.findEditableLibraryIds(user);
    const candidates = await this.repo.findCandidates({ source, libraryIds, user, limit: CANDIDATE_LIMIT });
    const dismissed = await this.repo.findDismissedPartners(
      user.id,
      bookId,
      candidates.map((row) => row.id),
    );

    const verdicts = candidates
      .filter((row) => !dismissed.has(row.id))
      .flatMap((row) => {
        const verdict = judgeEditionSuggestion(source, row);
        return verdict ? [{ id: row.id, ...verdict }] : [];
      })
      .sort((left, right) => right.reasons.length - left.reasons.length)
      .slice(0, SUGGESTION_LIMIT);

    const cards = new Map(
      (
        await this.bookService.findCardsByIds(
          user,
          verdicts.map(({ id }) => id),
        )
      ).map((card) => [card.id, card]),
    );
    return {
      items: verdicts.flatMap(({ id, kind, reasons }) => {
        const book = cards.get(id);
        return book ? [{ book, kind, reasons }] : [];
      }),
    };
  }
}
