import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { bookProviderIds } from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface StoredExternalProviderId {
  bookId: number;
  provider: string;
  externalId: string;
  sourceUrl: string | null;
}

@Injectable()
export class ProviderIdRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByBookIds(bookIds: readonly number[]): Promise<StoredExternalProviderId[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        bookId: bookProviderIds.bookId,
        provider: bookProviderIds.provider,
        externalId: bookProviderIds.externalId,
        sourceUrl: bookProviderIds.sourceUrl,
      })
      .from(bookProviderIds)
      .where(inArray(bookProviderIds.bookId, [...bookIds]));
  }

  /**
   * A new id without a link drops the old link, which described the old record; the same id keeps
   * its link when the caller has none to give.
   */
  async upsert(rows: readonly StoredExternalProviderId[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(bookProviderIds)
      .values(rows.map((row) => ({ ...row, updatedAt: new Date() })))
      .onConflictDoUpdate({
        target: [bookProviderIds.bookId, bookProviderIds.provider],
        set: {
          externalId: sql`excluded.external_id`,
          sourceUrl: sql`coalesce(excluded.source_url, case when ${bookProviderIds.externalId} = excluded.external_id then ${bookProviderIds.sourceUrl} end)`,
          updatedAt: sql`now()`,
        },
      });
  }

  async delete(bookId: number, providers: readonly string[]): Promise<void> {
    if (providers.length === 0) return;
    await this.db.delete(bookProviderIds).where(and(eq(bookProviderIds.bookId, bookId), inArray(bookProviderIds.provider, [...providers])));
  }
}
