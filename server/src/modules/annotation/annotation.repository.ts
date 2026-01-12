import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { annotations, NewAnnotation } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AnnotationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByBookId(bookId: number, userId: number) {
    return this.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.bookId, bookId), eq(annotations.userId, userId)));
  }

  async create(data: NewAnnotation) {
    const [row] = await this.db.insert(annotations).values(data).returning();
    return row;
  }

  async update(bookId: number, annotationId: number, userId: number, data: Partial<Pick<NewAnnotation, 'note' | 'color' | 'style'>>) {
    const [row] = await this.db
      .update(annotations)
      .set({ ...data, updatedAt: sql`now()` })
      .where(and(eq(annotations.id, annotationId), eq(annotations.bookId, bookId), eq(annotations.userId, userId)))
      .returning();
    return row ?? null;
  }

  async delete(bookId: number, annotationId: number, userId: number) {
    const result = await this.db
      .delete(annotations)
      .where(and(eq(annotations.id, annotationId), eq(annotations.bookId, bookId), eq(annotations.userId, userId)))
      .returning({ id: annotations.id });
    return result.length > 0;
  }
}
