import { LibraryScopeService } from '../../../common/library-scope/library-scope.service';
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
    private readonly libraryScope: LibraryScopeService,
  ) {}

  async getAccessibleLibraryIds(userId: number): Promise<number[] | null> {
    return this.libraryScope.visibleIdsOrAllForUserId(userId);
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
