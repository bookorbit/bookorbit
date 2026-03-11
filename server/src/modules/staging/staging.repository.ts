import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, asc, eq, ilike, inArray, notInArray, sum, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { stagingFiles, type NewStagingFileRow, type StagingFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SORT_COLUMNS = {
  createdAt: stagingFiles.createdAt,
  fileName: stagingFiles.fileName,
  format: stagingFiles.format,
  status: stagingFiles.status,
  fileSize: stagingFiles.fileSize,
} as const;

export interface ListOptions {
  status?: string;
  page: number;
  limit: number;
  sort: string;
  order: string;
  search?: string;
}

@Injectable()
export class StagingRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(opts: ListOptions): Promise<{ items: StagingFileRow[]; total: number }> {
    const conditions = this.buildSelectionConditions(opts.status, opts.search);

    const where = conditions.length ? and(...conditions) : undefined;

    const sortKey = opts.sort as keyof typeof SORT_COLUMNS;
    const sortCol = SORT_COLUMNS[sortKey] ?? stagingFiles.createdAt;
    const orderFn = opts.order === 'asc' ? asc : desc;

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(stagingFiles)
        .where(where)
        .orderBy(orderFn(sortCol))
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      this.db.select({ total: count() }).from(stagingFiles).where(where),
    ]);

    return { items, total };
  }

  async findById(id: number): Promise<StagingFileRow | undefined> {
    const [row] = await this.db.select().from(stagingFiles).where(eq(stagingFiles.id, id)).limit(1);
    return row;
  }

  async findByAbsolutePath(path: string): Promise<StagingFileRow | undefined> {
    const [row] = await this.db.select().from(stagingFiles).where(eq(stagingFiles.absolutePath, path)).limit(1);
    return row;
  }

  async create(data: NewStagingFileRow): Promise<StagingFileRow> {
    const [row] = await this.db.insert(stagingFiles).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<NewStagingFileRow>): Promise<StagingFileRow | undefined> {
    const [row] = await this.db.update(stagingFiles).set(data).where(eq(stagingFiles.id, id)).returning();
    return row;
  }

  async deleteById(id: number): Promise<void> {
    await this.db.delete(stagingFiles).where(eq(stagingFiles.id, id));
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(stagingFiles).where(inArray(stagingFiles.id, ids));
  }

  async deleteByAbsolutePath(path: string): Promise<void> {
    await this.db.delete(stagingFiles).where(eq(stagingFiles.absolutePath, path));
  }

  async findAllIds(excludedIds?: number[], status?: string, search?: string): Promise<number[]> {
    const conditions = this.buildSelectionConditions(status, search);
    if (excludedIds?.length) conditions.push(notInArray(stagingFiles.id, excludedIds));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await this.db.select({ id: stagingFiles.id }).from(stagingFiles).where(where);
    return rows.map((r) => r.id);
  }

  async findByIds(ids: number[]): Promise<StagingFileRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(stagingFiles).where(inArray(stagingFiles.id, ids));
  }

  async countsByStatus(): Promise<{ pending: number; ready: number; error: number; total: number }> {
    const rows = await this.db
      .select({
        status: stagingFiles.status,
        cnt: count(),
      })
      .from(stagingFiles)
      .groupBy(stagingFiles.status);

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

  async getStatistics(): Promise<{
    totalSizeBytes: number;
    byFormat: { format: string; count: number; sizeBytes: number }[];
  }> {
    const rows = await this.db
      .select({
        format: stagingFiles.format,
        cnt: count(),
        totalSize: sum(stagingFiles.fileSize),
      })
      .from(stagingFiles)
      .groupBy(stagingFiles.format);

    let totalSizeBytes = 0;
    const byFormat = rows.map((r) => {
      const sizeBytes = Number(r.totalSize ?? 0);
      totalSizeBytes += sizeBytes;
      return { format: r.format ?? 'unknown', count: Number(r.cnt), sizeBytes };
    });

    return { totalSizeBytes, byFormat };
  }

  private buildSelectionConditions(status?: string, search?: string): SQL[] {
    const conditions: SQL[] = [];
    if (status === 'pending') {
      conditions.push(inArray(stagingFiles.status, ['pending', 'extracting', 'fetching']));
    } else if (status) {
      conditions.push(eq(stagingFiles.status, status));
    }
    if (search) conditions.push(ilike(stagingFiles.fileName, `%${search}%`));
    return conditions;
  }
}
