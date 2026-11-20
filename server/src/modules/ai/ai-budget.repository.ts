import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiBudgetReservations, aiUsage } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'execute'>;

export interface AiReservation {
  jobId: string;
  feature: string;
  month: string;
  amountMicros: number;
  releasedAt: Date | null;
}

/** Serialises reservations across server instances, so two builds cannot both take the last dollars. */
const RESERVATION_LOCK = 'bookorbit:ai-budget-reservations';

/** What the budget needs from the database. One interface so tests can hold it in memory. */
export interface AiBudgetStore {
  /** Runs `work` alone among reservation changes, inside one transaction. */
  locked<T>(work: (store: AiBudgetStore) => Promise<T>): Promise<T>;
  spentMicros(month: string, feature?: string): Promise<number>;
  jobSpentMicros(jobIds: string[]): Promise<Map<string, number>>;
  activeReservations(): Promise<AiReservation[]>;
  findReservation(jobId: string): Promise<AiReservation | null>;
  buildsInMonth(month: string, feature?: string): Promise<number>;
  upsertReservation(reservation: Omit<AiReservation, 'releasedAt'>): Promise<void>;
  release(jobIds: string[], at: Date): Promise<void>;
}

@Injectable()
export class AiBudgetRepository implements AiBudgetStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  locked<T>(work: (store: AiBudgetStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${RESERVATION_LOCK})::bigint)`);
      return work(new ExecutorBudgetStore(tx));
    });
  }

  spentMicros(month: string, feature?: string): Promise<number> {
    return new ExecutorBudgetStore(this.db).spentMicros(month, feature);
  }

  jobSpentMicros(jobIds: string[]): Promise<Map<string, number>> {
    return new ExecutorBudgetStore(this.db).jobSpentMicros(jobIds);
  }

  activeReservations(): Promise<AiReservation[]> {
    return new ExecutorBudgetStore(this.db).activeReservations();
  }

  findReservation(jobId: string): Promise<AiReservation | null> {
    return new ExecutorBudgetStore(this.db).findReservation(jobId);
  }

  buildsInMonth(month: string, feature?: string): Promise<number> {
    return new ExecutorBudgetStore(this.db).buildsInMonth(month, feature);
  }

  upsertReservation(reservation: Omit<AiReservation, 'releasedAt'>): Promise<void> {
    return new ExecutorBudgetStore(this.db).upsertReservation(reservation);
  }

  release(jobIds: string[], at: Date): Promise<void> {
    return new ExecutorBudgetStore(this.db).release(jobIds, at);
  }
}

class ExecutorBudgetStore implements AiBudgetStore {
  constructor(private readonly db: Executor) {}

  locked<T>(work: (store: AiBudgetStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  async spentMicros(month: string, feature?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${aiUsage.costMicros}), 0)` })
      .from(aiUsage)
      .where(feature ? and(eq(aiUsage.month, month), eq(aiUsage.feature, feature)) : eq(aiUsage.month, month));
    return Number(row?.total ?? 0);
  }

  async jobSpentMicros(jobIds: string[]): Promise<Map<string, number>> {
    if (jobIds.length === 0) return new Map();
    const rows = await this.db
      .select({ jobId: aiUsage.jobId, total: sql<string>`coalesce(sum(${aiUsage.costMicros}), 0)` })
      .from(aiUsage)
      .where(inArray(aiUsage.jobId, jobIds))
      .groupBy(aiUsage.jobId);
    return new Map(rows.map((row) => [row.jobId as string, Number(row.total)]));
  }

  async activeReservations(): Promise<AiReservation[]> {
    return this.db.select().from(aiBudgetReservations).where(isNull(aiBudgetReservations.releasedAt));
  }

  async findReservation(jobId: string): Promise<AiReservation | null> {
    const [row] = await this.db.select().from(aiBudgetReservations).where(eq(aiBudgetReservations.jobId, jobId)).limit(1);
    return row ?? null;
  }

  async buildsInMonth(month: string, feature?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(aiBudgetReservations)
      .where(feature ? and(eq(aiBudgetReservations.month, month), eq(aiBudgetReservations.feature, feature)) : eq(aiBudgetReservations.month, month));
    return Number(row?.total ?? 0);
  }

  async upsertReservation(reservation: Omit<AiReservation, 'releasedAt'>): Promise<void> {
    await this.db
      .insert(aiBudgetReservations)
      .values({ ...reservation, releasedAt: null })
      .onConflictDoUpdate({
        target: aiBudgetReservations.jobId,
        set: { amountMicros: reservation.amountMicros, releasedAt: null },
      });
  }

  async release(jobIds: string[], at: Date): Promise<void> {
    if (jobIds.length === 0) return;
    await this.db
      .update(aiBudgetReservations)
      .set({ releasedAt: at })
      .where(and(inArray(aiBudgetReservations.jobId, jobIds), isNull(aiBudgetReservations.releasedAt)));
  }
}
