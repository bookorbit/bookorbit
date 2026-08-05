import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';

import { createPostgresClientConfig } from './postgres-connection-config';
import * as schema from './schema';
import { InstrumentedPgPool } from './instrumented-pg-pool';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new InstrumentedPgPool(
          createPostgresClientConfig(config.getOrThrow<string>('db.url'), {
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 30_000,
          }),
        );
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
