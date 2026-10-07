import { NOTEBOOK_ENTRY_KINDS, type ContentFilterRules, type NotebookEntryKind } from '@bookorbit/types';

import { buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';

export const NOTEBOOK_ORIGINS = ['web', 'koreader', 'kobo'] as const;
export type NotebookOrigin = (typeof NOTEBOOK_ORIGINS)[number];

/** Ties between entries written in the same microsecond break on kind, in this order. */
export const NOTEBOOK_KIND_RANK: Record<NotebookEntryKind, number> = { highlight: 0, journal: 1, bookmark: 2, review: 3 };

export function notebookKindForRank(rank: number): NotebookEntryKind {
  const kind = NOTEBOOK_ENTRY_KINDS.find((candidate) => NOTEBOOK_KIND_RANK[candidate] === rank);
  if (!kind) throw new RangeError(`Unknown notebook kind rank ${rank}`);
  return kind;
}

/** What a reader may see: the libraries they can open, narrowed by any content rules on their account. */
export interface NotebookScope {
  userId: number;
  libraryIds: number[];
  contentFilters?: ContentFilterRules;
}

/** The parsed entry filters. Every field is absent rather than false when it does not filter. */
export interface NotebookEntryFilters {
  starred?: true;
  colors?: string[];
  hasNote?: true;
  approximate?: true;
  origins?: NotebookOrigin[];
  bookId?: number;
  /** A ready LIKE pattern: wrapped in `%` with `%`, `_` and `\` in the term escaped. */
  searchPattern?: string;
}

export interface NotebookFiltersInput {
  starred?: boolean;
  colors?: string;
  hasNote?: boolean;
  approximate?: boolean;
  origins?: NotebookOrigin[];
  bookId?: number;
  q?: string;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
  return parts.length > 0 ? parts : undefined;
}

export function toNotebookFilters(input: NotebookFiltersInput): NotebookEntryFilters {
  const term = input.q?.trim();
  return {
    ...(input.starred && { starred: true as const }),
    ...(splitList(input.colors) && { colors: splitList(input.colors) }),
    ...(input.hasNote && { hasNote: true as const }),
    ...(input.approximate && { approximate: true as const }),
    ...(input.origins && input.origins.length > 0 && { origins: [...new Set(input.origins)] }),
    ...(input.bookId !== undefined && { bookId: input.bookId }),
    ...(term && { searchPattern: buildSearchPattern(term) }),
  };
}

/** Highlight-only filters leave every other kind out while set. */
export function hasHighlightOnlyFilter(filters: NotebookEntryFilters): boolean {
  return filters.starred === true || (filters.colors?.length ?? 0) > 0 || filters.approximate === true;
}

/**
 * The kinds a request can return, in rank order. Journal entries and reviews have no origin of
 * their own and count as `web`, so an origin filter without `web` leaves them out.
 */
export function resolveNotebookKinds(requested: readonly NotebookEntryKind[] | undefined, filters: NotebookEntryFilters): NotebookEntryKind[] {
  const wanted = new Set(requested && requested.length > 0 ? requested : NOTEBOOK_ENTRY_KINDS);
  const highlightOnly = hasHighlightOnlyFilter(filters);
  const webOnlyKindsAllowed = !filters.origins || filters.origins.includes('web');
  return NOTEBOOK_ENTRY_KINDS.filter((kind) => {
    if (!wanted.has(kind)) return false;
    if (highlightOnly && kind !== 'highlight') return false;
    if ((kind === 'journal' || kind === 'review') && !webOnlyKindsAllowed) return false;
    return true;
  });
}
