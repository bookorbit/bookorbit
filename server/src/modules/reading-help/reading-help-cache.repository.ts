import { Inject, Injectable } from '@nestjs/common';
import { eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiAnswerCache } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface CachedAnswerInput {
  keyHash: string;
  feature: string;
  kind: string;
  answer: string;
}

@Injectable()
export class ReadingHelpCacheRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The answer under `keyHash`, marking it used now so the sweep keeps it. */
  async take(keyHash: string): Promise<string | null> {
    const [row] = await this.db
      .update(aiAnswerCache)
      .set({ lastAccessedAt: sql`now()` })
      .where(eq(aiAnswerCache.keyHash, keyHash))
      .returning({ answer: aiAnswerCache.answer });
    return row?.answer ?? null;
  }

  /** Two readers may write the same key at once; the second write keeps the first answer. */
  async put(input: CachedAnswerInput): Promise<void> {
    await this.db
      .insert(aiAnswerCache)
      .values({ ...input, bytes: Buffer.byteLength(input.answer, 'utf8') })
      .onConflictDoNothing({ target: aiAnswerCache.keyHash });
  }

  /** Removes answers unused since `before`, then the least recently used until the rest fit in `maxBytes`. */
  async sweep(before: Date, maxBytes: number): Promise<{ expired: number; evicted: number }> {
    const expired = await this.db.delete(aiAnswerCache).where(lt(aiAnswerCache.lastAccessedAt, before)).returning({ id: aiAnswerCache.id });
    const evicted = await this.db.execute<{ id: number }>(sql`
      delete from ai_answer_cache where id in (
        select id from (
          select id, sum(bytes) over (order by last_accessed_at desc, id desc) as running from ai_answer_cache
        ) ranked where running > ${maxBytes}
      ) returning id
    `);
    return { expired: expired.length, evicted: evicted.rows.length };
  }
}
