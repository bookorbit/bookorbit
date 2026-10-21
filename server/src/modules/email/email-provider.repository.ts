import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne, or, sql } from 'drizzle-orm';
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

  findSharedDefault() {
    return this.db
      .select()
      .from(emailProviders)
      .where(and(eq(emailProviders.isShared, true), eq(emailProviders.isDefault, true)))
      .orderBy(desc(emailProviders.isSystemProvider), asc(emailProviders.id))
      .limit(1);
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

  /** Kept on the row so the settings page can say whether a server works without testing it again. */
  recordTestResult(id: number, ok: boolean, error: string | null) {
    return this.db
      .update(emailProviders)
      .set({ lastTestedAt: sql`now()`, lastTestOk: ok, lastTestError: error })
      .where(eq(emailProviders.id, id))
      .returning();
  }

  findSystemProvider() {
    return this.db.select().from(emailProviders).where(eq(emailProviders.isSystemProvider, true)).limit(1);
  }

  clearSystemProvider() {
    return this.db.update(emailProviders).set({ isSystemProvider: false }).where(eq(emailProviders.isSystemProvider, true));
  }

  setSystemProvider(id: number) {
    return this.db.transaction(async (tx) => {
      await tx
        .update(emailProviders)
        .set({ isSystemProvider: false })
        .where(and(eq(emailProviders.isSystemProvider, true), ne(emailProviders.id, id)));
      const [updated] = await tx
        .update(emailProviders)
        .set({ isSystemProvider: true, updatedAt: sql`now()` })
        .where(eq(emailProviders.id, id))
        .returning();
      return updated;
    });
  }
}
