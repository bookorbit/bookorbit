import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, notInArray, or, sum, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookBucketFiles, type NewBookBucketFileRow, type BookBucketFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SORT_COLUMNS = {
  createdAt: bookBucketFiles.createdAt,
  fileName: bookBucketFiles.fileName,
  format: bookBucketFiles.format,
  status: bookBucketFiles.status,
  fileSize: bookBucketFiles.fileSize,
} as const;

export interface ListOptions {
  status?: string;
  page: number;
  limit: number;
  sort: string;
  order: string;
  search?: string;
  userId: number;
  isSuperuser: boolean;
}

export interface SelectionBatchOptions {
  limit: number;
  afterId?: number;
  excludedIds?: number[];
  status?: string;
  search?: string;
  userId: number;
  isSuperuser: boolean;
}

@Injectable()
export class BookBucketRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(opts: ListOptions): Promise<{ items: BookBucketFileRow[]; total: number }> {
    const conditions = this.buildSelectionConditions(opts.status, opts.search, opts.userId, opts.isSuperuser);

    const where = conditions.length ? and(...conditions) : undefined;

    const sortKey = opts.sort as keyof typeof SORT_COLUMNS;
    const sortCol = SORT_COLUMNS[sortKey] ?? bookBucketFiles.createdAt;
    const orderFn = opts.order === 'asc' ? asc : desc;

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(bookBucketFiles)
        .where(where)
        .orderBy(orderFn(sortCol))
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      this.db.select({ total: count() }).from(bookBucketFiles).where(where),
    ]);

    return { items, total };
  }

  async findById(id: number): Promise<BookBucketFileRow | undefined> {
    const [row] = await this.db.select().from(bookBucketFiles).where(eq(bookBucketFiles.id, id)).limit(1);
    return row;
  }

  async findByAbsolutePath(path: string): Promise<BookBucketFileRow | undefined> {
    const [row] = await this.db.select().from(bookBucketFiles).where(eq(bookBucketFiles.absolutePath, path)).limit(1);
    return row;
  }

  async create(data: NewBookBucketFileRow): Promise<BookBucketFileRow> {
    const [row] = await this.db.insert(bookBucketFiles).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<NewBookBucketFileRow>): Promise<BookBucketFileRow | undefined> {
    const [row] = await this.db.update(bookBucketFiles).set(data).where(eq(bookBucketFiles.id, id)).returning();
    return row;
  }

  async deleteById(id: number): Promise<void> {
    await this.db.delete(bookBucketFiles).where(eq(bookBucketFiles.id, id));
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(bookBucketFiles).where(inArray(bookBucketFiles.id, ids));
  }

  async deleteByAbsolutePath(path: string): Promise<void> {
    await this.db.delete(bookBucketFiles).where(eq(bookBucketFiles.absolutePath, path));
  }

  async findAllIds(excludedIds?: number[], status?: string, search?: string, userId?: number, isSuperuser?: boolean): Promise<number[]> {
    const conditions = this.buildSelectionConditions(status, search, userId, isSuperuser ?? true);
    if (excludedIds?.length) conditions.push(notInArray(bookBucketFiles.id, excludedIds));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await this.db.select({ id: bookBucketFiles.id }).from(bookBucketFiles).where(where);
    return rows.map((r) => r.id);
  }

  async findByIds(ids: number[]): Promise<BookBucketFileRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(bookBucketFiles).where(inArray(bookBucketFiles.id, ids));
  }

  async findSelectionBatch(options: SelectionBatchOptions): Promise<BookBucketFileRow[]> {
    const conditions = this.buildSelectionConditions(options.status, options.search, options.userId, options.isSuperuser);
    if (options.excludedIds?.length) conditions.push(notInArray(bookBucketFiles.id, options.excludedIds));
    if (options.afterId !== undefined) conditions.push(gt(bookBucketFiles.id, options.afterId));
    const where = conditions.length ? and(...conditions) : undefined;
    return this.db.select().from(bookBucketFiles).where(where).orderBy(asc(bookBucketFiles.id)).limit(options.limit);
  }

  async setTargetsByIds(ids: number[], targetLibraryId: number | null, targetFolderId: number | null): Promise<number> {
    if (ids.length === 0) return 0;
    const updated = await this.db
      .update(bookBucketFiles)
      .set({ targetLibraryId, targetFolderId })
      .where(inArray(bookBucketFiles.id, ids))
      .returning({ id: bookBucketFiles.id });
    return updated.length;
  }

  async countsByStatus(userId?: number, isSuperuser?: boolean): Promise<{ pending: number; ready: number; error: number; total: number }> {
    const visibilityCondition = userId !== undefined ? this.buildVisibilityCondition(userId, isSuperuser ?? true) : undefined;
    const rows = await this.db
      .select({
        status: bookBucketFiles.status,
        cnt: count(),
      })
      .from(bookBucketFiles)
      .where(visibilityCondition)
      .groupBy(bookBucketFiles.status);

    const result = { pending: 0, ready: 0, error: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.cnt);
      if (row.status === 'pending') result.pending = n;
      else if (row.status === 'ready') result.ready = n;
      else if (row.status === 'error') result.error = n;
      result.total += n;
    }
    return result;
  }

  async getStatistics(
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<{
    totalSizeBytes: number;
    byFormat: { format: string; count: number; sizeBytes: number }[];
  }> {
    const visibilityCondition = userId !== undefined ? this.buildVisibilityCondition(userId, isSuperuser ?? true) : undefined;
    const rows = await this.db
      .select({
        format: bookBucketFiles.format,
        cnt: count(),
        totalSize: sum(bookBucketFiles.fileSize),
      })
      .from(bookBucketFiles)
      .where(visibilityCondition)
      .groupBy(bookBucketFiles.format);

    let totalSizeBytes = 0;
    const byFormat = rows.map((r) => {
      const sizeBytes = Number(r.totalSize ?? 0);
      totalSizeBytes += sizeBytes;
      return { format: r.format ?? 'unknown', count: Number(r.cnt), sizeBytes };
    });

    return { totalSizeBytes, byFormat };
  }

  private buildVisibilityCondition(userId: number, isSuperuser: boolean): SQL | undefined {
    if (isSuperuser) return undefined;
    return or(eq(bookBucketFiles.uploadedBy, userId), isNull(bookBucketFiles.uploadedBy));
  }

  private buildSelectionConditions(status?: string, search?: string, userId?: number, isSuperuser?: boolean): SQL[] {
    const conditions: SQL[] = [];
    if (status === 'pending') {
      conditions.push(inArray(bookBucketFiles.status, ['pending', 'extracting', 'fetching']));
    } else if (status) {
      conditions.push(eq(bookBucketFiles.status, status));
    }
    if (search) conditions.push(ilike(bookBucketFiles.fileName, `%${search}%`));
    if (userId !== undefined && !isSuperuser) {
      conditions.push(or(eq(bookBucketFiles.uploadedBy, userId), isNull(bookBucketFiles.uploadedBy))!);
    }
    return conditions;
  }
}
