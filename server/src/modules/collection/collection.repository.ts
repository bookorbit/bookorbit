import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, count, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { APP_FEATURES } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, books, collectionBooks, collectionPodcasts, collections, podcasts } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const visibleCollectionCondition = APP_FEATURES.podcasts ? undefined : eq(collections.mediaType, 'books');

class CollectionReorderMismatchError extends Error {}

const collectionFields = {
  id: collections.id,
  userId: collections.userId,
  mediaType: collections.mediaType,
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
  bookCount: sql<number>`count(distinct ${books.id})::int`,
  podcastCount: sql<number>`count(distinct ${collectionPodcasts.podcastId})::int`,
};

const collectionFieldsWithCounts = {
  ...collectionFields,
  bookCount: sql<number>`count(distinct ${collectionBooks.bookId})::int`,
  podcastCount: sql<number>`count(distinct ${collectionPodcasts.podcastId})::int`,
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
      .leftJoin(collectionPodcasts, eq(collections.id, collectionPodcasts.collectionId))
      .where(and(or(eq(collections.userId, userId), eq(collections.isPublic, true)), visibleCollectionCondition))
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
        memberCount: sql<number>`count(distinct case when ${books.id} in (${bookIdList}) then ${books.id} end)::int`,
      })
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .leftJoin(books, and(eq(books.id, collectionBooks.bookId), ne(books.status, 'processing'), visibleBooksWhere))
      .leftJoin(collectionPodcasts, eq(collections.id, collectionPodcasts.collectionId))
      .where(and(eq(collections.userId, userId), eq(collections.mediaType, 'books')))
      .groupBy(collections.id, collections.userId)
      .orderBy(collections.displayOrder, collections.name);
  }

  /** One query telling the add-to-collection sheet which collections already hold a show. */
  findAllForUserWithPodcastMembership(userId: number, podcastId: number) {
    return (
      this.db
        .select({
          ...collectionFieldsWithCounts,
          memberCount: sql<number>`count(distinct case when ${collectionPodcasts.podcastId} = ${podcastId} then ${collectionPodcasts.podcastId} end)::int`,
        })
        .from(collections)
        // collectionFields counts book membership too, so that table has to be in scope even
        // though this query is podcast-only.
        .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
        .leftJoin(collectionPodcasts, eq(collections.id, collectionPodcasts.collectionId))
        .where(and(eq(collections.userId, userId), eq(collections.mediaType, 'podcasts'), visibleCollectionCondition))
        .groupBy(collections.id, collections.userId)
        .orderBy(collections.displayOrder, collections.name)
    );
  }

  findById(id: number) {
    return this.db
      .select(collectionFields)
      .from(collections)
      .where(and(eq(collections.id, id), visibleCollectionCondition))
      .limit(1);
  }

  findByIdForViewer(id: number, userId: number, isSuperuser: boolean, visibleBooksWhere: SQL | undefined) {
    return this.db
      .select(collectionFieldsWithVisibleBookCount)
      .from(collections)
      .leftJoin(collectionBooks, eq(collections.id, collectionBooks.collectionId))
      .leftJoin(books, and(eq(books.id, collectionBooks.bookId), ne(books.status, 'processing'), visibleBooksWhere))
      .leftJoin(collectionPodcasts, eq(collections.id, collectionPodcasts.collectionId))
      .where(
        and(
          isSuperuser ? eq(collections.id, id) : and(eq(collections.id, id), or(eq(collections.userId, userId), eq(collections.isPublic, true))),
          visibleCollectionCondition,
        ),
      )
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
      .where(and(eq(collections.id, id), eq(collections.userId, userId), visibleCollectionCondition))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId), visibleCollectionCondition))
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

  addPodcasts(collectionId: number, podcastIds: number[]) {
    const values = podcastIds.map((podcastId) => ({ collectionId, podcastId }));
    return this.db.insert(collectionPodcasts).values(values).onConflictDoNothing().returning();
  }

  removePodcasts(collectionId: number, podcastIds: number[]) {
    return this.db
      .delete(collectionPodcasts)
      .where(and(eq(collectionPodcasts.collectionId, collectionId), inArray(collectionPodcasts.podcastId, podcastIds)))
      .returning();
  }

  /**
   * One page of member shows with the library each belongs to, so listing can hydrate per library.
   * Paged at the membership level rather than after hydration, so a large collection never loads
   * every show to render the first screen.
   */
  /**
   * `accessibleLibraryIds` undefined means no filter, for a superuser. An empty array means the
   * user reaches none of the member libraries, which is a legitimate result rather than an error:
   * a collection outliving one member's access still shows the members that remain readable.
   */
  private podcastMemberWhere(collectionId: number, accessibleLibraryIds?: number[]): SQL | undefined {
    const membership = eq(collectionPodcasts.collectionId, collectionId);
    if (accessibleLibraryIds === undefined) return membership;
    if (accessibleLibraryIds.length === 0) return sql`false`;
    return and(membership, inArray(podcasts.libraryId, accessibleLibraryIds));
  }

  findPodcastMembersPage(collectionId: number, page: number, size: number, accessibleLibraryIds?: number[]) {
    return this.db
      .select({ podcastId: collectionPodcasts.podcastId, libraryId: podcasts.libraryId })
      .from(collectionPodcasts)
      .innerJoin(podcasts, eq(podcasts.id, collectionPodcasts.podcastId))
      .where(this.podcastMemberWhere(collectionId, accessibleLibraryIds))
      .orderBy(collectionPodcasts.addedAt, collectionPodcasts.podcastId)
      .limit(size)
      .offset(page * size);
  }

  async countPodcastMembers(collectionId: number, accessibleLibraryIds?: number[]): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(collectionPodcasts)
      .innerJoin(podcasts, eq(podcasts.id, collectionPodcasts.podcastId))
      .where(this.podcastMemberWhere(collectionId, accessibleLibraryIds));
    return Number(row?.total ?? 0);
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
            .where(and(eq(collections.id, item.id), eq(collections.userId, userId), visibleCollectionCondition))
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
