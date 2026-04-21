import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { smartScopes } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SmartScopeDisplayOrderUpdate = { id: number; displayOrder: number };

@Injectable()
export class SmartScopeRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select()
      .from(smartScopes)
      .where(or(eq(smartScopes.userId, userId), eq(smartScopes.isPublic, true)))
      .orderBy(smartScopes.displayOrder, smartScopes.name);
  }

  findById(id: number) {
    return this.db.select().from(smartScopes).where(eq(smartScopes.id, id)).limit(1);
  }

  insert(values: typeof smartScopes.$inferInsert) {
    return this.db.insert(smartScopes).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof smartScopes.$inferInsert>) {
    return this.db
      .update(smartScopes)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(smartScopes.id, id), eq(smartScopes.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(smartScopes)
      .where(and(eq(smartScopes.id, id), eq(smartScopes.userId, userId)))
      .returning();
  }

  updateDisplayOrders(userId: number, order: SmartScopeDisplayOrderUpdate[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      let updatedCount = 0;
      for (const item of order) {
        const updatedRows = await tx
          .update(smartScopes)
          .set({ displayOrder: item.displayOrder, updatedAt: sql`now()` })
          .where(and(eq(smartScopes.id, item.id), eq(smartScopes.userId, userId)))
          .returning({ id: smartScopes.id });
        updatedCount += updatedRows.length;
      }
      return updatedCount;
    });
  }
}
