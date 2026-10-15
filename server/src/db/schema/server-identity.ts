import { sql } from 'drizzle-orm';
import { check, integer, pgTable, uuid } from 'drizzle-orm/pg-core';

export const serverIdentity = pgTable(
  'server_identity',
  {
    id: integer('id').primaryKey().default(1),
    instanceId: uuid('instance_id').notNull().defaultRandom(),
  },
  (t) => [check('server_identity_singleton', sql`${t.id} = 1`)],
);
