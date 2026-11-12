import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AiConnectionTest, AiFailureCode } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiConnections, type AiConnectionRow, type NewAiConnectionRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AiConnectionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(): Promise<AiConnectionRow[]> {
    return this.db.select().from(aiConnections).orderBy(asc(aiConnections.name), asc(aiConnections.id));
  }

  async findById(id: number): Promise<AiConnectionRow | null> {
    const [row] = await this.db.select().from(aiConnections).where(eq(aiConnections.id, id)).limit(1);
    return row ?? null;
  }

  async insert(values: NewAiConnectionRow): Promise<AiConnectionRow> {
    const [row] = await this.db.insert(aiConnections).values(values).returning();
    return row;
  }

  async update(id: number, values: Partial<NewAiConnectionRow>): Promise<AiConnectionRow | null> {
    const [row] = await this.db.update(aiConnections).set(values).where(eq(aiConnections.id, id)).returning();
    return row ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(aiConnections).where(eq(aiConnections.id, id)).returning({ id: aiConnections.id });
    return rows.length > 0;
  }

  /** Keeps the first failure's time, so "failing since" means since. */
  async setFailing(id: number, code: AiFailureCode, reason: string, since: Date): Promise<void> {
    await this.db
      .update(aiConnections)
      .set({
        failingSince: sql`coalesce(${aiConnections.failingSince}, ${since.toISOString()}::timestamptz)`,
        failingCode: code,
        failingReason: reason,
      })
      .where(eq(aiConnections.id, id));
  }

  async clearFailing(id: number): Promise<void> {
    await this.db.update(aiConnections).set({ failingSince: null, failingCode: null, failingReason: null }).where(eq(aiConnections.id, id));
  }

  async setLastTest(id: number, test: AiConnectionTest): Promise<void> {
    await this.db.update(aiConnections).set({ lastTest: test }).where(eq(aiConnections.id, id));
  }
}
