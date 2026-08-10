import { Inject, Injectable } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewServerFont, ServerFontRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

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

  async delete(id: number): Promise<void> {
    await this.db.delete(schema.serverFonts).where(eq(schema.serverFonts.id, id));
  }
}
