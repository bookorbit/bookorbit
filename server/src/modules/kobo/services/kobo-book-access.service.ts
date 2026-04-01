import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class KoboBookAccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getAccessibleLibraryIds(userId: number): Promise<number[] | null> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { isSuperuser: true },
    });
    if (user?.isSuperuser) return null;

    const rows = await this.db
      .select({ libraryId: schema.userLibraryAccess.libraryId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.userId, userId));
    return rows.map((row) => row.libraryId);
  }

  async assertBookAccessible(userId: number, bookId: number): Promise<void> {
    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true, libraryId: true },
    });

    if (!book) return;

    const accessibleLibraryIds = await this.getAccessibleLibraryIds(userId);
    if (accessibleLibraryIds !== null && !accessibleLibraryIds.includes(book.libraryId)) {
      throw new ForbiddenException('No access to this book');
    }
  }
}
