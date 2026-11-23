import { Inject, Injectable } from '@nestjs/common';
import { and, ne, sql, type SQL } from 'drizzle-orm';

import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import { bookDuplicateDismissals, bookMetadata, books } from '../../db/schema';
import type { EditionFactsRow } from './book-duplicate-editions';
import { crossFormatTitleSql } from './book-duplicate-normalize';
import { duplicateScopeWhere, type Db } from './book-duplicates.repository';

/** What judging a pair as editions reads, plus the title, people and series position that found it. */
export type EditionSuggestionRow = EditionFactsRow & {
  title: string | null;
  series_id: number | null;
  series_index: string | null;
  authors: string[];
  /** Authors and narrators in the spelling the candidate search compares, so it finds the same people. */
  person_keys: string[];
};

export type EditionSuggestionSource = EditionSuggestionRow & { link_group_id: number | null };

/** A person's name as the candidate search compares it: unaccented, lower case, letters and digits only. */
function personKeySql(name: SQL): SQL {
  return sql`regexp_replace(lower(public.bookorbit_unaccent(${name})), '[^[:alnum:]]+', '', 'g')`;
}

const PERSON_KEYS = sql`ARRAY(
  SELECT DISTINCT person_key FROM (
    SELECT ${personKeySql(sql`a.name`)} AS person_key
    FROM book_authors ba JOIN authors a ON a.id = ba.author_id
    WHERE ba.book_id = ${books.id}
    UNION ALL
    SELECT ${personKeySql(sql`n.name`)} AS person_key
    FROM book_narrators bn JOIN narrators n ON n.id = bn.narrator_id
    WHERE bn.book_id = ${books.id}
  ) people
  WHERE person_key <> ''
)`;

const ROW_COLUMNS = sql`
  ${books.id} AS id,
  ${bookMetadata.title} AS title,
  ${bookMetadata.isbn10} AS isbn10,
  ${bookMetadata.isbn13} AS isbn13,
  ${bookMetadata.hardcoverId} AS hardcover_id,
  ${bookMetadata.hardcoverEditionId} AS hardcover_edition_id,
  ${bookMetadata.openLibraryId} AS open_library_id,
  ${bookMetadata.publisher} AS publisher,
  COALESCE(extract(year FROM ${bookMetadata.publishedDate})::integer, ${bookMetadata.publishedYear}) AS published_year,
  ${bookMetadata.seriesId} AS series_id,
  ${bookMetadata.seriesIndex} AS series_index,
  ARRAY(
    SELECT DISTINCT lower(f.format)
    FROM book_files f
    WHERE f.book_id = ${books.id} AND f.role = 'content' AND f.format IS NOT NULL
  ) AS formats,
  ARRAY(
    SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = ${books.id}
  ) AS authors,
  ARRAY(
    SELECT n.name FROM book_narrators bn JOIN narrators n ON n.id = bn.narrator_id WHERE bn.book_id = ${books.id}
  ) AS narrators,
  ${PERSON_KEYS} AS person_keys
`;

/**
 * Finds the books that may be other editions of one book, live and without a duplicate scan: the
 * same Hardcover or Open Library work, or a title that reads the same and a shared person. The
 * caller decides which of them are editions; this only narrows the library to a bounded handful.
 */
@Injectable()
export class BookEditionSuggestionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findSource(bookId: number): Promise<EditionSuggestionSource | null> {
    const result = await this.db.execute<EditionSuggestionSource>(sql`
      SELECT
        ${ROW_COLUMNS},
        (SELECT l.group_id FROM book_links l WHERE l.book_id = ${books.id}) AS link_group_id
      FROM ${books}
      LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      WHERE ${books.id} = ${bookId}
    `);
    return result.rows[0] ?? null;
  }

  /**
   * Present books in the given libraries, never the book itself or another member of its group. A
   * work id match is enough; a title match also needs a shared author or narrator, so a common title
   * does not fill the list. Work id matches come first, then the closest titles.
   */
  async findCandidates(input: {
    source: EditionSuggestionSource;
    libraryIds: number[];
    user: RequestUser;
    limit: number;
  }): Promise<EditionSuggestionRow[]> {
    const { source, libraryIds, user, limit } = input;
    if (libraryIds.length === 0) return [];
    const hardcoverId = source.hardcover_id?.trim() || null;
    const openLibraryId = source.open_library_id?.trim() || null;
    const titleHead = source.title?.trim() ? crossFormatTitleSql(sql`${source.title}::text`) : null;
    const personKeys = source.person_keys;

    const workMatches: SQL[] = [];
    if (hardcoverId) workMatches.push(sql`${bookMetadata.hardcoverId} = ${hardcoverId}`);
    if (openLibraryId) workMatches.push(sql`${bookMetadata.openLibraryId} = ${openLibraryId}`);
    const workMatch = workMatches.length > 0 ? sql.join(workMatches, sql` OR `) : null;
    const titleMatch =
      titleHead && personKeys.length > 0
        ? sql`(${titleHead} <% public.bookorbit_unaccent(${bookMetadata.title})
            AND EXISTS (
              SELECT 1 FROM book_authors ba JOIN authors a ON a.id = ba.author_id
              WHERE ba.book_id = ${books.id} AND ${personKeySql(sql`a.name`)} = ANY(${sql.param(personKeys)}::text[])
              UNION ALL
              SELECT 1 FROM book_narrators bn JOIN narrators n ON n.id = bn.narrator_id
              WHERE bn.book_id = ${books.id} AND ${personKeySql(sql`n.name`)} = ANY(${sql.param(personKeys)}::text[])
            ))`
        : null;
    const matches = [workMatch, titleMatch].filter((clause): clause is SQL => clause !== null);
    if (matches.length === 0) return [];

    const otherGroupMember =
      source.link_group_id === null
        ? sql``
        : sql`AND NOT EXISTS (SELECT 1 FROM book_links l WHERE l.book_id = ${books.id} AND l.group_id = ${source.link_group_id})`;
    const workRank = workMatch ? sql`CASE WHEN ${workMatch} THEN 0 ELSE 1 END` : sql`1`;
    const titleRank = titleHead ? sql`word_similarity(${titleHead}, public.bookorbit_unaccent(${bookMetadata.title}))` : sql`0`;
    const scope = and(duplicateScopeWhere(this.db, libraryIds, user), ne(books.status, 'missing'))!;

    const result = await this.db.execute<EditionSuggestionRow>(sql`
      SELECT ${ROW_COLUMNS}
      FROM ${books}
      JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      WHERE ${scope}
        AND ${books.id} <> ${source.id}
        ${otherGroupMember}
        AND (${sql.join(matches, sql` OR `)})
      ORDER BY ${workRank}, ${titleRank} DESC, ${books.id}
      LIMIT ${limit}
    `);
    return result.rows;
  }

  /** The candidates this user already told Duplicate Books are not another format or edition of the book. */
  async findDismissedPartners(userId: number, bookId: number, candidateIds: number[]): Promise<Set<number>> {
    if (candidateIds.length === 0) return new Set();
    const result = await this.db.execute<{ partner_id: number }>(sql`
      SELECT CASE WHEN ${bookDuplicateDismissals.bookIdA} = ${bookId} THEN ${bookDuplicateDismissals.bookIdB} ELSE ${bookDuplicateDismissals.bookIdA} END AS partner_id
      FROM ${bookDuplicateDismissals}
      WHERE ${bookDuplicateDismissals.userId} = ${userId}
        AND ${bookDuplicateDismissals.kind} IN ('other_format', 'other_edition')
        AND (
          (${bookDuplicateDismissals.bookIdA} = ${bookId} AND ${bookDuplicateDismissals.bookIdB} = ANY(${sql.param(candidateIds)}::int[]))
          OR (${bookDuplicateDismissals.bookIdB} = ${bookId} AND ${bookDuplicateDismissals.bookIdA} = ANY(${sql.param(candidateIds)}::int[]))
        )
    `);
    return new Set(result.rows.map((row) => Number(row.partner_id)));
  }
}
