import { sql, type SQL } from 'drizzle-orm';
import { AUDIO_FORMAT_LIST, COMIC_FORMAT_LIST, EBOOK_FORMAT_LIST, normalizeWorkToken } from '@bookorbit/types';

export function normalizeIsbn(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized || null;
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const digit = index === 9 && value[index] === 'X' ? 10 : Number(value[index]);
    sum += digit * (10 - index);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value) || (!value.startsWith('978') && !value.startsWith('979'))) return false;
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export function isbn10ToIsbn13(value: string): string {
  const body = `978${value.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function canonicalizeIsbn(isbn10: string | null, isbn13: string | null): string | null {
  const normalized13 = normalizeIsbn(isbn13);
  if (normalized13 && isValidIsbn13(normalized13)) return normalized13;

  const normalized10 = normalizeIsbn(isbn10);
  if (normalized10 && isValidIsbn10(normalized10)) return isbn10ToIsbn13(normalized10);
  return null;
}

export const MEDIA_FAMILIES = ['audiobook', 'comic', 'ebook'] as const;
export type MediaFamily = (typeof MEDIA_FAMILIES)[number] | 'unknown';

const FAMILY_FORMATS: ReadonlyArray<readonly [MediaFamily, readonly string[]]> = [
  ['audiobook', AUDIO_FORMAT_LIST],
  ['comic', COMIC_FORMAT_LIST],
  ['ebook', EBOOK_FORMAT_LIST],
];

export function mediaFamilyForFormat(format: string | null): MediaFamily {
  const normalized = format?.toLowerCase();
  if (!normalized) return 'unknown';
  return FAMILY_FORMATS.find(([, formats]) => formats.includes(normalized))?.[0] ?? 'unknown';
}

function sqlLiteral(value: string): SQL {
  if (!/^[a-z0-9 ]+$/.test(value)) throw new Error(`Unsafe SQL literal: ${value}`);
  return sql.raw(`'${value}'`);
}

/** The same mapping as a SQL `CASE` over a format column, so the scan's queries and the normalizer cannot drift. */
export function mediaFamilySql(format: SQL): SQL {
  const branches = FAMILY_FORMATS.map(
    ([family, formats]) =>
      sql`WHEN lower(coalesce(${format}, '')) IN (${sql.join(
        formats.map((value) => sqlLiteral(value)),
        sql`, `,
      )}) THEN ${sqlLiteral(family)}`,
  );
  return sql`CASE ${sql.join(branches, sql` `)} ELSE 'unknown' END`;
}

/**
 * Words an audiobook edition adds to a title. Removed as whole words, with any subtitle after a
 * colon, before an ebook's title is compared with an audiobook's (H10).
 */
export const AUDIO_TITLE_MARKERS = ['unabridged', 'abridged', 'audiobook', 'audio book', 'a novel'] as const;

const AUDIO_TITLE_MARKER_PATTERN = new RegExp(`\\b(?:${AUDIO_TITLE_MARKERS.join('|')})\\b`, 'giu');

function titleHead(title: string): string {
  const head = title.split(':')[0] ?? '';
  return head.trim() ? head : title;
}

/** The token an ebook and an audiobook of one work share, whatever edition markers either title carries. */
export function crossFormatTitleKey(title: string | null | undefined): string {
  if (!title?.trim()) return '';
  return normalizeWorkToken(titleHead(title).replace(AUDIO_TITLE_MARKER_PATTERN, ' '));
}

/** The person token used to match an author on one side with an author or narrator on the other. */
export function crossFormatPersonKey(name: string | null | undefined): string {
  return normalizeWorkToken(name ?? '');
}

/**
 * The SQL counterpart of `crossFormatTitleKey`, spaced so trigram similarity still sees words. Used
 * where a similarity, not an equality, decides (series position matches).
 */
export function crossFormatTitleSql(title: SQL): SQL {
  const markers = sql.raw(`'\\m(?:${AUDIO_TITLE_MARKERS.join('|')})\\M'`);
  return sql`lower(btrim(regexp_replace(regexp_replace(regexp_replace(public.bookorbit_unaccent(CASE WHEN btrim(split_part(coalesce(${title}, ''), ':', 1)) = '' THEN coalesce(${title}, '') ELSE split_part(coalesce(${title}, ''), ':', 1) END), ${markers}, ' ', 'gi'), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')))`;
}

/** A series position in one canonical spelling, so "1", "01" and "1.0" agree. */
export function canonicalSeriesIndex(index: string | null | undefined): string | null {
  if (index === null || index === undefined || !index.trim()) return null;
  const value = Number(index.trim());
  return Number.isFinite(value) ? String(value) : null;
}
