import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, inArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { annotations, authors, bookAuthors, bookMetadata, books } from '../../db/schema';
import type { VisualMatchCandidate } from './visual-match.core';

const unaccent = (value: unknown): SQL => sql`public.bookorbit_unaccent(${value})`;

/**
 * Finds books a photographed cover might show. Every lookup goes through the accent-insensitive
 * trigram indexes on titles and author names and is bounded, so a library of tens of thousands of
 * books costs a few index scans, not a sweep. `scope` is the caller's visible books.
 */
@Injectable()
export class VisualMatchRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Books carrying this ISBN in either length. */
  async findByIsbn(scope: SQL | undefined, isbn: { isbn10: string | null; isbn13: string | null }, limit: number): Promise<number[]> {
    const clauses: SQL[] = [];
    if (isbn.isbn13) clauses.push(sql`${bookMetadata.isbn13} = ${isbn.isbn13}`);
    if (isbn.isbn10) clauses.push(sql`${bookMetadata.isbn10} = ${isbn.isbn10}`);
    if (clauses.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .innerJoin(bookMetadata, sql`${bookMetadata.bookId} = ${books.id}`)
      .where(and(scope, or(...clauses)))
      .orderBy(books.id)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /**
   * Books whose title is like one of `phrases` as a whole, or holds one of `fragments` as part of a
   * longer title (a title broken over lines), most alike first.
   */
  async findByTitle(scope: SQL | undefined, phrases: readonly string[], fragments: readonly string[], limit: number): Promise<number[]> {
    if (phrases.length === 0 && fragments.length === 0) return [];
    const title = unaccent(bookMetadata.title);
    const matches = [
      ...phrases.map((phrase) => sql`${title} % ${unaccent(phrase)}`),
      ...fragments.map((fragment) => sql`${unaccent(fragment)} <% ${title}`),
    ];
    const likeness = [...phrases, ...fragments].map((text) => sql`similarity(${title}, ${unaccent(text)})`);
    const best = likeness.length === 1 ? likeness[0] : sql`greatest(${sql.join(likeness, sql`, `)})`;
    const rows = await this.db
      .select({ id: books.id, likeness: sql<number>`${best}` })
      .from(books)
      .innerJoin(bookMetadata, sql`${bookMetadata.bookId} = ${books.id}`)
      .where(and(scope, or(...matches)))
      .orderBy(sql`${best} desc`, books.id)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /** Books by an author whose name is like one of `lines`, and the names that matched. */
  async findByAuthor(scope: SQL | undefined, lines: readonly string[], limit: number): Promise<{ bookIds: number[]; names: string[] }> {
    if (lines.length === 0) return { bookIds: [], names: [] };
    const name = unaccent(authors.name);
    const rows = await this.db
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(authors)
      .innerJoin(bookAuthors, sql`${bookAuthors.authorId} = ${authors.id}`)
      .innerJoin(books, sql`${books.id} = ${bookAuthors.bookId}`)
      .where(and(scope, or(...lines.map((line) => sql`${name} % ${unaccent(line)}`))))
      .orderBy(bookAuthors.bookId)
      .limit(limit);
    return {
      bookIds: [...new Set(rows.map((row) => row.bookId))],
      names: [...new Set(rows.map((row) => row.name))],
    };
  }

  /** Titles and authors of these books, authors in display order. */
  async loadCandidates(ids: readonly number[]): Promise<VisualMatchCandidate[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        subtitle: bookMetadata.subtitle,
        authors: sql<
          string[]
        >`coalesce(array_agg(${authors.name} order by ${bookAuthors.displayOrder}) filter (where ${authors.name} is not null), '{}')`,
      })
      .from(books)
      .leftJoin(bookMetadata, sql`${bookMetadata.bookId} = ${books.id}`)
      .leftJoin(bookAuthors, sql`${bookAuthors.bookId} = ${books.id}`)
      .leftJoin(authors, sql`${authors.id} = ${bookAuthors.authorId}`)
      .where(inArray(books.id, [...ids]))
      .groupBy(books.id, bookMetadata.title, bookMetadata.subtitle);
    return rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      subtitle: row.subtitle,
      authors: Array.isArray(row.authors) ? row.authors.map(String) : [],
    }));
  }

  /** The user's highlights per book, trashed ones and strikethroughs aside. */
  async countHighlights(userId: number, ids: readonly number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ bookId: annotations.bookId, count: sql<number>`count(*)::int` })
      .from(annotations)
      .where(
        and(
          sql`${annotations.userId} = ${userId}`,
          inArray(annotations.bookId, [...ids]),
          sql`${annotations.deletedAt} is null`,
          sql`${annotations.style} <> 'strikethrough'`,
        ),
      )
      .groupBy(annotations.bookId);
    return new Map(rows.map((row) => [row.bookId, Number(row.count)]));
  }
}
