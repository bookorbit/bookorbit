import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailProviders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailProviderRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select()
      .from(emailProviders)
      .where(or(eq(emailProviders.userId, userId), eq(emailProviders.isShared, true)))
      .orderBy(emailProviders.name);
  }

  findById(id: number) {
    return this.db.select().from(emailProviders).where(eq(emailProviders.id, id)).limit(1);
  }

  insert(values: typeof emailProviders.$inferInsert) {
    return this.db.insert(emailProviders).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof emailProviders.$inferInsert>) {
    return this.db
      .update(emailProviders)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(emailProviders.id, id), eq(emailProviders.userId, userId)))
      .returning();
  }

  clearDefault(userId: number) {
    return this.db
      .update(emailProviders)
      .set({ isDefault: false })
      .where(and(eq(emailProviders.userId, userId), eq(emailProviders.isDefault, true)));
  }

  setDefault(id: number, userId: number) {
    return this.db
      .update(emailProviders)
      .set({ isDefault: true, updatedAt: sql`now()` })
      .where(and(eq(emailProviders.id, id), eq(emailProviders.userId, userId)))
      .returning();
  }

  setShared(id: number, isShared: boolean) {
    return this.db
      .update(emailProviders)
      .set({ isShared, updatedAt: sql`now()` })
      .where(and(eq(emailProviders.id, id), or(isNull(emailProviders.userId), eq(emailProviders.isShared, true))))
      .returning();
  }

  setSharedByOwner(id: number, userId: number, isShared: boolean) {
    return this.db
      .update(emailProviders)
      .set({ isShared, updatedAt: sql`now()` })
      .where(and(eq(emailProviders.id, id), eq(emailProviders.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(emailProviders)
      .where(and(eq(emailProviders.id, id), eq(emailProviders.userId, userId)))
      .returning();
  }
}
