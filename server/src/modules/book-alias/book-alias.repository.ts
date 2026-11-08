import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { chunk } from '../../common/utils/batch.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMerges } from '../../db/schema';

const LOOKUP_BATCH_SIZE = 500;

@Injectable()
export class BookAliasRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Merged-away ids mapped to the book they now live in. Ids that were never merged are absent. */
  async resolve(ids: number[]): Promise<Map<number, number>> {
    const resolved = new Map<number, number>();
    const unique = [...new Set(ids)];
    for (const batch of chunk(unique, LOOKUP_BATCH_SIZE)) {
      const rows = await this.db
        .select({ sourceBookId: bookMerges.sourceBookId, targetBookId: bookMerges.targetBookId })
        .from(bookMerges)
        .where(inArray(bookMerges.sourceBookId, batch));
      for (const row of rows) resolved.set(row.sourceBookId, row.targetBookId);
    }
    return resolved;
  }
}
