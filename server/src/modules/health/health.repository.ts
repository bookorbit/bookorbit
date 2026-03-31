import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const DATABASE_PING_QUERY = sql`SELECT 1`;

@Injectable()
export class HealthRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async pingDatabase(): Promise<void> {
    await this.db.execute(DATABASE_PING_QUERY);
  }
}
