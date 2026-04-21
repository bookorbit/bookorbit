import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { InlineEntityStrategy } from './inline-entity.strategy';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class PublisherStrategy extends InlineEntityStrategy {
  readonly entityType = 'publisher' as const;
  protected readonly fieldName = 'publisher';
  protected readonly rawFieldName = 'publisher';

  constructor(@Inject(DB) db: Db) {
    super(db);
  }
}
