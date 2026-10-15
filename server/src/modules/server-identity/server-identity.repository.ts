import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class ServerIdentityRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async getOrCreate(): Promise<string | undefined> {
    // Every replica reads the winning insert, never its own discarded UUID.
    await this.db.insert(schema.serverIdentity).values({ id: 1 }).onConflictDoNothing();
    const row = await this.db.query.serverIdentity.findFirst({ where: eq(schema.serverIdentity.id, 1) });
    return row?.instanceId;
  }
}
