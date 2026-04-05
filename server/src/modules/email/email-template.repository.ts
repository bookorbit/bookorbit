import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailTemplates } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailTemplateRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select()
      .from(emailTemplates)
      .where(or(eq(emailTemplates.userId, userId), isNull(emailTemplates.userId)))
      .orderBy(emailTemplates.name);
  }

  findById(id: number) {
    return this.db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
  }

  findUserDefault(userId: number) {
    return this.db
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.userId, userId), eq(emailTemplates.isDefault, true)))
      .limit(1);
  }

  findSystemDefault() {
    return this.db
      .select()
      .from(emailTemplates)
      .where(and(isNull(emailTemplates.userId), eq(emailTemplates.isSystem, true)))
      .limit(1);
  }

  insert(values: typeof emailTemplates.$inferInsert) {
    return this.db.insert(emailTemplates).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof emailTemplates.$inferInsert>) {
    return this.db
      .update(emailTemplates)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(emailTemplates.id, id), eq(emailTemplates.userId, userId)))
      .returning();
  }

  updateById(id: number, values: Partial<typeof emailTemplates.$inferInsert>) {
    return this.db
      .update(emailTemplates)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(emailTemplates.id, id))
      .returning();
  }

  clearDefault(userId: number) {
    return this.db
      .update(emailTemplates)
      .set({ isDefault: false })
      .where(and(eq(emailTemplates.userId, userId), eq(emailTemplates.isDefault, true)));
  }

  setDefault(id: number, userId: number) {
    return this.db
      .update(emailTemplates)
      .set({
        isDefault: sql`case when ${emailTemplates.id} = ${id} then true else false end`,
        updatedAt: sql`now()`,
      })
      .where(eq(emailTemplates.userId, userId))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(emailTemplates)
      .where(and(eq(emailTemplates.id, id), eq(emailTemplates.userId, userId)))
      .returning();
  }
}
