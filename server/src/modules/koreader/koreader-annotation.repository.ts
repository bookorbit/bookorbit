import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewKoreaderAnnotation } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class KoreaderAnnotationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsertMany(rows: NewKoreaderAnnotation[]): Promise<number> {
    if (rows.length === 0) return 0;

    await this.db
      .insert(schema.koreaderAnnotations)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.koreaderAnnotations.userId, schema.koreaderAnnotations.bookFileId, schema.koreaderAnnotations.annotationKey],
        set: {
          drawer: sql`excluded.drawer`,
          color: sql`excluded.color`,
          text: sql`excluded.text`,
          note: sql`excluded.note`,
          chapter: sql`excluded.chapter`,
          pageno: sql`excluded.pageno`,
          posFormat: sql`excluded.pos_format`,
          pos1: sql`excluded.pos1`,
          deviceUpdatedAt: sql`excluded.device_updated_at`,
          updatedAt: new Date(),
        },
      });

    return rows.length;
  }

  async listByBook(userId: number, bookId: number, limit = 1000) {
    return this.db
      .select()
      .from(schema.koreaderAnnotations)
      .where(and(eq(schema.koreaderAnnotations.userId, userId), eq(schema.koreaderAnnotations.bookId, bookId)))
      .orderBy(sql`${schema.koreaderAnnotations.pageno} asc nulls last`, asc(schema.koreaderAnnotations.deviceCreatedAt))
      .limit(limit);
  }
}
