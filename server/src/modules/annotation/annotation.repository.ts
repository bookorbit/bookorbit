import { Inject, Injectable } from '@nestjs/common';
import {
  SQL,
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  inArray,
  max,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotationPositions,
  annotationSyncState,
  annotations,
  authors,
  bookAuthors,
  bookMetadata,
  books,
  AnnotationRow,
  NewAnnotation,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type AnnotationWithCfi = AnnotationRow & {
  cfi: string | null;
  cfiStatus: string | null;
  cfiExtras: Record<string, unknown> | null;
  jumpFileId: number | null;
  pageno: number | null;
};
export type HubAnnotationRow = AnnotationWithCfi & { bookTitle: string | null; author: string | null };

export interface HubFilters {
  bookId?: number;
  colors?: string[];
  styles?: string[];
  origins?: string[];
  chapter?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  hasNote?: boolean;
  status: 'active' | 'trashed';
}

export interface HubSort {
  by: 'createdAt' | 'book';
  dir: 'asc' | 'desc';
}

export interface AnnotationFilters {
  colors?: string[];
  search?: string;
  chapter?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AnnotationSort {
  by: 'position' | 'createdAt';
  dir: 'asc' | 'desc';
}

export interface PaginatedAnnotations {
  items: AnnotationWithCfi[];
  total: number;
}

export interface AnnotationStatsResult {
  totalHighlights: number;
  colorBreakdown: { color: string; count: number }[];
  originBreakdown: { origin: AnnotationRow['origin']; count: number }[];
  chaptersWithHighlights: number;
  highlightsWithNotes: number;
}

@Injectable()
export class AnnotationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private hubColumns() {
    return {
      ...getTableColumns(annotations),
      cfi: annotationPositions.pos0,
      cfiStatus: annotationPositions.status,
      cfiExtras: annotationPositions.extras,
      bookTitle: bookMetadata.title,
      author: sql<
        string | null
      >`(select string_agg(${authors.name}, ', ' order by ${bookAuthors.displayOrder}) from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${annotations.bookId})`,
      jumpFileId: sql<
        number | null
      >`coalesce(${annotationPositions.bookFileId}, (select ap2.book_file_id from annotation_positions ap2 where ap2.annotation_id = ${annotations.id} and ap2.format in ('xpointer', 'pdf') limit 1), ${books.primaryFileId})`,
      pageno: sql<
        number | null
      >`(select (ap3.extras ->> 'pageno')::int from annotation_positions ap3 where ap3.annotation_id = ${annotations.id} and ap3.format in ('xpointer', 'pdf') limit 1)`,
    };
  }

  private selectWithCfi() {
    return this.db
      .select({
        ...getTableColumns(annotations),
        cfi: annotationPositions.pos0,
        cfiStatus: annotationPositions.status,
        cfiExtras: annotationPositions.extras,
        jumpFileId: sql<
          number | null
        >`coalesce(${annotationPositions.bookFileId}, (select ap2.book_file_id from annotation_positions ap2 where ap2.annotation_id = ${annotations.id} and ap2.format in ('xpointer', 'pdf') limit 1), ${books.primaryFileId})`,
        pageno: sql<
          number | null
        >`(select (ap3.extras ->> 'pageno')::int from annotation_positions ap3 where ap3.annotation_id = ${annotations.id} and ap3.format in ('xpointer', 'pdf') limit 1)`,
      })
      .from(annotations)
      .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
      .leftJoin(books, eq(books.id, annotations.bookId));
  }

  async findByBookId(bookId: number, userId: number): Promise<AnnotationWithCfi[]> {
    return this.selectWithCfi()
      .where(and(...this.baseConditions(bookId, userId)))
      .orderBy(asc(annotations.createdAt));
  }

  async findById(bookId: number, annotationId: number, userId: number): Promise<AnnotationWithCfi | null> {
    const [row] = await this.selectWithCfi()
      .where(and(eq(annotations.id, annotationId), ...this.baseConditions(bookId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findPaginated(
    bookId: number,
    userId: number,
    filters: AnnotationFilters,
    sort: AnnotationSort,
    page: number,
    pageSize: number,
  ): Promise<PaginatedAnnotations> {
    const conditions = this.buildConditions(bookId, userId, filters);
    const orderBy = this.buildOrderBy(sort);
    const offset = (page - 1) * pageSize;

    const [items, totalResult] = await Promise.all([
      this.selectWithCfi()
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(annotations)
        .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
        .where(and(...conditions)),
    ]);

    return { items, total: totalResult[0]?.count ?? 0 };
  }

  async getStats(bookId: number, userId: number, filters: AnnotationFilters): Promise<AnnotationStatsResult> {
    const conditions = this.buildConditions(bookId, userId, filters);
    const cfiJoin = and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi'));

    const [aggregateResult, colorResult, originResult] = await Promise.all([
      this.db
        .select({
          totalHighlights: count(),
          chaptersWithHighlights: countDistinct(annotations.chapterTitle),
          highlightsWithNotes: count(sql`case when ${annotations.note} is not null and ${annotations.note} != '' then 1 end`),
        })
        .from(annotations)
        .leftJoin(annotationPositions, cfiJoin)
        .where(and(...conditions)),
      this.db
        .select({
          color: annotations.color,
          count: count(),
        })
        .from(annotations)
        .leftJoin(annotationPositions, cfiJoin)
        .where(and(...conditions))
        .groupBy(annotations.color)
        .orderBy(desc(count())),
      this.db
        .select({
          origin: annotations.origin,
          count: count(),
        })
        .from(annotations)
        .leftJoin(annotationPositions, cfiJoin)
        .where(and(...conditions))
        .groupBy(annotations.origin)
        .orderBy(desc(count())),
    ]);

    const agg = aggregateResult[0];

    return {
      totalHighlights: agg?.totalHighlights ?? 0,
      chaptersWithHighlights: agg?.chaptersWithHighlights ?? 0,
      highlightsWithNotes: agg?.highlightsWithNotes ?? 0,
      colorBreakdown: colorResult.map((r) => ({ color: r.color, count: r.count })),
      originBreakdown: originResult.map((r) => ({ origin: r.origin, count: r.count })),
    };
  }

  async getDistinctChapters(bookId: number, userId: number): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ chapterTitle: annotations.chapterTitle })
      .from(annotations)
      .where(and(...this.baseConditions(bookId, userId), isNotNull(annotations.chapterTitle)))
      .orderBy(asc(annotations.chapterTitle));

    return rows.map((r) => r.chapterTitle).filter((t): t is string => t != null);
  }

  async create(data: NewAnnotation & { cfi: string; bookFileId?: number | null }): Promise<AnnotationWithCfi> {
    const { cfi, bookFileId, ...annotationData } = data;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(annotations).values(annotationData).returning();
      await tx.insert(annotationPositions).values({
        annotationId: row.id,
        userId: row.userId,
        bookFileId: bookFileId ?? null,
        format: 'cfi',
        pos0: cfi,
        status: 'exact',
      });
      return { ...row, cfi, cfiStatus: 'exact', cfiExtras: null, jumpFileId: bookFileId ?? null, pageno: null };
    });
  }

  async update(
    bookId: number,
    annotationId: number,
    userId: number,
    data: Partial<Pick<NewAnnotation, 'note' | 'color' | 'style'>>,
  ): Promise<AnnotationWithCfi | null> {
    const [row] = await this.db
      .update(annotations)
      .set({ ...data, version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(annotations.id, annotationId), ...this.baseConditions(bookId, userId)))
      .returning();
    if (!row) return null;
    return this.findById(bookId, annotationId, userId);
  }

  async softDelete(bookId: number, annotationId: number, userId: number): Promise<boolean> {
    const result = await this.db
      .update(annotations)
      .set({ deletedAt: sql`now()`, version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(annotations.id, annotationId), ...this.baseConditions(bookId, userId)))
      .returning({ id: annotations.id });
    return result.length > 0;
  }

  async restore(annotationId: number, userId: number): Promise<AnnotationRow | null> {
    const [row] = await this.db
      .update(annotations)
      .set({ deletedAt: null, version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId), isNotNull(annotations.deletedAt)))
      .returning();
    return row ?? null;
  }

  /**
   * Hard delete, allowed only once every device that ever synced the annotation has
   * acknowledged its deletion (otherwise an unaware device would re-upload it as new).
   */
  async purge(annotationId: number, userId: number): Promise<'purged' | 'pending_device_sync' | 'not_found'> {
    const result = await this.db
      .delete(annotations)
      .where(
        and(
          eq(annotations.id, annotationId),
          eq(annotations.userId, userId),
          isNotNull(annotations.deletedAt),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(annotationSyncState)
              .where(and(eq(annotationSyncState.annotationId, annotations.id), isNull(annotationSyncState.deleteAckedAt))),
          ),
        ),
      )
      .returning({ id: annotations.id });
    if (result.length > 0) return 'purged';

    const [existing] = await this.db
      .select({ id: annotations.id })
      .from(annotations)
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId), isNotNull(annotations.deletedAt)))
      .limit(1);
    return existing ? 'pending_device_sync' : 'not_found';
  }

  async findHubPaginated(userId: number, filters: HubFilters, sort: HubSort, page: number, pageSize: number) {
    const conditions = this.buildHubConditions(userId, filters);
    const direction = sort.dir === 'desc' ? desc : asc;
    const orderBy =
      sort.by === 'book'
        ? [direction(bookMetadata.title), desc(annotations.createdAt), desc(annotations.id)]
        : [direction(annotations.createdAt), direction(annotations.id)];
    const offset = (page - 1) * pageSize;

    const [items, totalResult] = await Promise.all([
      this.db
        .select(this.hubColumns())
        .from(annotations)
        .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, annotations.bookId))
        .leftJoin(books, eq(books.id, annotations.bookId))
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(annotations)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, annotations.bookId))
        .leftJoin(books, eq(books.id, annotations.bookId))
        .where(and(...conditions)),
    ]);

    return { items: items as HubAnnotationRow[], total: totalResult[0]?.count ?? 0 };
  }

  async findHubById(userId: number, annotationId: number): Promise<HubAnnotationRow | null> {
    const [row] = await this.db
      .select(this.hubColumns())
      .from(annotations)
      .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, annotations.bookId))
      .leftJoin(books, eq(books.id, annotations.bookId))
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)))
      .limit(1);
    return (row as HubAnnotationRow | undefined) ?? null;
  }

  async findHubAll(userId: number, filters: HubFilters, limit = 5000): Promise<HubAnnotationRow[]> {
    const conditions = this.buildHubConditions(userId, filters);
    const rows = await this.db
      .select(this.hubColumns())
      .from(annotations)
      .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, annotations.bookId))
      .leftJoin(books, eq(books.id, annotations.bookId))
      .where(and(...conditions))
      .orderBy(asc(bookMetadata.title), asc(annotations.chapterTitle), asc(annotations.createdAt))
      .limit(limit);
    return rows as HubAnnotationRow[];
  }

  async getHubStats(userId: number, filters: HubFilters) {
    const conditions = this.buildHubConditions(userId, filters);
    const [row] = await this.db
      .select({
        books: countDistinct(annotations.bookId),
        withNotes: sql<number>`count(*) filter (where ${annotations.note} is not null and ${annotations.note} <> '')`,
        web: sql<number>`count(*) filter (where ${annotations.origin} = 'web')`,
        koreader: sql<number>`count(*) filter (where ${annotations.origin} = 'koreader')`,
        kobo: sql<number>`count(*) filter (where ${annotations.origin} = 'kobo')`,
      })
      .from(annotations)
      .where(and(...conditions));
    return row;
  }

  private bookFacetAuthorSql() {
    return sql<
      string | null
    >`(select string_agg(${authors.name}, ', ' order by ${bookAuthors.displayOrder}) from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${annotations.bookId})`;
  }

  async findHubBookFacets(userId: number, params: { status: 'active' | 'trashed'; q?: string; limit: number }) {
    const conditions: SQL[] = [
      eq(annotations.userId, userId),
      params.status === 'trashed' ? isNotNull(annotations.deletedAt) : isNull(annotations.deletedAt),
    ];
    const term = params.q?.trim();
    if (term) {
      const pattern = `%${term}%`;
      conditions.push(
        or(
          ilike(bookMetadata.title, pattern),
          sql`exists (select 1 from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${annotations.bookId} and ${authors.name} ilike ${pattern})`,
        )!,
      );
    }
    return this.db
      .select({
        bookId: annotations.bookId,
        bookTitle: bookMetadata.title,
        author: this.bookFacetAuthorSql(),
        count: count(),
      })
      .from(annotations)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, annotations.bookId))
      .where(and(...conditions))
      .groupBy(annotations.bookId, bookMetadata.title)
      .orderBy(desc(max(annotations.createdAt)), asc(bookMetadata.title))
      .limit(params.limit);
  }

  async findHubBookFacet(userId: number, status: 'active' | 'trashed', bookId: number) {
    const rows = await this.db
      .select({
        bookId: annotations.bookId,
        bookTitle: bookMetadata.title,
        author: this.bookFacetAuthorSql(),
        count: count(),
      })
      .from(annotations)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, annotations.bookId))
      .where(
        and(
          eq(annotations.userId, userId),
          eq(annotations.bookId, bookId),
          status === 'trashed' ? isNotNull(annotations.deletedAt) : isNull(annotations.deletedAt),
        ),
      )
      .groupBy(annotations.bookId, bookMetadata.title)
      .limit(1);
    return rows[0] ?? null;
  }

  async bulkSetDeleted(userId: number, ids: number[], deleted: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.db
      .update(annotations)
      .set({
        deletedAt: deleted ? sql`now()` : null,
        version: sql`${annotations.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(inArray(annotations.id, ids), eq(annotations.userId, userId), deleted ? isNull(annotations.deletedAt) : isNotNull(annotations.deletedAt)),
      )
      .returning({ id: annotations.id });
    return result.length;
  }

  async bulkRestyle(userId: number, ids: number[], patch: { color?: string; style?: string }): Promise<number> {
    if (ids.length === 0 || (patch.color === undefined && patch.style === undefined)) return 0;
    const result = await this.db
      .update(annotations)
      .set({ ...patch, version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(and(inArray(annotations.id, ids), eq(annotations.userId, userId), isNull(annotations.deletedAt)))
      .returning({ id: annotations.id });
    return result.length;
  }

  private buildHubConditions(userId: number, filters: HubFilters): SQL[] {
    const conditions: SQL[] = [eq(annotations.userId, userId)];
    conditions.push(filters.status === 'trashed' ? isNotNull(annotations.deletedAt) : isNull(annotations.deletedAt));
    if (filters.bookId !== undefined) conditions.push(eq(annotations.bookId, filters.bookId));
    if (filters.colors && filters.colors.length > 0) conditions.push(inArray(annotations.color, filters.colors));
    if (filters.styles && filters.styles.length > 0) conditions.push(inArray(annotations.style, filters.styles));
    if (filters.origins && filters.origins.length > 0) conditions.push(inArray(annotations.origin, filters.origins as AnnotationRow['origin'][]));
    if (filters.chapter) conditions.push(eq(annotations.chapterTitle, filters.chapter));
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(or(ilike(annotations.text, pattern), ilike(annotations.note, pattern))!);
    }
    if (filters.hasNote) conditions.push(sql`${annotations.note} is not null and ${annotations.note} <> ''`);
    if (filters.dateFrom) conditions.push(gte(annotations.createdAt, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(annotations.createdAt, filters.dateTo));
    return conditions;
  }

  async findTrashed(userId: number, bookId?: number): Promise<AnnotationWithCfi[]> {
    const conditions = [eq(annotations.userId, userId), isNotNull(annotations.deletedAt)];
    if (bookId !== undefined) conditions.push(eq(annotations.bookId, bookId));
    return this.selectWithCfi()
      .where(and(...conditions))
      .orderBy(desc(annotations.deletedAt));
  }

  private baseConditions(bookId: number, userId: number): SQL[] {
    return [eq(annotations.bookId, bookId), eq(annotations.userId, userId), isNull(annotations.deletedAt)];
  }

  private buildConditions(bookId: number, userId: number, filters: AnnotationFilters): SQL[] {
    const conditions = this.baseConditions(bookId, userId);

    if (filters.colors && filters.colors.length > 0) {
      conditions.push(inArray(annotations.color, filters.colors));
    }
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(or(ilike(annotations.text, pattern), ilike(annotations.note, pattern))!);
    }
    if (filters.chapter) {
      conditions.push(eq(annotations.chapterTitle, filters.chapter));
    }
    if (filters.dateFrom) {
      conditions.push(gte(annotations.createdAt, filters.dateFrom));
    }
    if (filters.dateTo) {
      conditions.push(lte(annotations.createdAt, filters.dateTo));
    }

    return conditions;
  }

  private buildOrderBy(sort: AnnotationSort) {
    const direction = sort.dir === 'desc' ? desc : asc;
    if (sort.by === 'position') {
      return [sql`${annotationPositions.pos0} ${sql.raw(sort.dir === 'desc' ? 'desc' : 'asc')} nulls last`, direction(annotations.id)];
    }
    return [direction(annotations.createdAt), direction(annotations.id)];
  }
}
