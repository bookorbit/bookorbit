import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailPreferences } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailPreferencesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findByUserId(userId: number) {
    return this.db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
  }

  upsert(userId: number, values: Partial<typeof emailPreferences.$inferInsert>) {
    return this.db
      .insert(emailPreferences)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: emailPreferences.userId,
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning();
  }
}
