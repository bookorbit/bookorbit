import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** A parameterised `text[]` literal, so `jsonb - text[]` never interpolates a key. */
function textArray(values: string[]): SQL {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

@Injectable()
export class ReaderPreferencesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPreference(userId: number, bookFileId: number) {
    return this.db.query.readerPreferences.findFirst({
      where: and(eq(schema.readerPreferences.userId, userId), eq(schema.readerPreferences.bookFileId, bookFileId)),
    });
  }

  async upsertPreference(userId: number, bookFileId: number, settings: Record<string, unknown>) {
    const now = new Date();
    await this.db
      .insert(schema.readerPreferences)
      .values({ userId, bookFileId, settings, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.readerPreferences.userId, schema.readerPreferences.bookFileId],
        set: { settings, updatedAt: now },
      });
  }

  /**
   * Merges `set` into the stored per-book row and drops every key in `unset`, in one statement so
   * a concurrent patch cannot lose a field to a read-modify-write. A row left with no keys is
   * deleted, because an empty row and an absent row mean the same thing to every reader.
   *
   * Never `jsonb_strip_nulls`: a null `fontFamily` is the value "use the book's own font", not an
   * absent key.
   */
  async patchPreference(userId: number, bookFileId: number, set: Record<string, unknown>, unset: string[]) {
    const now = new Date();
    const patch = JSON.stringify(set);
    const removed = textArray(unset);

    await this.db
      .insert(schema.readerPreferences)
      .values({ userId, bookFileId, settings: sql`${patch}::jsonb`, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.readerPreferences.userId, schema.readerPreferences.bookFileId],
        set: {
          settings: sql`(${schema.readerPreferences.settings} - ${removed}) || ${patch}::jsonb`,
          updatedAt: now,
        },
      });

    await this.db
      .delete(schema.readerPreferences)
      .where(
        and(
          eq(schema.readerPreferences.userId, userId),
          eq(schema.readerPreferences.bookFileId, bookFileId),
          sql`${schema.readerPreferences.settings} = '{}'::jsonb`,
        ),
      );
  }

  async deletePreference(userId: number, bookFileId: number) {
    await this.db
      .delete(schema.readerPreferences)
      .where(and(eq(schema.readerPreferences.userId, userId), eq(schema.readerPreferences.bookFileId, bookFileId)));
  }

  async findAllDefaults(userId: number) {
    return this.db.query.readerDefaultPreferences.findMany({
      where: eq(schema.readerDefaultPreferences.userId, userId),
    });
  }

  async upsertDefault(userId: number, formatGroup: string, settings: Record<string, unknown>) {
    const now = new Date();
    await this.db
      .insert(schema.readerDefaultPreferences)
      .values({ userId, formatGroup, settings, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.readerDefaultPreferences.userId, schema.readerDefaultPreferences.formatGroup],
        set: { settings, updatedAt: now },
      });
  }

  /**
   * Merges `set` into the stored defaults row in one statement. The built-in defaults are folded
   * in underneath so the row stays a full object: the web client reads defaults as a complete
   * settings struct, and a client that owns only some of the fields must not leave holes for it.
   */
  async patchDefault(userId: number, formatGroup: string, builtinDefaults: Record<string, unknown>, set: Record<string, unknown>) {
    const now = new Date();
    const builtin = JSON.stringify(builtinDefaults);
    const patch = JSON.stringify(set);

    await this.db
      .insert(schema.readerDefaultPreferences)
      .values({ userId, formatGroup, settings: sql`${builtin}::jsonb || ${patch}::jsonb`, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.readerDefaultPreferences.userId, schema.readerDefaultPreferences.formatGroup],
        set: {
          settings: sql`(${builtin}::jsonb || ${schema.readerDefaultPreferences.settings}) || ${patch}::jsonb`,
          updatedAt: now,
        },
      });
  }

  async deleteDefault(userId: number, formatGroup: string) {
    await this.db
      .delete(schema.readerDefaultPreferences)
      .where(and(eq(schema.readerDefaultPreferences.userId, userId), eq(schema.readerDefaultPreferences.formatGroup, formatGroup)));
  }
}
