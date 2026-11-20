import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiJobEvents, type AiJobEventRow, type NewAiJobEventRow } from '../../db/schema';
import { AI_JOBS_EVENTS_PAGE, AI_JOBS_EVENTS_PER_JOB } from './ai-jobs.constants';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AiJobEventRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Appends, then trims the job back to its cap: routine `info` rows go first, so failures outlive progress chatter. */
  async append(events: NewAiJobEventRow[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.insert(aiJobEvents).values(events);
    for (const jobId of new Set(events.map((event) => event.jobId))) {
      await this.db.execute(sql`
        delete from ${aiJobEvents}
        where id in (
          select id from ${aiJobEvents}
          where job_id = ${jobId}
          order by (level = 'info') desc, id asc
          limit greatest((select count(*) from ${aiJobEvents} where job_id = ${jobId}) - ${AI_JOBS_EVENTS_PER_JOB}, 0)
        )
      `);
    }
  }

  async list(jobId: string, afterId: number | null): Promise<AiJobEventRow[]> {
    return await this.db
      .select()
      .from(aiJobEvents)
      .where(and(eq(aiJobEvents.jobId, jobId), afterId == null ? undefined : gt(aiJobEvents.id, afterId)))
      .orderBy(asc(aiJobEvents.id))
      .limit(AI_JOBS_EVENTS_PAGE);
  }
}
