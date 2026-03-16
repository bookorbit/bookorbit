import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { collectionBooks, collections } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const collectionFields = {
  id: collections.id,
  userId: collections.userId,
  name: collections.name,
  icon: collections.icon,
  description: collections.description,
  syncToKobo: collections.syncToKobo,
  displayOrder: collections.displayOrder,
  createdAt: collections.createdAt,
  updatedAt: collections.updatedAt,
  bookCount: count(collectionBooks.bookId),
};

@Injectable()
export class CollectionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select(collectionFields)
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .where(eq(collections.userId, userId))
      .groupBy(collections.id, collections.userId)
      .orderBy(collections.displayOrder, collections.name);
  }

  findAllForUserWithMembership(userId: number, bookIds: number[]) {
    const bookIdList = sql.join(
      bookIds.map((id) => sql`${id}`),
      sql`, `,
    );
    return this.db
      .select({
        ...collectionFields,
        memberCount: sql<number>`count(case when ${collectionBooks.bookId} in (${bookIdList}) then 1 end)::int`,
      })
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .where(eq(collections.userId, userId))
      .groupBy(collections.id, collections.userId)
      .orderBy(collections.displayOrder, collections.name);
  }

  findById(id: number) {
    return this.db
      .select(collectionFields)
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .where(eq(collections.id, id))
      .groupBy(collections.id, collections.userId)
      .limit(1);
  }

  insert(values: typeof collections.$inferInsert) {
    return this.db.insert(collections).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof collections.$inferInsert>) {
    return this.db
      .update(collections)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
  }

  addBooks(collectionId: number, bookIds: number[]) {
    const values = bookIds.map((bookId) => ({ collectionId, bookId }));
    return this.db.insert(collectionBooks).values(values).onConflictDoNothing().returning();
  }

  removeBooks(collectionId: number, bookIds: number[]) {
    return this.db
      .delete(collectionBooks)
      .where(and(eq(collectionBooks.collectionId, collectionId), inArray(collectionBooks.bookId, bookIds)))
      .returning();
  }

  findBookIds(collectionId: number) {
    return this.db.select({ bookId: collectionBooks.bookId }).from(collectionBooks).where(eq(collectionBooks.collectionId, collectionId));
  }

  async updateDisplayOrders(userId: number, order: { id: number; displayOrder: number }[]) {
    for (const item of order) {
      await this.db
        .update(collections)
        .set({ displayOrder: item.displayOrder })
        .where(and(eq(collections.id, item.id), eq(collections.userId, userId)));
    }
  }
}
