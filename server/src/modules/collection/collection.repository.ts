import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, count, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, books, collectionBooks, collections } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

class CollectionReorderMismatchError extends Error {}

const collectionFields = {
  id: collections.id,
  userId: collections.userId,
  name: collections.name,
  icon: collections.icon,
  description: collections.description,
  isPublic: collections.isPublic,
  syncToKobo: collections.syncToKobo,
  displayOrder: collections.displayOrder,
  createdAt: collections.createdAt,
  updatedAt: collections.updatedAt,
};

const collectionFieldsWithVisibleBookCount = {
  ...collectionFields,
  bookCount: count(books.id),
};

@Injectable()
export class CollectionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllVisibleForUser(userId: number, visibleBooksWhere: SQL | undefined) {
    return this.db
      .select(collectionFieldsWithVisibleBookCount)
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .leftJoin(books, and(eq(books.id, collectionBooks.bookId), ne(books.status, 'processing'), visibleBooksWhere))
      .where(or(eq(collections.userId, userId), eq(collections.isPublic, true)))
      .groupBy(collections.id, collections.userId)
      .orderBy(collections.displayOrder, collections.name);
  }

  findAllOwnedForUserWithMembership(userId: number, bookIds: number[], visibleBooksWhere: SQL | undefined) {
    const bookIdList = sql.join(
      bookIds.map((id) => sql`${id}`),
      sql`, `,
    );
    return this.db
      .select({
        ...collectionFieldsWithVisibleBookCount,
        memberCount: sql<number>`count(case when ${books.id} in (${bookIdList}) then 1 end)::int`,
      })
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .leftJoin(books, and(eq(books.id, collectionBooks.bookId), ne(books.status, 'processing'), visibleBooksWhere))
      .where(eq(collections.userId, userId))
      .groupBy(collections.id, collections.userId)
      .orderBy(collections.displayOrder, collections.name);
  }

  findById(id: number) {
    return this.db.select(collectionFields).from(collections).where(eq(collections.id, id)).limit(1);
  }

  findByIdForViewer(id: number, userId: number, isSuperuser: boolean, visibleBooksWhere: SQL | undefined) {
    return this.db
      .select(collectionFieldsWithVisibleBookCount)
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .leftJoin(books, and(eq(books.id, collectionBooks.bookId), ne(books.status, 'processing'), visibleBooksWhere))
      .where(isSuperuser ? eq(collections.id, id) : and(eq(collections.id, id), or(eq(collections.userId, userId), eq(collections.isPublic, true))))
      .groupBy(collections.id, collections.userId)
      .limit(1);
  }

  insert(values: typeof collections.$inferInsert) {
    return this.db.insert(collections).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof collections.$inferInsert>) {
    return this.db
      .update(collections)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
  }

  addBooks(collectionId: number, bookIds: number[]) {
    const values = bookIds.map((bookId) => ({ collectionId, bookId }));
    return this.db.insert(collectionBooks).values(values).onConflictDoNothing().returning();
  }

  removeBooks(collectionId: number, bookIds: number[]) {
    return this.db
      .delete(collectionBooks)
      .where(and(eq(collectionBooks.collectionId, collectionId), inArray(collectionBooks.bookId, bookIds)))
      .returning();
  }

  buildReadableMembershipWhere(collectionId: number, userId: number, isSuperuser: boolean): SQL {
    const membership = this.db
      .select({ one: sql`1` })
      .from(collectionBooks)
      .innerJoin(collections, eq(collections.id, collectionBooks.collectionId))
      .where(
        and(
          eq(collectionBooks.collectionId, collectionId),
          eq(collectionBooks.bookId, books.id),
          ...(isSuperuser ? [] : [or(eq(collections.userId, userId), eq(collections.isPublic, true))!]),
        ),
      )
      .limit(1);
    return sql`exists (${membership})`;
  }

  async findBookIdsPage(collectionId: number, libraryIds: number[], page: number, size: number, extraWhere?: SQL) {
    if (libraryIds.length === 0) {
      return {
        bookIds: [],
        total: 0,
        page,
        size,
      };
    }

    const where = and(eq(collectionBooks.collectionId, collectionId), inArray(books.libraryId, libraryIds), ...(extraWhere ? [extraWhere] : []));
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ bookId: collectionBooks.bookId })
        .from(collectionBooks)
        .innerJoin(books, eq(books.id, collectionBooks.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(collectionBooks.position)
        .limit(size)
        .offset(page * size),
      this.db
        .select({ total: count() })
        .from(collectionBooks)
        .innerJoin(books, eq(books.id, collectionBooks.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where),
    ]);

    return {
      bookIds: rows.map((row) => row.bookId),
      total: Number(total),
      page,
      size,
    };
  }

  async findAllBookIds(collectionId: number, libraryIds: number[], extraWhere?: SQL): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ bookId: collectionBooks.bookId })
      .from(collectionBooks)
      .innerJoin(books, eq(books.id, collectionBooks.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(eq(collectionBooks.collectionId, collectionId), inArray(books.libraryId, libraryIds), ...(extraWhere ? [extraWhere] : [])))
      .orderBy(collectionBooks.position);
    return rows.map((row) => row.bookId);
  }

  async updateDisplayOrders(userId: number, order: { id: number; displayOrder: number }[]): Promise<number> {
    try {
      return await this.db.transaction(async (tx) => {
        let updatedCount = 0;
        for (const item of order) {
          const updatedRows = await tx
            .update(collections)
            .set({ displayOrder: item.displayOrder, updatedAt: sql`now()` })
            .where(and(eq(collections.id, item.id), eq(collections.userId, userId)))
            .returning({ id: collections.id });
          if (updatedRows.length !== 1) throw new CollectionReorderMismatchError();
          updatedCount += 1;
        }
        return updatedCount;
      });
    } catch (error) {
      if (error instanceof CollectionReorderMismatchError) return 0;
      throw error;
    }
  }
}
