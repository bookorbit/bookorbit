import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';

import { InstrumentedPgPool } from '../../db/instrumented-pg-pool';
import { createPostgresClientConfig } from '../../db/postgres-connection-config';
import * as schema from '../../db/schema';
import { CACHE_POOL } from './metadata-cache.constants';

@Injectable()
export class MetadataCacheDb implements OnModuleDestroy {
  readonly pool: InstrumentedPgPool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(config: ConfigService) {
    this.pool = new InstrumentedPgPool(
      createPostgresClientConfig(config.getOrThrow<string>('db.url'), {
        max: CACHE_POOL.max,
        idleTimeoutMillis: CACHE_POOL.idleTimeoutMs,
        connectionTimeoutMillis: CACHE_POOL.connectionTimeoutMs,
        statement_timeout: CACHE_POOL.statementTimeoutMs,
      }),
    );
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
