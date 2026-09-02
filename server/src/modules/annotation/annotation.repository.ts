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
import { foldActivityRows, foldChapterRows } from './annotation-stats.utils';
import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../db/schema';
import {
  annotationPositions,
  annotationSyncState,
  annotations,
  authors,
  bookAuthors,
  bookFiles,
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
  pdfPos0?: string | null;
  pdfStatus?: string | null;
};
export type HubAnnotationRow = AnnotationWithCfi & { bookTitle: string | null; author: string | null; jumpFileFormat: string | null };

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
  /** Only highlights whose canonical position is not `exact`. */
  needsReview?: boolean;
  status: 'active' | 'trashed';
}

export interface HubSort {
  by: 'createdAt' | 'book' | 'color' | 'origin';
  dir: 'asc' | 'desc';
}

export interface AnnotationFilters {
  bookFileId?: number;
  colors?: string[];
  search?: string;
  chapter?: string;
  dateFrom?: Date;
  dateTo?: Date;
  hasNote?: boolean;
  /** Only annotations whose canonical position is not `exact`. */
  needsReview?: boolean;
}

export interface AnnotationSort {
  by: 'position' | 'createdAt';
  dir: 'asc' | 'desc';
}

export interface PaginatedAnnotations {
  items: AnnotationWithCfi[];
  total: number;
}

export interface AnnotationChapterStatResult {
  title: string | null;
  count: number;
  colors: { color: string; count: number }[];
  chapterIndex: number | null;
  order: number | null;
  firstCreatedAt: string;
}

export interface AnnotationActivityResult {
  day: string;
  count: number;
  origins: { origin: AnnotationRow['origin']; count: number }[];
}

export interface AnnotationStatsResult {
  totalHighlights: number;
  colorBreakdown: { color: string; count: number }[];
  originBreakdown: { origin: AnnotationRow['origin']; count: number }[];
  chaptersWithHighlights: number;
  highlightsWithNotes: number;
  highlightsNeedingReview: number;
  chapterBreakdown: AnnotationChapterStatResult[];
  activity: AnnotationActivityResult[];
}

@Injectable()
export class AnnotationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private hubColumns() {
    const jumpFileId = sql<number | null>`coalesce(
      ${annotationPositions.bookFileId},
      (select ap2.book_file_id from annotation_positions ap2 where ap2.annotation_id = ${annotations.id} and ap2.format in ('xpointer', 'pdf') limit 1),
      ${books.primaryFileId}
    )`;
    return {
      ...getTableColumns(annotations),
      cfi: annotationPositions.pos0,
      cfiStatus: annotationPositions.status,
      cfiExtras: annotationPositions.extras,
      bookTitle: bookMetadata.title,
      author: sql<
        string | null
      >`(select string_agg(${authors.name}, ', ' order by ${bookAuthors.displayOrder}) from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${annotations.bookId})`,
      jumpFileId,
      jumpFileFormat: sql<string | null>`(select ${bookFiles.format} from ${bookFiles} where ${bookFiles.id} = ${jumpFileId} limit 1)`,
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
        pdfPos0: sql<
          string | null
        >`(select ap4.pos0 from annotation_positions ap4 where ap4.annotation_id = ${annotations.id} and ap4.format = 'pdf' limit 1)`,
        pdfStatus: sql<
          string | null
        >`(select ap5.status from annotation_positions ap5 where ap5.annotation_id = ${annotations.id} and ap5.format = 'pdf' limit 1)`,
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
    // The review chip's own total, so it does not collapse to the filtered count once on.
    const reviewConditions = this.buildConditions(bookId, userId, { ...filters, needsReview: undefined });

    const [aggregateResult, colorResult, originResult, chapterResult, activityResult, reviewResult] = await Promise.all([
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
      this.db
        .select({
          title: annotations.chapterTitle,
          color: annotations.color,
          count: count(),
          chapterIndex: sql<number | null>`min((${annotationPositions.extras} ->> 'chapterIndex')::int)`,
          // The step after `/6` in an epub CFI addresses the spine itemref. Kept raw here and
          // converted to a spine index in foldChapterRows, where it can be tested.
          cfiSpineStep: sql<number | null>`min(nullif(substring(${annotationPositions.pos0} from 'epubcfi[(]/6/([0-9]+)'), '')::int)`,
          firstCreatedAt: sql<Date>`min(${annotations.createdAt})`,
        })
        .from(annotations)
        .leftJoin(annotationPositions, cfiJoin)
        .where(and(...conditions))
        .groupBy(annotations.chapterTitle, annotations.color),
      this.db
        .select({
          day: sql<string>`to_char(${annotations.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
          origin: annotations.origin,
          count: count(),
        })
        .from(annotations)
        .leftJoin(annotationPositions, cfiJoin)
        .where(and(...conditions))
        .groupBy(sql`1`, annotations.origin),
      this.db
        .select({ total: count() })
        .from(annotations)
        .innerJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
        .where(and(...reviewConditions, sql`${annotationPositions.status} <> 'exact'`)),
    ]);

    const agg = aggregateResult[0];

    return {
      totalHighlights: agg?.totalHighlights ?? 0,
      chaptersWithHighlights: agg?.chaptersWithHighlights ?? 0,
      highlightsWithNotes: agg?.highlightsWithNotes ?? 0,
      highlightsNeedingReview: Number(reviewResult[0]?.total ?? 0),
      colorBreakdown: colorResult.map((r) => ({ color: r.color, count: r.count })),
      originBreakdown: originResult.map((r) => ({ origin: r.origin, count: r.count })),
      chapterBreakdown: foldChapterRows(chapterResult),
      activity: foldActivityRows(activityResult),
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

  /**
   * Creates an annotation and its `pdf` position in one transaction. The geometry JSON is
   * stored in pos0, the 1-based page in `extras.pageno` (so the hub can derive a page deep
   * link), and bookFileId anchors the jump target. Returns the row shaped like the read model.
   */
  async createPdf(data: NewAnnotation & { bookFileId?: number | null }, pdf: { page: number; pos0: string }): Promise<AnnotationWithCfi> {
    const { bookFileId, ...annotationData } = data;
    const pageno = pdf.page + 1;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(annotations).values(annotationData).returning();
      await tx.insert(annotationPositions).values({
        annotationId: row.id,
        userId: row.userId,
        bookFileId: bookFileId ?? null,
        format: 'pdf',
        pos0: pdf.pos0,
        status: 'exact',
        extras: { pageno },
      });
      return {
        ...row,
        cfi: null,
        cfiStatus: null,
        cfiExtras: null,
        jumpFileId: bookFileId ?? null,
        pageno,
        pdfPos0: pdf.pos0,
        pdfStatus: 'exact',
      };
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
    // The hub groups a page at a time, so a grouped run only ever lands whole when the
    // rows arrive already ordered by the grouping key. Every non-date sort therefore
    // falls back to newest-first inside the group.
    const withinGroup = [desc(annotations.createdAt), desc(annotations.id)];
    const orderBy =
      sort.by === 'book'
        ? [direction(bookMetadata.title), ...withinGroup]
        : sort.by === 'color'
          ? [direction(annotations.color), ...withinGroup]
          : sort.by === 'origin'
            ? [direction(annotations.origin), ...withinGroup]
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

  async countHub(userId: number, filters: HubFilters): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(annotations)
      .where(and(...this.buildHubConditions(userId, filters)));
    return Number(row?.total ?? 0);
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

  /** Library-wide colour composition, ordered heaviest first for the hub's colour band. */
  async getHubColorBreakdown(userId: number, filters: HubFilters) {
    return this.db
      .select({ color: annotations.color, count: count() })
      .from(annotations)
      .where(and(...this.buildHubConditions(userId, filters)))
      .groupBy(annotations.color)
      .orderBy(desc(count()), asc(annotations.color));
  }

  /**
   * Highlights whose canonical position is not `exact`. A row with no cfi position at all
   * is not counted: nothing was ever resolved for it, so there is nothing to review.
   */
  async countHubNeedsReview(userId: number, filters: HubFilters): Promise<number> {
    // Deliberately drops `needsReview`: this is the count the chip shows, and it has to
    // keep reading 132 while the filter it toggles is on.
    const rest: HubFilters = { ...filters, needsReview: undefined };
    const [row] = await this.db
      .select({ total: count() })
      .from(annotations)
      .innerJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
      .where(and(...this.buildHubConditions(userId, rest), sql`${annotationPositions.status} <> 'exact'`));
    return Number(row?.total ?? 0);
  }

  /** The whole trash, deliberately ignoring the caller's status filter. */
  async countHubTrashed(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), isNotNull(annotations.deletedAt)));
    return Number(row?.total ?? 0);
  }

  /**
   * Weekly marking activity, bucketed on Monday in UTC to match the day buckets the book
   * tab already uses. Grouping by `(week, origin)` in one pass gives the totals and the
   * stacked composition together.
   */
  async getHubActivityWeeks(userId: number, filters: HubFilters, since: Date) {
    return this.db
      .select({
        weekStart: sql<string>`to_char(date_trunc('week', ${annotations.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        origin: annotations.origin,
        count: count(),
      })
      .from(annotations)
      .where(and(...this.buildHubConditions(userId, filters), gte(annotations.createdAt, since)))
      .groupBy(sql`1`, annotations.origin)
      .orderBy(sql`1`);
  }

  /**
   * Every device that has ever exchanged annotations, collapsed to one row each. `behind`
   * counts rows the device has not acknowledged at the canonical version, which is what
   * makes "did my Kobo's highlights arrive" a question this page can answer at all.
   */
  async getHubDeviceSummary(userId: number) {
    return this.db
      .select({
        source: annotationSyncState.source,
        deviceId: annotationSyncState.deviceId,
        annotations: count(),
        behind: sql<number>`count(*) filter (where ${annotationSyncState.lastAppliedVersion} < ${annotations.version} and ${annotations.deletedAt} is null)`,
        lastSyncedAt: max(annotationSyncState.lastSyncedAt),
      })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(eq(annotationSyncState.userId, userId))
      .groupBy(annotationSyncState.source, annotationSyncState.deviceId)
      .orderBy(desc(max(annotationSyncState.lastSyncedAt)));
  }

  private bookFacetAuthorSql() {
    return sql<
      string | null
    >`(select string_agg(${authors.name}, ', ' order by ${bookAuthors.displayOrder}) from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${annotations.bookId})`;
  }

  /**
   * `recent` is what the filter combobox wants: the books you just marked, first.
   * `count` is what the hub's shelf wants: the books you have marked most.
   */
  async findHubBookFacets(userId: number, params: { status: 'active' | 'trashed'; q?: string; limit: number; order?: 'recent' | 'count' }) {
    const conditions: SQL[] = [
      eq(annotations.userId, userId),
      params.status === 'trashed' ? isNotNull(annotations.deletedAt) : isNull(annotations.deletedAt),
    ];
    const term = params.q?.trim();
    if (term) {
      const pattern = `%${term}%`;
      conditions.push(
        or(
          accentInsensitiveIlike(bookMetadata.title, pattern),
          sql`exists (select 1 from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${annotations.bookId} and ${accentInsensitiveIlike(authors.name, pattern)})`,
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
      .orderBy(...(params.order === 'count' ? [desc(count()), asc(bookMetadata.title)] : [desc(max(annotations.createdAt)), asc(bookMetadata.title)]))
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
      conditions.push(or(accentInsensitiveIlike(annotations.text, pattern), accentInsensitiveIlike(annotations.note, pattern))!);
    }
    if (filters.hasNote) conditions.push(sql`${annotations.note} is not null and ${annotations.note} <> ''`);
    // An EXISTS rather than a join: buildHubConditions is shared with the aggregates,
    // and a join there would multiply the counts it is asked for.
    if (filters.needsReview) {
      conditions.push(
        sql`exists (select 1 from ${annotationPositions} where ${annotationPositions.annotationId} = ${annotations.id} and ${annotationPositions.format} = 'cfi' and ${annotationPositions.status} <> 'exact')`,
      );
    }
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

    if (filters.bookFileId !== undefined) {
      conditions.push(
        sql`exists (select 1 from ${annotationPositions} ap_file where ap_file.annotation_id = ${annotations.id} and ap_file.book_file_id = ${filters.bookFileId})`,
      );
    }

    if (filters.colors && filters.colors.length > 0) {
      conditions.push(inArray(annotations.color, filters.colors));
    }
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(or(accentInsensitiveIlike(annotations.text, pattern), accentInsensitiveIlike(annotations.note, pattern))!);
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
    if (filters.hasNote) {
      conditions.push(sql`${annotations.note} is not null and ${annotations.note} <> ''`);
    }
    // EXISTS rather than a join: these conditions also feed getStats, where a join would
    // multiply every aggregate it is asked for.
    if (filters.needsReview) {
      conditions.push(
        sql`exists (select 1 from ${annotationPositions} where ${annotationPositions.annotationId} = ${annotations.id} and ${annotationPositions.format} = 'cfi' and ${annotationPositions.status} <> 'exact')`,
      );
    }

    return conditions;
  }

  private buildOrderBy(sort: AnnotationSort) {
    const direction = sort.dir === 'desc' ? desc : asc;
    if (sort.by === 'position') {
      const sqlDirection = sql.raw(sort.dir === 'desc' ? 'desc' : 'asc');
      const pdfPage = sql`(
        select case
          when ap_pdf.extras ->> 'pageno' ~ '^[0-9]+$' then (ap_pdf.extras ->> 'pageno')::int
          else null
        end
        from ${annotationPositions} ap_pdf
        where ap_pdf.annotation_id = ${annotations.id} and ap_pdf.format = 'pdf'
        limit 1
      )`;
      const pdfY = sql`(
        select ((regexp_match(ap_pdf.pos0, '"y"[[:space:]]*:[[:space:]]*(-?[0-9]+(?:[.][0-9]+)?)'))[1])::numeric
        from ${annotationPositions} ap_pdf
        where ap_pdf.annotation_id = ${annotations.id} and ap_pdf.format = 'pdf'
        limit 1
      )`;
      return [
        sql`${pdfPage} ${sqlDirection} nulls last`,
        sql`${pdfY} ${sqlDirection} nulls last`,
        sql`${annotationPositions.pos0} ${sqlDirection} nulls last`,
        direction(annotations.id),
      ];
    }
    return [direction(annotations.createdAt), direction(annotations.id)];
  }
}
