import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { BookRequestSourceStatus } from '@bookorbit/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { requestIndexers, type NewRequestIndexerRow, type RequestIndexerRow } from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class IndexerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<RequestIndexerRow[]> {
    return this.db.select().from(requestIndexers).orderBy(asc(requestIndexers.id));
  }

  async findAssignedColors(): Promise<Array<RequestIndexerRow['color']>> {
    const rows = await this.db.select({ color: requestIndexers.color }).from(requestIndexers);
    return rows.map((row) => row.color);
  }

  async findById(id: number): Promise<RequestIndexerRow | undefined> {
    const [row] = await this.db.select().from(requestIndexers).where(eq(requestIndexers.id, id)).limit(1);
    return row;
  }

  /**
   * Both counts in one pass. Read on every visit to the requests page by anybody who may file a
   * request, so it never selects the rows themselves: a count is all that surface is allowed.
   */
  async countSources(): Promise<BookRequestSourceStatus> {
    const [row] = await this.db
      .select({
        configured: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${requestIndexers.enabled})::int`,
      })
      .from(requestIndexers);
    return { configured: row?.configured ?? 0, enabled: row?.enabled ?? 0 };
  }

  /** Every enabled row. Order is stable rather than meaningful: all of them are searched. */
  async findAllEnabled(): Promise<RequestIndexerRow[]> {
    return this.db.select().from(requestIndexers).where(eq(requestIndexers.enabled, true)).orderBy(asc(requestIndexers.id));
  }

  async create(data: NewRequestIndexerRow): Promise<RequestIndexerRow> {
    const [row] = await this.db.insert(requestIndexers).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<NewRequestIndexerRow>): Promise<RequestIndexerRow | undefined> {
    const [row] = await this.db.update(requestIndexers).set(data).where(eq(requestIndexers.id, id)).returning();
    return row;
  }

  async updateCredentialIfCurrent(id: number, current: string | null, updatedAt: Date, replacement: string): Promise<boolean> {
    const result = await this.db
      .update(requestIndexers)
      .set({ credentialsEnc: replacement })
      .where(
        and(
          eq(requestIndexers.id, id),
          eq(requestIndexers.updatedAt, updatedAt),
          current === null ? isNull(requestIndexers.credentialsEnc) : eq(requestIndexers.credentialsEnc, current),
        ),
      );
    return (result.rowCount ?? 0) === 1;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(requestIndexers).where(eq(requestIndexers.id, id));
  }

  /** Asked before an uninstall deletes them, so "no such thing" is not answered by the delete itself. */
  async countByAdapterType(adapterType: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(requestIndexers)
      .where(eq(requestIndexers.adapterType, adapterType));
    return row?.count ?? 0;
  }

  async deleteByAdapterType(adapterType: string): Promise<number> {
    const result = await this.db.delete(requestIndexers).where(eq(requestIndexers.adapterType, adapterType));
    return result.rowCount ?? 0;
  }

  async recordTestResult(id: number, ok: boolean, errorMessage: string | null): Promise<void> {
    await this.db
      .update(requestIndexers)
      .set({ lastTestedAt: new Date(), lastTestOk: ok, lastErrorMessage: errorMessage })
      .where(eq(requestIndexers.id, id));
  }

  /**
   * How the last real search went, per source, written after every merged search.
   *
   * One statement for the batch: this runs on the back of every picker open, and a round trip per
   * enabled indexer on an instance with a dozen of them is a cost the search does not need to pay.
   * The streak is `+1` computed in SQL rather than read and written back, so two searches
   * finishing at once cannot both write the same number.
   */
  async recordSearchOutcomes(outcomes: ReadonlyArray<{ indexerId: number; ok: boolean; error: string | null }>): Promise<void> {
    if (outcomes.length === 0) return;

    const at = new Date();
    const ids = outcomes.map((outcome) => outcome.indexerId);
    const okCase = sql.join(
      outcomes.map((outcome) => sql`when ${requestIndexers.id} = ${outcome.indexerId} then ${outcome.ok}`),
      sql` `,
    );
    const errorCase = sql.join(
      outcomes.map((outcome) => sql`when ${requestIndexers.id} = ${outcome.indexerId} then ${outcome.error}::text`),
      sql` `,
    );
    const streakCase = sql.join(
      outcomes.map(
        (outcome) =>
          sql`when ${requestIndexers.id} = ${outcome.indexerId} then ${outcome.ok ? sql`0` : sql`${requestIndexers.searchFailureStreak} + 1`}`,
      ),
      sql` `,
    );

    await this.db
      .update(requestIndexers)
      .set({
        lastSearchAt: at,
        lastSearchOk: sql`case ${okCase} end`,
        lastSearchError: sql`case ${errorCase} end`,
        searchFailureStreak: sql`case ${streakCase} end`,
      })
      .where(and(inArray(requestIndexers.id, ids), or(isNull(requestIndexers.lastSearchAt), lt(requestIndexers.lastSearchAt, at))));
  }
}
