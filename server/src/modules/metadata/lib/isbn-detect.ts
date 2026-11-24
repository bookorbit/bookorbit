import type { BookIsbnCandidate, BookIsbnEditionHint } from '@bookorbit/types';

import { canonicalIsbn13, isbn10FromIsbn13, isValidIsbn10, isValidIsbn13, normalizeIsbn } from '../../../common/text-match/isbn-normalize';
import { htmlToPlainText } from '../../../common/utils/html-to-text.utils';

export interface IsbnHit {
  value: string;
  kind: 10 | 13;
  labeled: boolean;
  edition: BookIsbnEditionHint | null;
  context: string;
}

export interface IsbnResult {
  isbn10: string | null;
  isbn13: string | null;
}

interface Label {
  start: number;
  end: number;
  /** "eISBN" or "e-ISBN": the label itself names the ebook edition. */
  ebook: boolean;
}

const LABEL_LOOKBACK = 25;
// A number this close after a labeled ISBN continues its list: "ISBNs: 978... (hardcover), 978... (ebook)".
const LIST_GAP = 30;
const EDITION_LOOKBACK = 20;
const CONTEXT_BEFORE = 50;
const CONTEXT_AFTER = 40;
const MAX_CANDIDATES = 20;

const CANDIDATE = /[0-9][0-9\s-]{7,16}[0-9Xx]/g;
const SPACE = /\s+/g;
const MAX_SPACED_GROUPS = 5;
// "ISBN", "eISBN" or "e-ISBN" as a word of prose. In a URL (`?isbn=`, `/isbn/`) it names a query
// parameter, and the number there is often another edition's.
const LABEL = /(?<![A-Za-z0-9?&=/])(e-?)?isbn(?!\s*=)/gi;
const PARENTHESISED = /^\s*[([]([^)\]]{1,40})[)\]]/;
const LEADING_BRACKETS = /^\s*[([][^)\]]*[)\]]/;

const EDITION_PATTERNS: [BookIsbnEditionHint, RegExp][] = [
  ['audio', /\b(audio|audiobook|mp3|cd)\b/i],
  ['ebook', /\b(e-?books?|ebk|e-?pub|kindle|mobi|pdf|electronic|digital)\b|\(e\)/i],
  ['hardcover', /\b(hardcover|hard cover|hardback|hbk|hb|cloth|casebound)\b/i],
  ['paperback', /\b(paperback|pbk|pb|tpb|softcover|soft cover|trade|mass[- ]market)\b/i],
  ['print', /\bprint\b/i],
];

export { isValidIsbn10, isValidIsbn13, normalizeIsbn };

/**
 * Plain text of book markup for ISBN scanning. Every tag becomes a word break, so text from
 * adjacent paragraphs never runs together ("New York 10014.ISBN: 978...").
 */
export function markupToScanText(markup: string): string {
  return htmlToPlainText(markup.replace(/</g, ' <'));
}

function editionIn(text: string): BookIsbnEditionHint | null {
  for (const [edition, pattern] of EDITION_PATTERNS) {
    if (pattern.test(text)) return edition;
  }
  return null;
}

/**
 * The edition named beside one ISBN: in brackets right after it ("(hardcover)"), between the
 * label and the number ("ISBN-13 (pbk.):"), in the label itself ("eISBN"), or just before the
 * label ("eBook ISBN"). Text after the number counts only in brackets, because on a page like
 * "ISBN 978... eBook ISBN 978..." the word after one number belongs to the next.
 */
function editionFor(text: string, label: Label, numberStart: number, numberEnd: number, previousEnd: number): BookIsbnEditionHint | null {
  const bracketed = PARENTHESISED.exec(text.slice(numberEnd, numberEnd + 48));
  if (bracketed) {
    const edition = editionIn(bracketed[1]);
    if (edition) return edition;
  }
  const between = editionIn(text.slice(label.end, numberStart));
  if (between) return between;
  if (label.ebook) return 'ebook';
  // Brackets straight after the previous number belong to that number.
  const before = text.slice(Math.max(previousEnd, label.start - EDITION_LOOKBACK), label.start).replace(LEADING_BRACKETS, '');
  if (/(^|\s)e\s*$/i.test(before)) return 'ebook';
  return editionIn(before);
}

function contextFor(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_BEFORE);
  const to = Math.min(text.length, end + CONTEXT_AFTER);
  let slice = text.slice(from, to).replace(/\s+/g, ' ');
  if (from > 0) slice = slice.replace(/^\S*\s/, '');
  if (to < text.length) slice = slice.replace(/\s\S*$/, '');
  return slice.trim();
}

function labelsIn(text: string): Label[] {
  return [...text.matchAll(LABEL)].map((match) => {
    const start = match.index ?? 0;
    return { start, end: start + match[0].length, ebook: match[1] !== undefined };
  });
}

function nearestLabel(labels: Label[], numberStart: number): Label | null {
  let nearest: Label | null = null;
  for (const label of labels) {
    if (label.start >= numberStart) break;
    if (label.start >= numberStart - LABEL_LOOKBACK) nearest = label;
  }
  return nearest;
}

function isbnKind(value: string): 10 | 13 | null {
  if (value.length === 13 && isValidIsbn13(value)) return 13;
  if (value.length === 10 && isValidIsbn10(value)) return 10;
  return null;
}

/**
 * An ISBN printed in spaced groups has at most five of them and ends in its check digit alone.
 * Lines such as a printer's key ("12 13 14 15 16") pass the checksum often enough to need this.
 */
function spacedLikeIsbn(part: string): boolean {
  const groups = part.split(SPACE);
  return groups.length === 1 || (groups.length <= MAX_SPACED_GROUPS && normalizeIsbn(groups[groups.length - 1]).length === 1);
}

/**
 * The ISBN a run of digits starts with, and how many characters of the run it takes. A space can
 * group an ISBN's digits ("0 306 40615 2") or end it before the next number ("eISBN
 * 9780834821095 1. Spiritual life"), so a run that is not an ISBN as a whole is cut back at each
 * space, longest first. Only a whole run the scan found by itself (`trusted`) needs nothing but
 * the checksum; a cut, or a run started again after a number, must also be grouped like an ISBN.
 */
function leadingIsbn(run: string, trusted: boolean): { value: string; kind: 10 | 13; length: number } | null {
  const ends = [run.length, ...[...run.matchAll(SPACE)].map((space) => space.index ?? 0).reverse()];
  for (const [index, end] of ends.entries()) {
    const part = run.slice(0, end);
    const value = normalizeIsbn(part);
    const kind = isbnKind(value);
    if (kind && ((trusted && index === 0) || spacedLikeIsbn(part))) return { value, kind, length: end };
  }
  return null;
}

/**
 * Find checksum-valid ISBN-10/13 strings inside free text. Each hit records whether an "ISBN"
 * label sits just before it or before the list it belongs to, the edition named beside it, and
 * the words around it. De-duplicates
 * by value; a labeled occurrence wins over an unlabeled one.
 */
export function findIsbnInText(text: string): IsbnHit[] {
  const labels = labelsIn(text);
  const byValue = new Map<string, IsbnHit>();
  const candidates = new RegExp(CANDIDATE);
  let previousEnd = 0;
  let previousLabeled = false;
  let retryAt = -1;

  for (let match = candidates.exec(text); match; match = candidates.exec(text)) {
    const start = match.index;
    const isbn = leadingIsbn(match[0], start !== retryAt);
    if (!isbn) {
      // A number before an ISBN joins its run too ("ISBN-13 978-0-306-40615-7"), and can push the
      // ISBN past the run's length cap, so the scan starts again at the run's next number.
      const space = /\s+/.exec(match[0]);
      if (space) {
        retryAt = start + space.index + space[0].length;
        candidates.lastIndex = retryAt;
      }
      continue;
    }

    const { value: norm, kind } = isbn;
    const end = start + isbn.length;
    candidates.lastIndex = end;
    const continuesList = previousLabeled && start - previousEnd <= LIST_GAP;
    const label = nearestLabel(labels, start) ?? (continuesList ? { start, end: start, ebook: false } : null);
    const hit: IsbnHit = {
      value: norm,
      kind,
      labeled: label !== null,
      edition: label ? editionFor(text, label, start, end, previousEnd) : null,
      context: contextFor(text, label?.start ?? start, end),
    };
    previousEnd = end;
    previousLabeled = hit.labeled;

    const existing = byValue.get(norm);
    if (!existing || (hit.labeled && !existing.labeled)) byValue.set(norm, hit);
    else if (hit.labeled && existing.edition === null) existing.edition = hit.edition;
  }

  return [...byValue.values()];
}

/** Hits from several passages of one book, de-duplicated the way `findIsbnInText` does within one. */
export function mergeIsbnHits(passages: IsbnHit[][]): IsbnHit[] {
  const byValue = new Map<string, IsbnHit>();
  for (const hit of passages.flat()) {
    const existing = byValue.get(hit.value);
    if (!existing || (hit.labeled && !existing.labeled)) byValue.set(hit.value, hit);
    else if (hit.labeled && existing.edition === null) existing.edition = hit.edition;
  }
  return [...byValue.values()];
}

/**
 * The ISBN a book's text names, only when it names exactly one. A copyright page usually lists
 * every edition and front or back matter lists other books, so with several labeled ISBNs there is
 * no telling which belongs to this file, and a wrong one drives lookups, matching and duplicate
 * detection. The ISBN-10 and ISBN-13 forms of one ISBN count as one.
 */
export function pickSingleIsbn(hits: IsbnHit[]): IsbnResult {
  const labeled = hits.filter((hit) => hit.labeled);
  const distinct = new Set(labeled.map((hit) => canonicalIsbn13(hit.value)));
  if (distinct.size !== 1) return { isbn10: null, isbn13: null };
  return {
    isbn10: labeled.find((hit) => hit.kind === 10)?.value ?? null,
    isbn13: labeled.find((hit) => hit.kind === 13)?.value ?? null,
  };
}

/** Labeled hits as choices for a person, one per ISBN in the order the book prints them. */
export function toIsbnCandidates(hits: IsbnHit[]): BookIsbnCandidate[] {
  const byIsbn = new Map<string, BookIsbnCandidate>();
  for (const hit of hits) {
    if (!hit.labeled) continue;
    const isbn13 = canonicalIsbn13(hit.value);
    if (!isbn13) continue;
    const existing = byIsbn.get(isbn13);
    if (existing) {
      existing.edition ??= hit.edition;
      if (hit.kind === 10) existing.isbn10 = hit.value;
      continue;
    }
    if (byIsbn.size >= MAX_CANDIDATES) break;
    byIsbn.set(isbn13, {
      isbn13,
      isbn10: hit.kind === 10 ? hit.value : (isbn10FromIsbn13(isbn13) ?? null),
      edition: hit.edition,
      context: hit.context,
    });
  }
  return [...byIsbn.values()];
}
