import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailFileSelector {
  constructor(@Inject(DB) private readonly db: Db) {}

  async select(
    bookId: number,
    fileId: number | null | undefined,
    preferredFormat: string | null | undefined,
  ): Promise<typeof bookFiles.$inferSelect> {
    if (fileId) {
      const [file] = await this.db
        .select()
        .from(bookFiles)
        .where(and(eq(bookFiles.id, fileId), eq(bookFiles.bookId, bookId)))
        .limit(1);
      if (!file) throw new NotFoundException('Book file not found');
      return file;
    }

    const allFiles = await this.db.select().from(bookFiles).where(eq(bookFiles.bookId, bookId));
    if (allFiles.length === 0) throw new NotFoundException('No files found for this book');

    if (preferredFormat) {
      const match = allFiles.find((f) => f.format?.toLowerCase() === preferredFormat.toLowerCase());
      if (match) return match;
    }

    const primary = allFiles.find((f) => f.role === 'primary');
    return primary ?? allFiles[0];
  }
}
