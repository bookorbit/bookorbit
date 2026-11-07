import { BOOK_MERGE_FIELDS, type BookMergeField, type BookMergeFieldValue } from '@bookorbit/types';

/** What the merge reads of one book to decide each field. `metadata` is the `book_metadata` row, camel-cased. */
export interface BookFacts {
  bookId: number;
  metadata: Record<string, unknown> | null;
  lockedFields: ReadonlySet<string>;
  authors: string[];
  narrators: string[];
  series: Array<{ seriesId: number; name: string; seriesIndex: number | null; displayOrder: number }>;
  hasAudio: boolean;
}

interface FieldSpec {
  /** `book_metadata` properties copied as one unit. Empty for list fields stored in their own tables. */
  columns: string[];
  /** Lock fields guarding it (`BOOK_METADATA_LOCK_FIELDS`). */
  locks: string[];
  /** Follows the book that owns the audio content when there is one. */
  followsAudio?: boolean;
}

export const BOOK_MERGE_FIELD_SPECS: Record<BookMergeField, FieldSpec> = {
  title: { columns: ['title'], locks: ['title'] },
  subtitle: { columns: ['subtitle'], locks: ['subtitle'] },
  authors: { columns: [], locks: ['authors'] },
  description: { columns: ['description'], locks: ['description'] },
  publisher: { columns: ['publisher'], locks: ['publisher'] },
  publishedYear: { columns: ['publishedDate', 'publishedYear'], locks: ['publishedYear'] },
  language: { columns: ['language'], locks: ['language'] },
  pageCount: { columns: ['pageCount'], locks: ['pageCount'] },
  series: { columns: ['seriesId', 'seriesName', 'seriesIndex'], locks: ['seriesName', 'seriesIndex'] },
  isbn: { columns: ['isbn10', 'isbn13'], locks: ['isbn13', 'isbn10'] },
  narrators: { columns: [], locks: ['narrators'], followsAudio: true },
  googleBooksId: { columns: ['googleBooksId'], locks: ['googleBooksId'] },
  goodreadsId: { columns: ['goodreadsId'], locks: ['goodreadsId'] },
  amazonId: { columns: ['amazonId'], locks: ['amazonId'] },
  hardcoverId: { columns: ['hardcoverId', 'hardcoverEditionId'], locks: ['hardcoverId', 'hardcoverEditionId'] },
  openLibraryId: { columns: ['openLibraryId'], locks: ['openLibraryId'] },
  itunesId: { columns: ['itunesId'], locks: ['itunesId'] },
  audibleId: { columns: ['audibleId'], locks: ['audibleId'], followsAudio: true },
  librofmId: { columns: ['librofmId'], locks: ['librofmId'], followsAudio: true },
  koboId: { columns: ['koboId'], locks: ['koboId'] },
  comicvineId: { columns: ['comicvineId'], locks: ['comicvineId'] },
  ranobedbId: { columns: ['ranobedbId'], locks: ['ranobedbId'] },
  lubimyczytacId: { columns: ['lubimyczytacId'], locks: ['lubimyczytacId'] },
  aladinId: { columns: ['aladinId'], locks: ['aladinId'] },
};

/** Audio-edition columns that are not pickable but follow the audio owner (02-merge-rules.md 2.3). */
export const AUDIO_EDITION_COLUMNS = [
  'durationSeconds',
  'abridged',
  'chapters',
  'chaptersSource',
  'chaptersUpdatedAt',
  'chaptersUpdatedBy',
  'manifestLegacyRecorded',
] as const;

/** Columns filled from a source when blank on the kept book, and never pickable. */
export const FILL_ONLY_COLUMNS = ['rating'] as const;

function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function isBlankColumn(column: string, value: unknown): boolean {
  if (column === 'pageCount' && value === 0) return true;
  return isBlankValue(value);
}

export function fieldValue(field: BookMergeField, facts: BookFacts): BookMergeFieldValue {
  if (field === 'authors') return facts.authors;
  if (field === 'narrators') return facts.narrators;
  if (field === 'series') return facts.series.map((entry) => (entry.seriesIndex === null ? entry.name : `${entry.name} #${entry.seriesIndex}`));
  const spec = BOOK_MERGE_FIELD_SPECS[field];
  if (spec.columns.length === 1) return (facts.metadata?.[spec.columns[0]] ?? null) as BookMergeFieldValue;
  if (field === 'publishedYear') return (facts.metadata?.publishedDate ?? facts.metadata?.publishedYear ?? null) as BookMergeFieldValue;
  if (field === 'isbn') return (facts.metadata?.isbn13 ?? facts.metadata?.isbn10 ?? null) as BookMergeFieldValue;
  return (facts.metadata?.[spec.columns[0]] ?? null) as BookMergeFieldValue;
}

export function isBlankField(field: BookMergeField, facts: BookFacts): boolean {
  if (field === 'authors') return facts.authors.length === 0;
  if (field === 'narrators') return facts.narrators.length === 0;
  if (field === 'series') return facts.series.length === 0 && isBlankValue(facts.metadata?.seriesName);
  return BOOK_MERGE_FIELD_SPECS[field].columns.every((column) => isBlankColumn(column, facts.metadata?.[column]));
}

export function isFieldLocked(field: BookMergeField, facts: BookFacts): boolean {
  return BOOK_MERGE_FIELD_SPECS[field].locks.some((lock) => facts.lockedFields.has(lock));
}

/** The book that owns the audio content, if exactly one does. */
export function audioOwnerOf(books: readonly BookFacts[]): number | null {
  const owners = books.filter((book) => book.hasAudio);
  return owners.length === 1 ? owners[0].bookId : null;
}

/**
 * The book each field's value comes from. `books[0]` is the kept book; the rest are sources in
 * request order. Defaults never replace a field the kept book has locked; an explicit override may.
 */
export function resolveFieldSources(
  books: readonly BookFacts[],
  overrides: Partial<Record<BookMergeField, number>> = {},
): Map<BookMergeField, number> {
  const [target, ...sources] = books;
  const audioOwner = audioOwnerOf(books);
  const result = new Map<BookMergeField, number>();

  for (const field of BOOK_MERGE_FIELDS) {
    const override = overrides[field];
    if (override !== undefined && books.some((book) => book.bookId === override)) {
      result.set(field, override);
      continue;
    }
    if (isFieldLocked(field, target)) {
      result.set(field, target.bookId);
      continue;
    }
    if (BOOK_MERGE_FIELD_SPECS[field].followsAudio && audioOwner !== null) {
      const owner = books.find((book) => book.bookId === audioOwner)!;
      result.set(field, isBlankField(field, owner) && !isBlankField(field, target) ? target.bookId : audioOwner);
      continue;
    }
    if (!isBlankField(field, target)) {
      result.set(field, target.bookId);
      continue;
    }
    result.set(field, sources.find((source) => !isBlankField(field, source))?.bookId ?? target.bookId);
  }
  return result;
}
