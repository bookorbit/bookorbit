import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { KoboServedAckPlan } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class KoboAnnotationServeRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async remember(userId: number, deviceId: number, bookId: number, etag: string, plan: KoboServedAckPlan): Promise<void> {
    await this.db
      .insert(schema.koboAnnotationServes)
      .values({ userId, deviceId, bookId, etag, plan })
      .onConflictDoUpdate({
        target: [schema.koboAnnotationServes.deviceId, schema.koboAnnotationServes.bookId],
        set: { etag, plan, servedAt: new Date() },
      });
  }

  async find(userId: number, deviceId: number, bookId: number) {
    const [row] = await this.db
      .select({
        id: schema.koboAnnotationServes.id,
        etag: schema.koboAnnotationServes.etag,
        plan: schema.koboAnnotationServes.plan,
        servedAt: schema.koboAnnotationServes.servedAt,
      })
      .from(schema.koboAnnotationServes)
      .where(
        and(
          eq(schema.koboAnnotationServes.userId, userId),
          eq(schema.koboAnnotationServes.deviceId, deviceId),
          eq(schema.koboAnnotationServes.bookId, bookId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Only the row read, so a response remembered in the meantime is not lost. */
  async forget(id: number, etag: string): Promise<void> {
    await this.db.delete(schema.koboAnnotationServes).where(and(eq(schema.koboAnnotationServes.id, id), eq(schema.koboAnnotationServes.etag, etag)));
  }
}
