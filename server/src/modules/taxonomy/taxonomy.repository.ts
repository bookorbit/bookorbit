import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules, TaxonomyIndexSort, TaxonomyKind, TaxonomyLibraryCount, TaxonomyName } from '@bookorbit/types';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookGenres, bookMetadata, bookTags, books, genres, libraries, tags, userBookStatus } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const KIND_TABLES = {
  genre: { entity: genres, junction: bookGenres, entityId: bookGenres.genreId, bookId: bookGenres.bookId },
  tag: { entity: tags, junction: bookTags, entityId: bookTags.tagId, bookId: bookTags.bookId },
} as const;

type KindTables = (typeof KIND_TABLES)[TaxonomyKind];

export const TAXONOMY_COVER_COUNT = 3;

/**
 * pg_trgm's strict word similarity compares whole words, so "Fantasy" finds "Epic Fantasy" and
 * "Fantasies" without "Romantasy" or "Fanfare". Measured both ways so a long name finds its short
 * parent as well as the other way round.
 */
const SIMILAR_NAME_THRESHOLD = 0.5;

export interface TaxonomyVisibility {
  libraryIds: number[];
  contentFilters?: ContentFilterRules;
}

export interface TaxonomySummaryRow {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  readingCount: number;
  libraryCount: number;
  lastAddedAt: string | null;
}

export interface TaxonomyEntry {
  id: number;
  name: string;
}

@Injectable()
export class TaxonomyRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPage(params: {
    kind: TaxonomyKind;
    visibility: TaxonomyVisibility;
    userId: number;
    q?: string;
    page: number;
    size: number;
    sort: TaxonomyIndexSort;
    order: 'asc' | 'desc';
  }): Promise<{ items: TaxonomySummaryRow[]; total: number }> {
    const t = KIND_TABLES[params.kind];
    const conditions = this.visibilityClauses(params.visibility);
    if (params.q) conditions.push(accentInsensitiveIlike(t.entity.name, buildSearchPattern(params.q)));

    const bookCount = sql<number>`count(distinct ${books.id})::int`;
    const readCount = sql<number>`count(distinct case when ${userBookStatus.status} = 'read' then ${books.id} end)::int`;
    const readingCount = sql<number>`count(distinct case when ${userBookStatus.status} in ('reading', 'rereading') then ${books.id} end)::int`;
    const libraryCount = sql<number>`count(distinct ${books.libraryId})::int`;
    const lastAddedAt = sql<Date | null>`max(${books.addedAt})`.mapWith(books.addedAt);
    // count(*) over () runs after grouping, so it counts names rather than books.
    const total = sql<number>`(count(*) over ())::int`;

    const rows = await this.db
      .select({
        id: t.entity.id,
        name: t.entity.name,
        bookCount,
        readCount,
        readingCount,
        libraryCount,
        lastAddedAt,
        total,
      })
      .from(t.junction)
      .innerJoin(t.entity, eq(t.entity.id, t.entityId))
      .innerJoin(books, eq(books.id, t.bookId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(and(...conditions))
      .groupBy(t.entity.id, t.entity.name)
      .orderBy(...this.sortExpression(t, params.sort, params.order, { bookCount, readCount, libraryCount, lastAddedAt }))
      .limit(params.size)
      .offset(params.page * params.size);

    if (rows.length === 0) {
      const totalPastEnd = params.page > 0 ? await this.countVisible(params.kind, params.visibility, params.q) : 0;
      return { items: [], total: totalPastEnd };
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        bookCount: row.bookCount,
        readCount: row.readCount,
        readingCount: row.readingCount,
        libraryCount: row.libraryCount,
        lastAddedAt: row.lastAddedAt ? new Date(row.lastAddedAt).toISOString() : null,
      })),
      total: rows[0].total,
    };
  }

  async countVisible(kind: TaxonomyKind, visibility: TaxonomyVisibility, q?: string): Promise<number> {
    if (visibility.libraryIds.length === 0) return 0;
    const t = KIND_TABLES[kind];
    const conditions = this.visibilityClauses(visibility);
    const query = this.db
      .select({ total: sql<number>`count(distinct ${t.entityId})::int` })
      .from(t.junction)
      .innerJoin(books, eq(books.id, t.bookId))
      .$dynamic();
    if (q) {
      query.innerJoin(t.entity, eq(t.entity.id, t.entityId));
      conditions.push(accentInsensitiveIlike(t.entity.name, buildSearchPattern(q)));
    }
    const [row] = await query.where(and(...conditions));
    return Number(row?.total ?? 0);
  }

  /** Newest books with a cover first, at most {@link TAXONOMY_COVER_COUNT} per name. */
  async findCoverBookIds(kind: TaxonomyKind, ids: number[], visibility: TaxonomyVisibility): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (ids.length === 0) return result;
    const t = KIND_TABLES[kind];
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    // A lateral top-N per name reads a few index entries each instead of sorting every member of a
    // large genre just to keep three.
    const rows = await this.db.execute<{ entityId: number; bookId: number }>(sql`
      select picked.entity_id as "entityId", picked.book_id as "bookId"
      from unnest(array[${idList}]::int[]) as wanted(id)
      cross join lateral (
        select wanted.id as entity_id, ${books.id} as book_id
        from ${t.junction}
        inner join ${books} on ${books.id} = ${t.bookId}
        inner join ${bookMetadata} on ${bookMetadata.bookId} = ${books.id}
        where ${t.entityId} = wanted.id
          and ${bookMetadata.coverSource} is not null
          and ${and(...this.visibilityClauses(visibility))}
        order by ${books.addedAt} desc, ${books.id} desc
        limit ${TAXONOMY_COVER_COUNT}
      ) as picked
    `);
    for (const row of rows.rows) {
      const list = result.get(row.entityId) ?? [];
      list.push(row.bookId);
      result.set(row.entityId, list);
    }
    return result;
  }

  async findEntry(kind: TaxonomyKind, id: number): Promise<TaxonomyEntry | null> {
    const t = KIND_TABLES[kind];
    const [row] = await this.db.select({ id: t.entity.id, name: t.entity.name }).from(t.entity).where(eq(t.entity.id, id)).limit(1);
    return row ?? null;
  }

  /** Whether any book the viewer can see carries this name. */
  async hasVisibleBooks(kind: TaxonomyKind, id: number, visibility: TaxonomyVisibility): Promise<boolean> {
    if (visibility.libraryIds.length === 0) return false;
    const t = KIND_TABLES[kind];
    const rows = await this.db
      .select({ one: sql`1` })
      .from(t.junction)
      .innerJoin(books, eq(books.id, t.bookId))
      .where(and(eq(t.entityId, id), ...this.visibilityClauses(visibility)))
      .limit(1);
    return rows.length > 0;
  }

  async findLibraryCounts(kind: TaxonomyKind, id: number, visibility: TaxonomyVisibility): Promise<TaxonomyLibraryCount[]> {
    if (visibility.libraryIds.length === 0) return [];
    const t = KIND_TABLES[kind];
    const bookCount = sql<number>`count(distinct ${books.id})::int`;
    return this.db
      .select({ id: libraries.id, name: libraries.name, bookCount })
      .from(t.junction)
      .innerJoin(books, eq(books.id, t.bookId))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(and(eq(t.entityId, id), ...this.visibilityClauses(visibility)))
      .groupBy(libraries.id, libraries.name)
      .orderBy(desc(bookCount), asc(libraries.name));
  }

  async findSimilar(kind: TaxonomyKind, entry: TaxonomyEntry, visibility: TaxonomyVisibility, limit: number): Promise<TaxonomyName[]> {
    if (visibility.libraryIds.length === 0) return [];
    const t = KIND_TABLES[kind];
    const needle = sql`public.bookorbit_unaccent(${entry.name})`;
    const candidate = sql`public.bookorbit_unaccent(${t.entity.name})`;
    const bookCount = sql<number>`count(distinct ${books.id})::int`;
    return this.db
      .select({ id: t.entity.id, name: t.entity.name, bookCount })
      .from(t.entity)
      .innerJoin(t.junction, eq(t.entityId, t.entity.id))
      .innerJoin(books, eq(books.id, t.bookId))
      .where(
        and(
          ne(t.entity.id, entry.id),
          sql`(strict_word_similarity(${needle}, ${candidate}) >= ${SIMILAR_NAME_THRESHOLD} or strict_word_similarity(${candidate}, ${needle}) >= ${SIMILAR_NAME_THRESHOLD})`,
          ...this.visibilityClauses(visibility),
        ),
      )
      .groupBy(t.entity.id, t.entity.name)
      .orderBy(desc(bookCount), asc(this.nameKey(t)))
      .limit(limit);
  }

  /** Restricts a book query to books carrying this genre or tag. */
  membershipClause(kind: TaxonomyKind, id: number): SQL {
    const t = KIND_TABLES[kind];
    const members = this.db
      .select({ one: sql`1` })
      .from(t.junction)
      .where(and(eq(t.bookId, books.id), eq(t.entityId, id)));
    return sql`exists (${members})`;
  }

  private visibilityClauses(visibility: TaxonomyVisibility): SQL[] {
    return [
      inArray(books.libraryId, visibility.libraryIds),
      ...(visibility.contentFilters ? buildContentFilterClauses(visibility.contentFilters, this.db) : []),
    ];
  }

  private nameKey(t: KindTables): SQL<string> {
    return sql<string>`lower(public.bookorbit_unaccent(${t.entity.name}))`;
  }

  private sortExpression(
    t: KindTables,
    sort: TaxonomyIndexSort,
    order: 'asc' | 'desc',
    exprs: { bookCount: SQL<number>; readCount: SQL<number>; libraryCount: SQL<number>; lastAddedAt: SQL<Date | null> },
  ): SQL[] {
    const dir = order === 'asc' ? asc : desc;
    const byName = asc(this.nameKey(t));
    switch (sort) {
      case 'bookCount':
        return [dir(exprs.bookCount), byName];
      case 'readProgress':
        return [dir(sql`${exprs.readCount}::float / nullif(${exprs.bookCount}, 0)`), dir(exprs.readCount), byName];
      case 'libraryCount':
        return [dir(exprs.libraryCount), desc(exprs.bookCount), byName];
      case 'lastAddedAt':
        return [dir(exprs.lastAddedAt), byName];
      case 'name':
      default:
        return [dir(this.nameKey(t)), dir(t.entity.id)];
    }
  }
}
