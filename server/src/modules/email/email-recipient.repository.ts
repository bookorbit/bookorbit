import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailRecipients } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type EmailRecipientRow = typeof emailRecipients.$inferSelect;

@Injectable()
export class EmailRecipientRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number): Promise<EmailRecipientRow[]> {
    return this.db.select().from(emailRecipients).where(eq(emailRecipients.userId, userId)).orderBy(emailRecipients.name);
  }

  findById(id: number): Promise<EmailRecipientRow[]> {
    return this.db.select().from(emailRecipients).where(eq(emailRecipients.id, id)).limit(1);
  }

  findByIds(ids: number[]): Promise<EmailRecipientRow[]> {
    if (ids.length === 0) return Promise.resolve<EmailRecipientRow[]>([]);
    return this.db.select().from(emailRecipients).where(inArray(emailRecipients.id, ids));
  }

  insert(values: typeof emailRecipients.$inferInsert): Promise<EmailRecipientRow[]> {
    return this.db.insert(emailRecipients).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof emailRecipients.$inferInsert>): Promise<EmailRecipientRow[]> {
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

  setDefault(id: number, userId: number): Promise<EmailRecipientRow[]> {
    return this.db
      .update(emailRecipients)
      .set({ isDefault: true })
      .where(and(eq(emailRecipients.id, id), eq(emailRecipients.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number): Promise<EmailRecipientRow[]> {
    return this.db
      .delete(emailRecipients)
      .where(and(eq(emailRecipients.id, id), eq(emailRecipients.userId, userId)))
      .returning();
  }
}
