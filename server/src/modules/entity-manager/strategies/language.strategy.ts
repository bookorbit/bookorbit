import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { InlineEntityStrategy } from './inline-entity.strategy';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class LanguageStrategy extends InlineEntityStrategy {
  readonly entityType = 'language' as const;
  protected readonly fieldName = 'language';
  protected readonly rawFieldName = 'language';

  constructor(@Inject(DB) db: Db) {
    super(db);
  }
}
