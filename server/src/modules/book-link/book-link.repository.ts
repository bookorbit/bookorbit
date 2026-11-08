import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
export type LinkTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface LinkMembership {
  bookId: number;
  groupId: number;
  leadBookId: number | null;
}

@Injectable()
export class BookLinkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Link writes are rare; one lock for all of them keeps two requests from merging the same groups apart. */
  transaction<T>(work: (tx: LinkTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('book_links'))`);
      return work(tx);
    });
  }

  async findMemberships(bookIds: number[], tx: LinkTx | Db = this.db): Promise<LinkMembership[]> {
    if (bookIds.length === 0) return [];
    return tx
      .select({ bookId: schema.bookLinks.bookId, groupId: schema.bookLinks.groupId, leadBookId: schema.bookLinkGroups.leadBookId })
      .from(schema.bookLinks)
      .innerJoin(schema.bookLinkGroups, eq(schema.bookLinkGroups.id, schema.bookLinks.groupId))
      .where(inArray(schema.bookLinks.bookId, bookIds));
  }

  async findMemberIds(groupIds: number[], tx: LinkTx | Db = this.db): Promise<number[]> {
    if (groupIds.length === 0) return [];
    const rows = await tx.select({ bookId: schema.bookLinks.bookId }).from(schema.bookLinks).where(inArray(schema.bookLinks.groupId, groupIds));
    return rows.map((row) => row.bookId);
  }

  async findBookLibraries(bookIds: number[], tx: LinkTx | Db = this.db): Promise<Array<{ bookId: number; libraryId: number }>> {
    if (bookIds.length === 0) return [];
    return tx.select({ bookId: schema.books.id, libraryId: schema.books.libraryId }).from(schema.books).where(inArray(schema.books.id, bookIds));
  }

  async createGroup(tx: LinkTx, leadBookId: number, userId: number): Promise<number> {
    const [row] = await tx.insert(schema.bookLinkGroups).values({ leadBookId, createdByUserId: userId }).returning({ id: schema.bookLinkGroups.id });
    return row.id;
  }

  /** Folds other groups into `groupId` and removes them. */
  async absorbGroups(tx: LinkTx, groupId: number, otherGroupIds: number[]): Promise<void> {
    if (otherGroupIds.length === 0) return;
    await tx.update(schema.bookLinks).set({ groupId }).where(inArray(schema.bookLinks.groupId, otherGroupIds));
    await tx.delete(schema.bookLinkGroups).where(and(inArray(schema.bookLinkGroups.id, otherGroupIds), ne(schema.bookLinkGroups.id, groupId)));
  }

  async addMembers(tx: LinkTx, groupId: number, bookIds: number[], userId: number): Promise<void> {
    if (bookIds.length === 0) return;
    await tx
      .insert(schema.bookLinks)
      .values(bookIds.map((bookId) => ({ bookId, groupId, linkedByUserId: userId })))
      .onConflictDoNothing();
  }

  async setLead(tx: LinkTx, groupId: number, leadBookId: number | null): Promise<void> {
    await tx.update(schema.bookLinkGroups).set({ leadBookId }).where(eq(schema.bookLinkGroups.id, groupId));
  }

  async removeMember(tx: LinkTx, bookId: number): Promise<void> {
    await tx.delete(schema.bookLinks).where(eq(schema.bookLinks.bookId, bookId));
  }

  async deleteGroup(tx: LinkTx, groupId: number): Promise<void> {
    await tx.delete(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, groupId));
  }
}
