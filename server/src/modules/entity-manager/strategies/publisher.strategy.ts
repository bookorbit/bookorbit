import { Inject, Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { normalizeMetadataText, normalizeMetadataTextKey, normalizeMetadataTextKeySql } from '../../../common/utils/metadata-text-normalize.utils';
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

  protected override normalizeInputValue(value: string): string | null {
    return normalizeMetadataText(value);
  }

  protected override buildIdentityEqualsCondition(alias: string, value: string): SQL {
    const key = normalizeMetadataTextKey(value);
    if (!key) return sql`false`;
    const field = sql.raw(`${alias}.${this.rawFieldName}`);
    return sql`${normalizeMetadataTextKeySql(field)} = ${key}`;
  }
}
