import { Inject, Injectable } from '@nestjs/common';
import { and, eq, count } from 'drizzle-orm';
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

  async delete(id: number): Promise<void> {
    await this.db.delete(schema.userFonts).where(eq(schema.userFonts.id, id));
  }

  async deleteAllByUser(userId: number): Promise<UserFontRow[]> {
    return this.db.delete(schema.userFonts).where(eq(schema.userFonts.userId, userId)).returning();
  }
}
