import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import { ContentFilterRepository } from '../../user/content-filter.repository';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class KoboBookAccessService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly contentFilterRepository: ContentFilterRepository,
  ) {}

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

    if (!book) {
      throw new NotFoundException('Book not found');
    }

    const accessibleLibraryIds = await this.getAccessibleLibraryIds(userId);
    if (accessibleLibraryIds !== null && !accessibleLibraryIds.includes(book.libraryId)) {
      throw new ForbiddenException('No access to this book');
    }

    if (accessibleLibraryIds !== null) {
      const contentFilters = await this.contentFilterRepository.findByUserId(userId);
      const filterClauses = buildContentFilterClauses(contentFilters, this.db);
      if (filterClauses.length > 0) {
        const [filtered] = await this.db
          .select({ id: schema.books.id })
          .from(schema.books)
          .where(and(eq(schema.books.id, bookId), ...filterClauses))
          .limit(1);
        if (!filtered) throw new ForbiddenException('No access to this book');
      }
    }
  }
}
