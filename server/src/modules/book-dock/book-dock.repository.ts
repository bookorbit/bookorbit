import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql, sum, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../db/schema';
import {
  bookDockFiles,
  bookDockUnitFiles,
  bookFiles,
  books,
  type BookDockFileRow,
  type BookDockUnitFileRow,
  type NewBookDockFileRow,
  type NewBookDockUnitFileRow,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SORT_COLUMNS = {
  createdAt: bookDockFiles.createdAt,
  fileName: bookDockFiles.fileName,
  format: bookDockFiles.format,
  status: bookDockFiles.status,
  fileSize: bookDockFiles.fileSize,
} as const;

/**
 * Sidecars carry no sort order, so they sort after the content files rather than before them.
 *
 * The direction sits inside the fragment on purpose: wrapping it as `asc(sql\`... nulls last\`)`
 * renders `sort_order nulls last asc`, which Postgres rejects outright. Exported so the SQL it
 * produces can be read in a test rather than assumed.
 */
export const UNIT_FILE_ORDER = [sql`${bookDockUnitFiles.sortOrder} asc nulls last`, asc(bookDockUnitFiles.id)] as const;

/** Below this, a provider match is treated as a guess the user should confirm. */
export const NEEDS_REVIEW_CONFIDENCE_BELOW = 70;

/**
 * A file is ready to file but still wants a human: either nothing decided where it
 * goes, or the provider match is too weak to trust. Both are plain indexed columns,
 * so this stays a WHERE clause rather than post-filtering a page in memory.
 */
/** Exactly what finalize accepts: ready, with both halves of a destination resolved. */
function readyToFileCondition(): SQL {
  return and(eq(bookDockFiles.status, 'ready'), isNotNull(bookDockFiles.targetLibraryId), isNotNull(bookDockFiles.targetFolderId)) as SQL;
}

function needsReviewCondition(): SQL {
  return and(
    eq(bookDockFiles.status, 'ready'),
    or(isNull(bookDockFiles.targetLibraryId), isNull(bookDockFiles.targetFolderId), lt(bookDockFiles.confidence, NEEDS_REVIEW_CONFIDENCE_BELOW)),
  ) as SQL;
}

export interface ListOptions {
  status?: string;
  needsReview?: boolean;
  page: number;
  limit: number;
  sort: string;
  order: string;
  search?: string;
  userId: number;
  canManageAll: boolean;
}

export interface SelectionBatchOptions {
  limit: number;
  afterId?: number;
  excludedIds?: number[];
  status?: string;
  needsReview?: boolean;
  search?: string;
  userId: number;
  canManageAll: boolean;
}

@Injectable()
export class BookDockRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(opts: ListOptions): Promise<{ items: BookDockFileRow[]; total: number }> {
    const conditions = this.buildSelectionConditions(opts.status, opts.search, opts.userId, opts.canManageAll, opts.needsReview);

    const where = conditions.length ? and(...conditions) : undefined;

    const orderFn = opts.order === 'asc' ? asc : desc;
    const orderBy =
      opts.sort === 'attention'
        ? [this.attentionRank(), desc(bookDockFiles.createdAt), desc(bookDockFiles.id)]
        : [orderFn(SORT_COLUMNS[opts.sort as keyof typeof SORT_COLUMNS] ?? bookDockFiles.createdAt), orderFn(bookDockFiles.id)];

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(bookDockFiles)
        .where(where)
        .orderBy(...orderBy)
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      this.db.select({ total: count() }).from(bookDockFiles).where(where),
    ]);

    return { items, total };
  }

  /**
   * Decisions first, then failures, then settled files, then work still in flight -
   * which the client also surfaces as a progress readout, so it never needs the top
   * of the list.
   */
  private attentionRank(): SQL {
    return sql`case
      when ${needsReviewCondition()} then 0
      when ${bookDockFiles.status} = 'error' then 1
      when ${bookDockFiles.status} = 'ready' then 2
      when ${bookDockFiles.status} = 'pending' then 3
      else 4 end`;
  }

  async findById(id: number): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.select().from(bookDockFiles).where(eq(bookDockFiles.id, id)).limit(1);
    return row;
  }

  async findByAbsolutePath(path: string): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.select().from(bookDockFiles).where(eq(bookDockFiles.absolutePath, path)).limit(1);
    return row;
  }

  async create(data: NewBookDockFileRow): Promise<BookDockFileRow> {
    const [row] = await this.db.insert(bookDockFiles).values(data).returning();
    return row;
  }

  /**
   * The anchor row and its children in one transaction. A unit that exists in the list without
   * knowing which files it is made of would be finalized as a single file, which is the exact
   * truncation this whole feature exists to stop.
   */
  async createUnit(data: NewBookDockFileRow, files: Array<Omit<NewBookDockUnitFileRow, 'dockFileId'>>): Promise<BookDockFileRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(bookDockFiles).values(data).returning();
      if (files.length > 0) {
        await tx.insert(bookDockUnitFiles).values(files.map((file) => ({ ...file, dockFileId: row.id })));
      }
      return row;
    });
  }

  async findUnitFiles(dockFileId: number): Promise<BookDockUnitFileRow[]> {
    return this.db
      .select()
      .from(bookDockUnitFiles)
      .where(eq(bookDockUnitFiles.dockFileId, dockFileId))
      .orderBy(...UNIT_FILE_ORDER);
  }

  /** One query for a page of rows, so rendering a list of units is not an N+1. */
  async findUnitFilesByDockFileIds(dockFileIds: number[]): Promise<Map<number, BookDockUnitFileRow[]>> {
    const byDockFile = new Map<number, BookDockUnitFileRow[]>();
    if (dockFileIds.length === 0) return byDockFile;

    const rows = await this.db
      .select()
      .from(bookDockUnitFiles)
      .where(inArray(bookDockUnitFiles.dockFileId, dockFileIds))
      .orderBy(...UNIT_FILE_ORDER);

    for (const row of rows) {
      const existing = byDockFile.get(row.dockFileId);
      if (existing) existing.push(row);
      else byDockFile.set(row.dockFileId, [row]);
    }
    return byDockFile;
  }

  /**
   * Whether a directory is already owned by a unit row. The watcher asks this of the first path
   * segment below the dock root, which is why it can be an equality lookup on a unique column.
   */
  async findByUnitDirectory(unitDirectory: string): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.select().from(bookDockFiles).where(eq(bookDockFiles.unitDirectory, unitDirectory)).limit(1);
    return row;
  }

  async update(id: number, data: Partial<NewBookDockFileRow>): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.update(bookDockFiles).set(data).where(eq(bookDockFiles.id, id)).returning();
    return row;
  }

  async deleteById(id: number): Promise<void> {
    await this.db.delete(bookDockFiles).where(eq(bookDockFiles.id, id));
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(bookDockFiles).where(inArray(bookDockFiles.id, ids));
  }

  async deleteByAbsolutePath(path: string): Promise<void> {
    await this.db.delete(bookDockFiles).where(eq(bookDockFiles.absolutePath, path));
  }

  async findAllIds(
    excludedIds?: number[],
    status?: string,
    search?: string,
    userId?: number,
    canManageAll?: boolean,
    needsReview?: boolean,
  ): Promise<number[]> {
    const conditions = this.buildSelectionConditions(status, search, userId, canManageAll ?? true, needsReview);
    if (excludedIds?.length) conditions.push(notInArray(bookDockFiles.id, excludedIds));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await this.db.select({ id: bookDockFiles.id }).from(bookDockFiles).where(where);
    return rows.map((r) => r.id);
  }

  async findByIds(ids: number[], userId?: number, canManageAll?: boolean): Promise<BookDockFileRow[]> {
    if (ids.length === 0) return [];
    const conditions: SQL[] = [inArray(bookDockFiles.id, ids)];
    if (userId !== undefined && !canManageAll) {
      conditions.push(eq(bookDockFiles.uploadedBy, userId));
    }
    return this.db
      .select()
      .from(bookDockFiles)
      .where(and(...conditions));
  }

  async findExistingBooksByAbsolutePaths(absolutePaths: string[]): Promise<Array<{ absolutePath: string; bookId: number; libraryId: number }>> {
    const paths = [...new Set(absolutePaths)];
    if (paths.length === 0) return [];

    return this.db
      .select({
        absolutePath: bookFiles.absolutePath,
        bookId: bookFiles.bookId,
        libraryId: books.libraryId,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(inArray(bookFiles.absolutePath, paths));
  }

  async findSelectionBatch(options: SelectionBatchOptions): Promise<BookDockFileRow[]> {
    const conditions = this.buildSelectionConditions(options.status, options.search, options.userId, options.canManageAll, options.needsReview);
    if (options.excludedIds?.length) conditions.push(notInArray(bookDockFiles.id, options.excludedIds));
    if (options.afterId !== undefined) conditions.push(gt(bookDockFiles.id, options.afterId));
    const where = conditions.length ? and(...conditions) : undefined;
    return this.db.select().from(bookDockFiles).where(where).orderBy(asc(bookDockFiles.id)).limit(options.limit);
  }

  async setTargetsByIds(ids: number[], targetLibraryId: number | null, targetFolderId: number | null): Promise<number> {
    if (ids.length === 0) return 0;
    const updated = await this.db
      .update(bookDockFiles)
      .set({ targetLibraryId, targetFolderId })
      .where(inArray(bookDockFiles.id, ids))
      .returning({ id: bookDockFiles.id });
    return updated.length;
  }

  async countsByStatus(
    userId?: number,
    canManageAll?: boolean,
  ): Promise<{ pending: number; working: number; ready: number; error: number; needsReview: number; readyToFile: number; total: number }> {
    const visibilityCondition = userId !== undefined ? this.buildVisibilityCondition(userId, canManageAll ?? true) : undefined;

    // A filtered aggregate keeps this to one round trip: only the 'ready' group can
    // contribute, since needing review presupposes the file is otherwise done.
    const rows = await this.db
      .select({
        status: bookDockFiles.status,
        cnt: count(),
        needsReview: sql<number>`count(*) filter (where ${needsReviewCondition()})`,
        readyToFile: sql<number>`count(*) filter (where ${readyToFileCondition()})`,
      })
      .from(bookDockFiles)
      .where(visibilityCondition)
      .groupBy(bookDockFiles.status);

    // `pending` keeps its existing meaning of everything not yet settled, so clients
    // that already read it are unaffected; `working` is the in-flight subset of it.
    const result = { pending: 0, working: 0, ready: 0, error: 0, needsReview: 0, readyToFile: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.cnt);
      if (row.status === 'pending' || row.status === 'extracting' || row.status === 'fetching') {
        result.pending += n;
        if (row.status !== 'pending') result.working += n;
      } else if (row.status === 'ready') result.ready = n;
      else if (row.status === 'error') result.error = n;
      result.needsReview += Number(row.needsReview ?? 0);
      result.readyToFile += Number(row.readyToFile ?? 0);
      result.total += n;
    }
    return result;
  }

  async getStatistics(
    userId?: number,
    canManageAll?: boolean,
  ): Promise<{
    totalSizeBytes: number;
    byFormat: { format: string; count: number; sizeBytes: number }[];
  }> {
    const visibilityCondition = userId !== undefined ? this.buildVisibilityCondition(userId, canManageAll ?? true) : undefined;
    const rows = await this.db
      .select({
        format: bookDockFiles.format,
        cnt: count(),
        totalSize: sum(bookDockFiles.fileSize),
      })
      .from(bookDockFiles)
      .where(visibilityCondition)
      .groupBy(bookDockFiles.format);

    let totalSizeBytes = 0;
    const byFormat = rows.map((r) => {
      const sizeBytes = Number(r.totalSize ?? 0);
      totalSizeBytes += sizeBytes;
      return { format: r.format ?? 'unknown', count: Number(r.cnt), sizeBytes };
    });

    return { totalSizeBytes, byFormat };
  }

  private buildVisibilityCondition(userId: number, canManageAll: boolean): SQL | undefined {
    if (canManageAll) return undefined;
    return eq(bookDockFiles.uploadedBy, userId);
  }

  private buildSelectionConditions(status?: string, search?: string, userId?: number, canManageAll?: boolean, needsReview?: boolean): SQL[] {
    const conditions: SQL[] = [];
    if (status === 'pending') {
      conditions.push(inArray(bookDockFiles.status, ['pending', 'extracting', 'fetching']));
    } else if (status) {
      conditions.push(eq(bookDockFiles.status, status));
    }
    if (needsReview) conditions.push(needsReviewCondition());
    if (search) conditions.push(accentInsensitiveIlike(bookDockFiles.fileName, `%${search}%`));
    if (userId !== undefined && !canManageAll) {
      conditions.push(eq(bookDockFiles.uploadedBy, userId));
    }
    return conditions;
  }
}
