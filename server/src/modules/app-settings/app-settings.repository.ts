import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AppSettingsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  listPublic() {
    return this.db.select().from(schema.appSettings).where(ne(schema.appSettings.key, APP_SETTING_KEYS.OIDC_CONFIG)).orderBy(schema.appSettings.key);
  }

  findByKey(key: string) {
    return this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, key) });
  }

  findMany(keys: string[]) {
    return this.db.select().from(schema.appSettings).where(inArray(schema.appSettings.key, keys));
  }

  async findExistingLibraryIds(libraryIds: number[]): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db.select({ id: schema.libraries.id }).from(schema.libraries).where(inArray(schema.libraries.id, libraryIds));
    return rows.map((row) => row.id);
  }

  async updateByKey(key: string, value: string) {
    const [setting] = await this.db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).returning();
    return setting ?? null;
  }

  async upsert(key: string, value: string): Promise<void> {
    await this.db.insert(schema.appSettings).values({ key, value }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }
}
