import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookNarrators, narrators } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class NarratorRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async replaceForBook(bookId: number, names: { name: string; sortName: string | null }[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(bookNarrators).where(eq(bookNarrators.bookId, bookId));

      for (let i = 0; i < names.length; i++) {
        const { name, sortName } = names[i];

        // onConflictDoUpdate with a no-op SET guarantees a RETURNING row regardless of
        // whether the INSERT or the conflict path was taken, avoiding a read-committed
        // race where onConflictDoNothing + subsequent SELECT could return nothing.
        await tx.insert(narrators).values({ name, sortName }).onConflictDoUpdate({ target: narrators.name, set: { name } });

        const [narrator] = await tx.select({ id: narrators.id }).from(narrators).where(eq(narrators.name, name)).limit(1);

        if (narrator) {
          await tx.insert(bookNarrators).values({ bookId, narratorId: narrator.id, displayOrder: i }).onConflictDoNothing();
        }
      }
    });
  }
}
