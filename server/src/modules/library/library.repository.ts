import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraryFolders, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class LibraryRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db.select().from(libraries).orderBy(libraries.displayOrder, libraries.name);
  }

  findAllForUser(userId: number) {
    return this.db
      .select({
        id: libraries.id,
        name: libraries.name,
        icon: libraries.icon,
        displayOrder: libraries.displayOrder,
        scanMode: libraries.scanMode,
        createdAt: libraries.createdAt,
        updatedAt: libraries.updatedAt,
      })
      .from(libraries)
      .innerJoin(schema.userLibraryAccess, and(eq(schema.userLibraryAccess.libraryId, libraries.id), eq(schema.userLibraryAccess.userId, userId)))
      .orderBy(libraries.displayOrder, libraries.name);
  }

  findById(id: number) {
    return this.db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
  }

  findByName(name: string, excludeId?: number) {
    return this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(
        excludeId
          ? and(eq(sql`lower(${libraries.name})`, name.toLowerCase()), sql`${libraries.id} != ${excludeId}`)
          : eq(sql`lower(${libraries.name})`, name.toLowerCase()),
      )
      .limit(1);
  }

  findFoldersByLibrary(libraryId: number) {
    return this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
  }

  findAllFolderPaths() {
    return this.db
      .select({ libraryId: libraryFolders.libraryId, path: libraryFolders.path, libraryName: libraries.name })
      .from(libraryFolders)
      .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId));
  }

  insert(data: typeof libraries.$inferInsert) {
    return this.db.insert(libraries).values(data).returning();
  }

  update(id: number, data: Partial<typeof libraries.$inferInsert>) {
    return this.db
      .update(libraries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(libraries.id, id))
      .returning();
  }

  insertFolder(data: typeof libraryFolders.$inferInsert) {
    return this.db.insert(libraryFolders).values(data).returning();
  }

  findBookIdsByLibrary(libraryId: number) {
    return this.db.select({ id: books.id }).from(books).where(eq(books.libraryId, libraryId));
  }

  delete(id: number) {
    return this.db.delete(libraries).where(eq(libraries.id, id));
  }

  deleteFolder(id: number) {
    return this.db.delete(libraryFolders).where(eq(libraryFolders.id, id));
  }

  deleteFoldersByLibrary(libraryId: number) {
    return this.db.delete(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
  }

  async updateDisplayOrders(order: { id: number; displayOrder: number }[]) {
    for (const item of order) {
      await this.db.update(libraries).set({ displayOrder: item.displayOrder }).where(eq(libraries.id, item.id));
    }
  }

  async getStats(libraryId: number) {
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), eq(books.status, 'present')));

    const formatRows = await this.db
      .select({
        format: bookFiles.format,
        count: sql<number>`count(*)::int`,
        totalSize: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint`,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(books.libraryId, libraryId), eq(books.status, 'present'), eq(bookFiles.role, 'primary')))
      .groupBy(bookFiles.format);

    const formatCounts: Record<string, number> = {};
    let totalSizeBytes = 0;
    for (const row of formatRows) {
      if (row.format) formatCounts[row.format] = row.count;
      totalSizeBytes += Number(row.totalSize);
    }

    return {
      totalBooks: countRow?.count ?? 0,
      totalSizeBytes,
      formatCounts,
    };
  }

  async hasUserAccess(userId: number, libraryId: number): Promise<boolean> {
    const row = await this.db.query.userLibraryAccess.findFirst({
      where: and(eq(schema.userLibraryAccess.userId, userId), eq(schema.userLibraryAccess.libraryId, libraryId)),
    });
    return row !== undefined;
  }

  getAccess(libraryId: number) {
    return this.db.query.userLibraryAccess.findMany({
      where: eq(schema.userLibraryAccess.libraryId, libraryId),
    });
  }

  async grantAccess(libraryId: number, userId: number, accessLevel: 'viewer' | 'editor' | 'owner') {
    await this.db
      .insert(schema.userLibraryAccess)
      .values({ libraryId, userId, accessLevel })
      .onConflictDoUpdate({
        target: [schema.userLibraryAccess.libraryId, schema.userLibraryAccess.userId],
        set: { accessLevel },
      });
  }

  async updateAccess(libraryId: number, userId: number, accessLevel: 'viewer' | 'editor' | 'owner') {
    await this.db
      .update(schema.userLibraryAccess)
      .set({ accessLevel })
      .where(and(eq(schema.userLibraryAccess.libraryId, libraryId), eq(schema.userLibraryAccess.userId, userId)));
  }

  async revokeAccess(libraryId: number, userId: number) {
    await this.db
      .delete(schema.userLibraryAccess)
      .where(and(eq(schema.userLibraryAccess.libraryId, libraryId), eq(schema.userLibraryAccess.userId, userId)));
  }

  getUsersNotInLibrary(libraryId: number) {
    const subquery = this.db
      .select({ userId: schema.userLibraryAccess.userId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.libraryId, libraryId));

    return this.db
      .select({ id: schema.users.id, username: schema.users.username, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), sql`${schema.users.id} not in (${subquery})`));
  }

  getAccessWithUsers(libraryId: number) {
    return this.db
      .select({
        userId: schema.userLibraryAccess.userId,
        accessLevel: schema.userLibraryAccess.accessLevel,
        username: schema.users.username,
        name: schema.users.name,
      })
      .from(schema.userLibraryAccess)
      .innerJoin(schema.users, eq(schema.users.id, schema.userLibraryAccess.userId))
      .where(eq(schema.userLibraryAccess.libraryId, libraryId));
  }
}
