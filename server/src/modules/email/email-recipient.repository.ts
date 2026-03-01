import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailRecipients } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailRecipientRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db.select().from(emailRecipients).where(eq(emailRecipients.userId, userId)).orderBy(emailRecipients.name);
  }

  findById(id: number) {
    return this.db.select().from(emailRecipients).where(eq(emailRecipients.id, id)).limit(1);
  }

  insert(values: typeof emailRecipients.$inferInsert) {
    return this.db.insert(emailRecipients).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof emailRecipients.$inferInsert>) {
    return this.db
      .update(emailRecipients)
      .set(values)
      .where(and(eq(emailRecipients.id, id), eq(emailRecipients.userId, userId)))
      .returning();
  }

  clearDefault(userId: number) {
    return this.db
      .update(emailRecipients)
      .set({ isDefault: false })
      .where(and(eq(emailRecipients.userId, userId), eq(emailRecipients.isDefault, true)));
  }

  setDefault(id: number, userId: number) {
    return this.db
      .update(emailRecipients)
      .set({ isDefault: true })
      .where(and(eq(emailRecipients.id, id), eq(emailRecipients.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(emailRecipients)
      .where(and(eq(emailRecipients.id, id), eq(emailRecipients.userId, userId)))
      .returning();
  }
}
