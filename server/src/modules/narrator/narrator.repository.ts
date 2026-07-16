import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookNarrators, narrators } from '../../db/schema';
import {
  chooseCanonicalMetadataTextRow,
  normalizeMetadataText,
  normalizeMetadataTextKey,
  normalizeMetadataTextKeySql,
} from '../../common/utils/metadata-text-normalize.utils';

type Db = NodePgDatabase<typeof schema>;
type NarratorMutationExecutor = Pick<Db, 'delete' | 'insert' | 'select' | 'update'>;
const NORMALIZED_NARRATOR_NAME_SQL = normalizeMetadataTextKeySql(narrators.name);

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
      const key = normalizeMetadataTextKey(value.name);
      if (key && !uniqueByName.has(key)) {
        uniqueByName.set(key, value);
      }
    }

    const uniqueNames = [...uniqueByName.values()];
    const narratorByNameKey = new Map<string, { id: number }>();
    await this.addExistingNarratorsByNormalizedName(
      executor,
      narratorByNameKey,
      uniqueNames.map((narrator) => narrator.name),
    );

    const missingNames = uniqueNames.filter((narrator) => {
      const key = normalizeMetadataTextKey(narrator.name);
      return key ? !narratorByNameKey.has(key) : false;
    });

    if (missingNames.length > 0) {
      const insertedNarrators = await executor
        .insert(narrators)
        .values(missingNames)
        .onConflictDoNothing()
        .returning({ id: narrators.id, name: narrators.name });
      for (const row of insertedNarrators) {
        const key = normalizeMetadataTextKey(row.name);
        if (key) narratorByNameKey.set(key, { id: row.id });
      }
    }

    await this.addExistingNarratorsByNormalizedName(
      executor,
      narratorByNameKey,
      uniqueNames.filter((narrator) => !narratorByNameKey.has(normalizeMetadataTextKey(narrator.name) ?? '')).map((narrator) => narrator.name),
    );

    const links = uniqueNames.flatMap((value, index) => {
      const key = normalizeMetadataTextKey(value.name);
      const match = key ? narratorByNameKey.get(key) : undefined;
      if (!match) return [];
      return [{ bookId, narratorId: match.id, displayOrder: index }];
    });

    if (links.length > 0) {
      await executor.insert(bookNarrators).values(links).onConflictDoNothing();
    }
  }

  private async addExistingNarratorsByNormalizedName(
    executor: NarratorMutationExecutor,
    narratorByNameKey: Map<string, { id: number }>,
    names: string[],
  ): Promise<void> {
    const keys = [...new Set(names.map((name) => normalizeMetadataTextKey(name)).filter((key): key is string => key !== null))].filter(
      (key) => !narratorByNameKey.has(key),
    );
    if (keys.length === 0) return;

    const existingNarrators = await executor
      .select({ id: narrators.id, name: narrators.name, normalizedName: NORMALIZED_NARRATOR_NAME_SQL })
      .from(narrators)
      .where(inArray(NORMALIZED_NARRATOR_NAME_SQL, keys));

    const desiredNameByKey = new Map<string, string>();
    for (const name of names) {
      const key = normalizeMetadataTextKey(name);
      const displayName = normalizeMetadataText(name);
      if (key && displayName && !desiredNameByKey.has(key)) {
        desiredNameByKey.set(key, displayName);
      }
    }

    const rowsByKey = new Map<string, typeof existingNarrators>();
    for (const row of existingNarrators) {
      const key = normalizeMetadataTextKey(row.normalizedName) ?? normalizeMetadataTextKey(row.name);
      if (!key || narratorByNameKey.has(key)) continue;
      const rows = rowsByKey.get(key) ?? [];
      rows.push(row);
      rowsByKey.set(key, rows);
    }

    for (const [key, rows] of rowsByKey) {
      const desiredName = desiredNameByKey.get(key);
      const match = chooseCanonicalMetadataTextRow(rows, { desiredName });
      if (!match) continue;

      const canonicalName = normalizeMetadataText(match.name);
      if (canonicalName && match.name !== canonicalName && !rows.some((row) => row.id !== match.id && row.name === canonicalName)) {
        await executor.update(narrators).set({ name: canonicalName }).where(eq(narrators.id, match.id));
      }
      narratorByNameKey.set(key, { id: match.id });
    }
  }
}
