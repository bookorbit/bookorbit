import type { BookDuplicateMatchReason } from '@bookorbit/types';

import { canonicalizeIsbn, mediaFamilyForFormat } from './book-duplicate-normalize';

export type EditionFactsRow = {
  id: number;
  isbn10: string | null;
  isbn13: string | null;
  hardcover_id: string | null;
  hardcover_edition_id: string | null;
  open_library_id: string | null;
  publisher: string | null;
  published_year: number | null;
  formats: string[];
  narrators: string[];
};

export type EditionFacts = {
  isbn: string | null;
  hardcoverEditionId: string | null;
  workIds: string[];
  publisher: string | null;
  publishedYear: number | null;
  narrators: string[];
  ebook: boolean;
  audio: boolean;
};

export type EditionCandidatePair = {
  kind: 'duplicate' | 'other_edition';
  reasons: readonly string[];
};

export type EditionPairOutcome =
  { action: 'keep' } | { action: 'drop' } | { action: 'reclassify'; reasons: Extract<BookDuplicateMatchReason, 'same_work' | 'title_author'>[] };

function words(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function token(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function toEditionFacts(row: EditionFactsRow): EditionFacts {
  const families = new Set(row.formats.map(mediaFamilyForFormat));
  const workIds = [
    ...(token(row.hardcover_id) ? [`hardcover:${token(row.hardcover_id)}`] : []),
    ...(token(row.open_library_id) ? [`openlibrary:${token(row.open_library_id)}`] : []),
  ];
  return {
    isbn: canonicalizeIsbn(row.isbn10, row.isbn13),
    hardcoverEditionId: token(row.hardcover_edition_id),
    workIds,
    publisher: words(row.publisher) || null,
    publishedYear: row.published_year === null ? null : Number(row.published_year),
    narrators: [...new Set(row.narrators.map(words).filter((name) => name.length > 0))].sort(),
    ebook: families.has('ebook'),
    audio: families.has('audiobook'),
  };
}

/** "Tor" and "Tor Books" name one publisher; a shorter name inside a longer one is not a different edition. */
function samePublisher(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return ` ${longer} `.includes(` ${shorter} `);
}

function sameNarrators(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/**
 * True when two records of one work are different editions: a fact both of them carry disagrees.
 * A fact only one side carries proves nothing, so a re-download with thinner metadata stays a duplicate.
 */
export function differsAsEdition(a: EditionFacts, b: EditionFacts): boolean {
  if (a.isbn && b.isbn && a.isbn !== b.isbn) return true;
  if (a.hardcoverEditionId && b.hardcoverEditionId && a.hardcoverEditionId !== b.hardcoverEditionId) return true;
  if (a.audio && b.audio && a.narrators.length > 0 && b.narrators.length > 0 && !sameNarrators(a.narrators, b.narrators)) return true;
  if (a.publisher && b.publisher && !samePublisher(a.publisher, b.publisher)) return true;
  return a.publishedYear !== null && b.publishedYear !== null && a.publishedYear !== b.publishedYear;
}

function sameMedium(a: EditionFacts, b: EditionFacts): boolean {
  return (a.audio && b.audio) || (a.ebook && b.ebook);
}

function sharesWork(a: EditionFacts, b: EditionFacts): boolean {
  return a.workIds.some((id) => b.workIds.includes(id));
}

/**
 * Decides where a same-medium pair of one work belongs. Identical files and a shared ISBN are always
 * duplicates. A duplicate that differs as an edition moves to other editions; a pair found by work id
 * alone stays only if it differs as an edition, since otherwise it is no edition at all.
 */
export function classifyEditionPair(pair: EditionCandidatePair, a: EditionFacts | undefined, b: EditionFacts | undefined): EditionPairOutcome {
  if (!a || !b || !sameMedium(a, b) || !differsAsEdition(a, b)) return pair.kind === 'other_edition' ? { action: 'drop' } : { action: 'keep' };
  if (pair.kind === 'other_edition' || pair.reasons.includes('file_hash') || pair.reasons.includes('isbn')) return { action: 'keep' };
  return { action: 'reclassify', reasons: sharesWork(a, b) ? ['same_work', 'title_author'] : ['title_author'] };
}
