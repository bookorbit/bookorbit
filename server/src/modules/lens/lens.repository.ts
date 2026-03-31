import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { lenses } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type LensDisplayOrderUpdate = { id: number; displayOrder: number };

@Injectable()
export class LensRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select()
      .from(lenses)
      .where(or(eq(lenses.userId, userId), eq(lenses.isPublic, true)))
      .orderBy(lenses.displayOrder, lenses.name);
  }

  findById(id: number) {
    return this.db.select().from(lenses).where(eq(lenses.id, id)).limit(1);
  }

  insert(values: typeof lenses.$inferInsert) {
    return this.db.insert(lenses).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof lenses.$inferInsert>) {
    return this.db
      .update(lenses)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(lenses.id, id), eq(lenses.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(lenses)
      .where(and(eq(lenses.id, id), eq(lenses.userId, userId)))
      .returning();
  }

  updateDisplayOrders(userId: number, order: LensDisplayOrderUpdate[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      let updatedCount = 0;
      for (const item of order) {
        const updatedRows = await tx
          .update(lenses)
          .set({ displayOrder: item.displayOrder, updatedAt: sql`now()` })
          .where(and(eq(lenses.id, item.id), eq(lenses.userId, userId)))
          .returning({ id: lenses.id });
        updatedCount += updatedRows.length;
      }
      return updatedCount;
    });
  }
}
