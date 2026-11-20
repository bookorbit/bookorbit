import { randomUUID } from 'crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { createPostgresClientConfig } from '../../../src/db/postgres-connection-config';
import * as schema from '../../../src/db/schema';

export type AiJobsDb = NodePgDatabase<typeof schema>;

/** The engine's tables against the dedicated database, without booting the application. */
export function openAiJobsDb(): { db: AiJobsDb; close: () => Promise<void> } {
  const pool = new Pool(createPostgresClientConfig(process.env.DATABASE_URL!, { max: 10 }));
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

export async function insertUser(db: AiJobsDb, values: { isSuperuser?: boolean; active?: boolean } = {}): Promise<number> {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(schema.users)
    .values({
      username: `ai-jobs-${suffix}`,
      name: `AI jobs ${suffix}`,
      email: `ai-jobs-${suffix}@example.com`,
      passwordHash: 'not-used',
      isSuperuser: values.isSuperuser ?? false,
      active: values.active ?? true,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });
  return row!.id;
}
