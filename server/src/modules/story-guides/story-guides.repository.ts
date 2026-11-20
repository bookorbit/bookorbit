import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { STORY_GUIDE_FEATURE, type AiJobModels, type StoryGuideListDirection, type StoryGuideListSort } from '@bookorbit/types';

import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface StoryGuideBookFile {
  id: number;
  bookId: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  mediaOverlayAvailable: boolean;
}

export interface StoryGuideBook {
  id: number;
  primaryFileId: number | null;
  formatPriority: string[] | null;
  title: string | null;
}

export interface StoryGuideListFilter {
  search: string | null;
  sort: StoryGuideListSort;
  direction: StoryGuideListDirection;
  offset: number;
  limit: number;
}

/** A stored guide with the build that made it and the file it reads, before the book is described. */
export interface StoryGuideListRow {
  key: string;
  builtAt: Date;
  bytes: number;
  coverage: number;
  models: AiJobModels | null;
  costMicros: number | null;
  kind: string | null;
  seconds: number | null;
  bookId: number | null;
  fileId: number | null;
  words: number | null;
}

export interface StoryGuideModelHistoryRow {
  fast: string | null;
  careful: string | null;
  builds: number;
  averageSeconds: number | null;
  averageCostMicros: number | null;
}

export interface StoryGuideHistoryRow {
  costMicros: number;
  medianSeconds: number | null;
  models: StoryGuideModelHistoryRow[];
}

type RawGuideRow = {
  key: string;
  built_at: Date | string;
  bytes: number;
  coverage: number;
  models: AiJobModels | null;
  cost_micros: string | number | null;
  kind: string | null;
  seconds: string | number | null;
  book_id: number | null;
  file_id: number | null;
  words: number | null;
};

/** Seconds a stored guide's build ran, from its job; null once the job is gone. */
const BUILD_SECONDS = sql`case when j.finished_at > j.started_at then extract(epoch from (j.finished_at - j.started_at)) end`;

const GUIDE_SORTS: Record<StoryGuideListSort, SQL> = {
  built: sql`a.built_at`,
  title: sql`lower(m.title)`,
  cost: sql`a.cost_micros`,
  time: BUILD_SECONDS,
  size: sql`a.size`,
};

function nullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface StoryGuideBookSummary {
  title: string | null;
  coverUpdatedAt: Date | null;
  authors: string[];
}

/** The book facts story guides read: a book's files in edition order, its title and authors. */
@Injectable()
export class StoryGuidesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findBook(bookId: number): Promise<StoryGuideBook | null> {
    const [row] = await this.db
      .select({ id: books.id, primaryFileId: books.primaryFileId, formatPriority: libraries.formatPriority, title: bookMetadata.title })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ? { ...row, formatPriority: (row.formatPriority as string[] | null) ?? null } : null;
  }

  findFiles(bookId: number): Promise<StoryGuideBookFile[]> {
    return this.db
      .select({
        id: bookFiles.id,
        bookId: bookFiles.bookId,
        format: bookFiles.format,
        role: bookFiles.role,
        sizeBytes: bookFiles.sizeBytes,
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  async authorNames(bookId: number): Promise<string[]> {
    const rows = await this.db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eq(bookAuthors.bookId, bookId))
      .orderBy(asc(bookAuthors.displayOrder));
    return rows.map((row) => row.name);
  }

  /** Book titles by id, for labels on the usage page and in notifications. */
  async titles(bookIds: readonly number[]): Promise<Map<number, string | null>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: books.id, title: bookMetadata.title })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(inArray(books.id, [...bookIds]));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  /**
   * One page of stored guides with the build that made each and the file it reads. Copies of one
   * text share a guide, so each guide is shown with its lowest file id.
   */
  async listGuides(filter: StoryGuideListFilter): Promise<{ rows: StoryGuideListRow[]; total: number }> {
    const search = filter.search ? sql`and ${accentInsensitiveIlike(sql`m.title`, buildSearchPattern(filter.search))}` : sql``;
    const from = sql`
      from ai_artifacts a
      left join ai_jobs j on j.id = a.job_id
      left join lateral (
        select t.file_id, f.book_id, t.words
        from book_file_texts t
        join book_files f on f.id = t.file_id
        where t.text_key = a.subject_key
        order by t.file_id
        limit 1
      ) source on true
      left join book_metadata m on m.book_id = source.book_id
      where a.feature = ${STORY_GUIDE_FEATURE} ${search}`;
    const direction = filter.direction === 'asc' ? sql`asc` : sql`desc`;
    const [page, counted] = await Promise.all([
      this.db.execute<RawGuideRow>(sql`
        select a.subject_key as key, a.built_at, a.size as bytes, a.coverage, a.models, a.cost_micros, j.kind,
          ${BUILD_SECONDS} as seconds, source.book_id, source.file_id, source.words
        ${from}
        order by ${GUIDE_SORTS[filter.sort]} ${direction} nulls last, a.id desc
        limit ${filter.limit} offset ${filter.offset}`),
      this.db.execute<{ total: number }>(sql`select count(*)::int as total ${from}`),
    ]);
    return {
      rows: page.rows.map((row) => ({
        key: row.key,
        builtAt: new Date(row.built_at),
        bytes: row.bytes,
        coverage: row.coverage,
        models: row.models,
        costMicros: nullableNumber(row.cost_micros),
        kind: row.kind,
        seconds: nullableNumber(row.seconds),
        bookId: row.book_id,
        fileId: row.file_id,
        words: row.words,
      })),
      total: counted.rows[0]?.total ?? 0,
    };
  }

  /** What the stored guides took to build: the total spent, the middle build time, and each pair of models. */
  async guideHistory(): Promise<StoryGuideHistoryRow> {
    const from = sql`from ai_artifacts a left join ai_jobs j on j.id = a.job_id where a.feature = ${STORY_GUIDE_FEATURE}`;
    const [totals, models] = await Promise.all([
      this.db.execute<{ cost_micros: string | number | null; median_seconds: string | number | null }>(sql`
        select coalesce(sum(a.cost_micros), 0) as cost_micros,
          percentile_cont(0.5) within group (order by ${BUILD_SECONDS}) as median_seconds
        ${from}`),
      this.db.execute<{
        fast: string | null;
        careful: string | null;
        builds: number;
        average_seconds: string | number | null;
        average_cost_micros: string | number | null;
      }>(sql`
        select a.models -> 'fast' ->> 'model' as fast, a.models -> 'careful' ->> 'model' as careful, count(*)::int as builds,
          avg(${BUILD_SECONDS}) as average_seconds, avg(a.cost_micros) as average_cost_micros
        ${from}
        group by 1, 2
        order by builds desc, 1 nulls last, 2 nulls last`),
    ]);
    const total = totals.rows[0];
    return {
      costMicros: nullableNumber(total?.cost_micros ?? null) ?? 0,
      medianSeconds: nullableNumber(total?.median_seconds ?? null),
      models: models.rows.map((row) => ({
        fast: row.fast,
        careful: row.careful,
        builds: row.builds,
        averageSeconds: nullableNumber(row.average_seconds),
        averageCostMicros: nullableNumber(row.average_cost_micros),
      })),
    };
  }

  /** Title, cover version and authors in display order for each existing book, for the AI activity list. */
  async summaries(bookIds: readonly number[]): Promise<Map<number, StoryGuideBookSummary>> {
    if (bookIds.length === 0) return new Map();
    const ids = [...bookIds];
    const [rows, credits] = await Promise.all([
      this.db
        .select({ id: books.id, title: bookMetadata.title, coverUpdatedAt: bookMetadata.coverUpdatedAt })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, ids)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, ids))
        .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder)),
    ]);
    const summaries = new Map<number, StoryGuideBookSummary>(
      rows.map((row) => [row.id, { title: row.title, coverUpdatedAt: row.coverUpdatedAt, authors: [] }]),
    );
    for (const credit of credits) summaries.get(credit.bookId)?.authors.push(credit.name);
    return summaries;
  }
}
