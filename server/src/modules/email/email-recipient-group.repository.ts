import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailRecipientGroupMembers, emailRecipientGroups, emailRecipients } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type EmailRecipientRow = typeof emailRecipients.$inferSelect;
type EmailGroupMemberRow = { recipient: EmailRecipientRow };
type EmailGroupMemberByGroupRow = { groupId: number; recipient: EmailRecipientRow };

@Injectable()
export class EmailRecipientGroupRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db.select().from(emailRecipientGroups).where(eq(emailRecipientGroups.userId, userId)).orderBy(emailRecipientGroups.name);
  }

  findById(id: number) {
    return this.db.select().from(emailRecipientGroups).where(eq(emailRecipientGroups.id, id)).limit(1);
  }

  findMembers(groupId: number): Promise<EmailGroupMemberRow[]> {
    return this.db
      .select({ recipient: emailRecipients })
      .from(emailRecipientGroupMembers)
      .innerJoin(emailRecipients, eq(emailRecipients.id, emailRecipientGroupMembers.recipientId))
      .where(eq(emailRecipientGroupMembers.groupId, groupId));
  }

  findMembersForGroupIds(groupIds: number[]): Promise<EmailGroupMemberByGroupRow[]> {
    if (groupIds.length === 0) return Promise.resolve<EmailGroupMemberByGroupRow[]>([]);
    return this.db
      .select({ groupId: emailRecipientGroupMembers.groupId, recipient: emailRecipients })
      .from(emailRecipientGroupMembers)
      .innerJoin(emailRecipients, eq(emailRecipients.id, emailRecipientGroupMembers.recipientId))
      .where(inArray(emailRecipientGroupMembers.groupId, groupIds));
  }

  insert(values: typeof emailRecipientGroups.$inferInsert) {
    return this.db.insert(emailRecipientGroups).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof emailRecipientGroups.$inferInsert>) {
    return this.db
      .update(emailRecipientGroups)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(emailRecipientGroups.id, id), eq(emailRecipientGroups.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(emailRecipientGroups)
      .where(and(eq(emailRecipientGroups.id, id), eq(emailRecipientGroups.userId, userId)))
      .returning();
  }

  addMember(groupId: number, recipientId: number) {
    return this.db.insert(emailRecipientGroupMembers).values({ groupId, recipientId }).onConflictDoNothing().returning();
  }

  removeMember(groupId: number, recipientId: number) {
    return this.db
      .delete(emailRecipientGroupMembers)
      .where(and(eq(emailRecipientGroupMembers.groupId, groupId), eq(emailRecipientGroupMembers.recipientId, recipientId)))
      .returning();
  }
}
