import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewUserFont, UserFontRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class FontRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAllByUser(userId: number): Promise<UserFontRow[]> {
    return this.db.query.userFonts.findMany({
      where: eq(schema.userFonts.userId, userId),
      orderBy: [schema.userFonts.familyName, schema.userFonts.weight, schema.userFonts.style],
    });
  }

  async findById(id: number): Promise<UserFontRow | undefined> {
    return this.db.query.userFonts.findFirst({
      where: eq(schema.userFonts.id, id),
    });
  }

  async findByUserAndHash(userId: number, fileHash: string): Promise<UserFontRow | undefined> {
    return this.db.query.userFonts.findFirst({
      where: and(eq(schema.userFonts.userId, userId), eq(schema.userFonts.fileHash, fileHash)),
    });
  }

  async countByUser(userId: number): Promise<number> {
    const result = await this.db.select({ count: count() }).from(schema.userFonts).where(eq(schema.userFonts.userId, userId));
    return result[0]?.count ?? 0;
  }

  async create(data: NewUserFont): Promise<UserFontRow> {
    const [row] = await this.db.insert(schema.userFonts).values(data).returning();
    return row!;
  }

  async update(id: number, data: Partial<Pick<UserFontRow, 'familyName' | 'weight' | 'style'>>): Promise<UserFontRow | undefined> {
    const [row] = await this.db.update(schema.userFonts).set(data).where(eq(schema.userFonts.id, id)).returning();
    return row;
  }

  async findByUserAndFamily(userId: number, familyName: string): Promise<UserFontRow[]> {
    return this.db.query.userFonts.findMany({
      where: and(eq(schema.userFonts.userId, userId), eq(schema.userFonts.familyName, familyName)),
      orderBy: [schema.userFonts.weight, schema.userFonts.style],
    });
  }

  /** One statement, so a clash on any file leaves every file under its old name. */
  async renameFamily(userId: number, familyName: string, newFamilyName: string): Promise<UserFontRow[]> {
    return this.db
      .update(schema.userFonts)
      .set({ familyName: newFamilyName })
      .where(and(eq(schema.userFonts.userId, userId), eq(schema.userFonts.familyName, familyName)))
      .returning();
  }

  /**
   * This reader's books whose saved settings name a custom font, grouped by the CSS family named.
   * The prefix test uses `left()` rather than LIKE because the prefixes contain underscores.
   */
  async countBooksByCssFamily(userId: number, prefixes: readonly string[]): Promise<Array<{ cssFamily: string; books: number }>> {
    const cssFamily = sql<string>`${schema.readerPreferences.settings}->>'fontFamily'`;
    const matchesPrefix = sql.join(
      prefixes.map((prefix) => sql`left(${cssFamily}, ${prefix.length}) = ${prefix}`),
      sql` or `,
    );
    return this.db
      .select({ cssFamily, books: count() })
      .from(schema.readerPreferences)
      .where(and(eq(schema.readerPreferences.userId, userId), sql`(${matchesPrefix})`))
      .groupBy(cssFamily);
  }

  /** The custom fonts this reader saved as a reader default, for any format group. */
  async findDefaultCssFamilies(userId: number): Promise<string[]> {
    const rows = await this.db
      .select({ cssFamily: sql<string | null>`${schema.readerDefaultPreferences.settings}->>'fontFamily'` })
      .from(schema.readerDefaultPreferences)
      .where(eq(schema.readerDefaultPreferences.userId, userId));
    return rows.flatMap((row) => (row.cssFamily ? [row.cssFamily] : []));
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(schema.userFonts).where(eq(schema.userFonts.id, id));
  }

  async deleteAllByUser(userId: number): Promise<UserFontRow[]> {
    return this.db.delete(schema.userFonts).where(eq(schema.userFonts.userId, userId)).returning();
  }
}
