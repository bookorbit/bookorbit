import { Inject, Injectable } from '@nestjs/common';
import { count, countDistinct, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewServerFont, ServerFontRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Readers' saved settings that name a server family, grouped by the CSS family they name. */
export interface CssFamilyCount {
  cssFamily: string;
  books: number;
  readers: number;
}

@Injectable()
export class ServerFontRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<ServerFontRow[]> {
    return this.db.query.serverFonts.findMany({
      orderBy: [schema.serverFonts.familyName, schema.serverFonts.weight, schema.serverFonts.style],
    });
  }

  async findById(id: number): Promise<ServerFontRow | undefined> {
    return this.db.query.serverFonts.findFirst({
      where: eq(schema.serverFonts.id, id),
    });
  }

  async findByHash(fileHash: string): Promise<ServerFontRow | undefined> {
    return this.db.query.serverFonts.findFirst({
      where: eq(schema.serverFonts.fileHash, fileHash),
    });
  }

  async countAll(): Promise<number> {
    const result = await this.db.select({ count: count() }).from(schema.serverFonts);
    return result[0]?.count ?? 0;
  }

  async create(data: NewServerFont): Promise<ServerFontRow> {
    const [row] = await this.db.insert(schema.serverFonts).values(data).returning();
    return row!;
  }

  async update(id: number, data: Partial<Pick<ServerFontRow, 'familyName' | 'weight' | 'style'>>): Promise<ServerFontRow | undefined> {
    const [row] = await this.db.update(schema.serverFonts).set(data).where(eq(schema.serverFonts.id, id)).returning();
    return row;
  }

  async findByFamily(familyName: string): Promise<ServerFontRow[]> {
    return this.db.query.serverFonts.findMany({
      where: eq(schema.serverFonts.familyName, familyName),
      orderBy: [schema.serverFonts.weight, schema.serverFonts.style],
    });
  }

  /** One statement, so a clash on any file leaves every file under its old name. */
  async renameFamily(familyName: string, newFamilyName: string): Promise<ServerFontRow[]> {
    return this.db.update(schema.serverFonts).set({ familyName: newFamilyName }).where(eq(schema.serverFonts.familyName, familyName)).returning();
  }

  /**
   * Books whose saved reader settings name a server family. The prefix test uses `left()` rather
   * than LIKE because the prefix itself contains underscores, which LIKE reads as wildcards.
   */
  async countBooksByCssFamily(prefix: string): Promise<CssFamilyCount[]> {
    const cssFamily = sql<string>`${schema.readerPreferences.settings}->>'fontFamily'`;
    return this.db
      .select({ cssFamily, books: count(), readers: countDistinct(schema.readerPreferences.userId) })
      .from(schema.readerPreferences)
      .where(sql`left(${cssFamily}, ${prefix.length}) = ${prefix}`)
      .groupBy(cssFamily);
  }

  async countDefaultsByCssFamily(prefix: string): Promise<Array<{ cssFamily: string; readers: number }>> {
    const cssFamily = sql<string>`${schema.readerDefaultPreferences.settings}->>'fontFamily'`;
    return this.db
      .select({ cssFamily, readers: countDistinct(schema.readerDefaultPreferences.userId) })
      .from(schema.readerDefaultPreferences)
      .where(sql`left(${cssFamily}, ${prefix.length}) = ${prefix}`)
      .groupBy(cssFamily);
  }

  async countHiddenByFamily(category: string): Promise<Array<{ familyName: string; readers: number }>> {
    const result = await this.db.execute<{ familyName: string; readers: number }>(sql`
      select hidden.family_name as "familyName", count(distinct ${schema.userPreferences.userId})::int as readers
      from ${schema.userPreferences}
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(${schema.userPreferences.data}->'hiddenFamilies') = 'array' then ${schema.userPreferences.data}->'hiddenFamilies' else '[]'::jsonb end
      ) as hidden(family_name)
      where ${schema.userPreferences.category} = ${category}
      group by hidden.family_name
    `);
    return result.rows;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(schema.serverFonts).where(eq(schema.serverFonts.id, id));
  }
}
