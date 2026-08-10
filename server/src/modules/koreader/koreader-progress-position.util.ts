import { getFormatGroup } from '@bookorbit/types';

/** reading_progress.page_number is a PostgreSQL integer, so anything above int4 would fail the insert. */
const MAX_PAGE_NUMBER = 2_147_483_647;

/**
 * KOReader reports a reading position two different ways: reflowable documents get a
 * CREngine xpointer, paged ones (PDF and the CBX comic containers) get a plain page number.
 * The two land in different reading_progress columns, so every incoming position has
 * to be routed by the book file's format.
 *
 * An unknown or missing format resolves to the reflowable group, matching getFormatGroup.
 */
export function isPagedReadingFormat(format: string | null | undefined): boolean {
  const group = getFormatGroup(format ?? '');
  return group === 'pdf' || group === 'cbx';
}

/**
 * Parses the 1-based page number KOReader sends for paged documents
 * (ReaderPaging:getLastProgress). Returns null for anything else, including an xpointer
 * that reached a paged file by mistake, so the caller clears the stored page instead of
 * replacing it with a position the reader would misinterpret.
 */
export function parseKoreaderPageNumber(progress: string | null | undefined): number | null {
  if (typeof progress !== 'string') return null;

  const trimmed = progress.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const page = Number(trimmed);
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE_NUMBER) return null;

  return page;
}
