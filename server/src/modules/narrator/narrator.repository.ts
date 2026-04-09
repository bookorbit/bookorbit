import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookNarrators, narrators } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type NarratorMutationExecutor = Pick<Db, 'delete' | 'insert' | 'select'>;

@Injectable()
export class NarratorRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async replaceForBook(bookId: number, names: { name: string; sortName: string | null }[], executor?: NarratorMutationExecutor): Promise<void> {
    if (executor) {
      await this.replaceForBookWithExecutor(executor, bookId, names);
      return;
    }

    await this.db.transaction(async (tx) => {
      await this.replaceForBookWithExecutor(tx, bookId, names);
    });
  }

  private async replaceForBookWithExecutor(
    executor: NarratorMutationExecutor,
    bookId: number,
    names: { name: string; sortName: string | null }[],
  ): Promise<void> {
    await executor.delete(bookNarrators).where(eq(bookNarrators.bookId, bookId));

    if (names.length === 0) return;

    const uniqueByName = new Map<string, { name: string; sortName: string | null }>();
    for (const value of names) {
      if (!uniqueByName.has(value.name)) {
        uniqueByName.set(value.name, value);
      }
    }

    const uniqueNames = [...uniqueByName.values()];
    const narratorByName = new Map<string, { id: number }>();

    const upsertedNarrators = await executor
      .insert(narrators)
      .values(uniqueNames)
      .onConflictDoUpdate({
        target: narrators.name,
        set: { name: sql`excluded.name` },
      })
      .returning({ id: narrators.id, name: narrators.name });
    for (const row of upsertedNarrators) {
      narratorByName.set(row.name, { id: row.id });
    }

    const links = names.flatMap((value, index) => {
      const match = narratorByName.get(value.name);
      if (!match) return [];
      return [{ bookId, narratorId: match.id, displayOrder: index }];
    });

    if (links.length > 0) {
      await executor.insert(bookNarrators).values(links).onConflictDoNothing();
    }
  }
}
