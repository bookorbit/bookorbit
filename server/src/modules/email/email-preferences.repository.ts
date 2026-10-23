import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailPreferences, emailProviders, emailRecipients, emailTemplates } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type FlaggedTable = typeof emailProviders | typeof emailRecipients | typeof emailTemplates;

export interface EmailDefaultsPatch {
  defaultProviderId?: number | null;
  defaultRecipientId?: number | null;
  defaultTemplateId?: number | null;
}

@Injectable()
export class EmailPreferencesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findByUserId(userId: number) {
    return this.db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
  }

  /**
   * The rows still flagged isDefault from before the preferences row became the only source of
   * truth. Read as a fallback, so an account that only ever used the stars keeps its defaults.
   */
  async findFlaggedDefaults(userId: number) {
    const [[provider], [recipient], [template]] = await Promise.all([
      this.db
        .select({ id: emailProviders.id })
        .from(emailProviders)
        .where(and(eq(emailProviders.userId, userId), eq(emailProviders.isDefault, true)))
        .limit(1),
      this.db
        .select({ id: emailRecipients.id })
        .from(emailRecipients)
        .where(and(eq(emailRecipients.userId, userId), eq(emailRecipients.isDefault, true)))
        .limit(1),
      this.db
        .select({ id: emailTemplates.id })
        .from(emailTemplates)
        .where(and(eq(emailTemplates.userId, userId), eq(emailTemplates.isDefault, true)))
        .limit(1),
    ]);
    return { providerId: provider?.id ?? null, recipientId: recipient?.id ?? null, templateId: template?.id ?? null };
  }

  /**
   * Writes the defaults and moves the legacy isDefault flags to match, in one transaction. A
   * shared server or the built-in template cannot carry the caller's flag, so choosing one clears
   * the caller's flags and leaves the preference as the only record.
   */
  setDefaults(userId: number, patch: EmailDefaultsPatch) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(emailPreferences)
        .values({ userId, ...patch })
        .onConflictDoUpdate({ target: emailPreferences.userId, set: { ...patch, updatedAt: sql`now()` } })
        .returning();
      if (patch.defaultProviderId !== undefined) await this.moveFlag(tx, emailProviders, userId, patch.defaultProviderId);
      if (patch.defaultRecipientId !== undefined) await this.moveFlag(tx, emailRecipients, userId, patch.defaultRecipientId);
      if (patch.defaultTemplateId !== undefined) await this.moveFlag(tx, emailTemplates, userId, patch.defaultTemplateId);
      return row;
    });
  }

  /**
   * Clears the caller's other flags before setting the chosen one. A single flipping UPDATE trips
   * the one-default-per-user unique index, which Postgres checks row by row. A row the caller does
   * not own (a shared server, the built-in template) is never flagged.
   */
  private async moveFlag(tx: Tx, table: FlaggedTable, userId: number, id: number | null) {
    const owned = eq(table.userId, userId);
    await tx
      .update(table)
      .set({ isDefault: false, updatedAt: sql`now()` })
      .where(id === null ? and(owned, eq(table.isDefault, true)) : and(owned, eq(table.isDefault, true), ne(table.id, id)));
    if (id !== null) {
      await tx
        .update(table)
        .set({ isDefault: true, updatedAt: sql`now()` })
        .where(and(owned, eq(table.id, id)));
    }
  }
}
