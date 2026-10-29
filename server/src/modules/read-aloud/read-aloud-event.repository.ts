import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { readAloudJobEvents, type NewReadAloudJobEventRow, type ReadAloudJobEventRow } from '../../db/schema';
import { READ_ALOUD_EVENTS_PAGE, READ_ALOUD_EVENTS_PER_JOB } from './read-aloud.constants';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ReadAloudEventRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Appends events, then trims the job back to its cap: the oldest `info` rows go first, so
   * warnings and the failure that explains a job outlive routine stage chatter.
   */
  async append(events: NewReadAloudJobEventRow[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.insert(readAloudJobEvents).values(events);
    for (const jobId of new Set(events.map((event) => event.jobId))) {
      await this.db.execute(sql`
        delete from ${readAloudJobEvents}
        where id in (
          select id from ${readAloudJobEvents}
          where job_id = ${jobId}
          order by (level = 'info') desc, id asc
          limit greatest((select count(*) from ${readAloudJobEvents} where job_id = ${jobId}) - ${READ_ALOUD_EVENTS_PER_JOB}, 0)
        )
      `);
    }
  }

  async list(jobId: string, afterId: number | null): Promise<ReadAloudJobEventRow[]> {
    return await this.db
      .select()
      .from(readAloudJobEvents)
      .where(and(eq(readAloudJobEvents.jobId, jobId), afterId == null ? undefined : gt(readAloudJobEvents.id, afterId)))
      .orderBy(asc(readAloudJobEvents.id))
      .limit(READ_ALOUD_EVENTS_PAGE);
  }
}
