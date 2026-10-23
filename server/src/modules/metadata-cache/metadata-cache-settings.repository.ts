import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** The cache's settings rows in `app_settings`, on the main pool. */
@Injectable()
export class MetadataCacheSettingsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async read(key: string): Promise<string | null> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, key) });
    return row?.value ?? null;
  }

  /** Read-modify-write under an advisory lock so concurrent saves never lose each other's changes. */
  async update(key: string, apply: (current: string | null) => string): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
      const row = await tx.query.appSettings.findFirst({ where: eq(schema.appSettings.key, key) });
      const value = apply(row?.value ?? null);
      await tx.insert(schema.appSettings).values({ key, value }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
      return value;
    });
  }
}
