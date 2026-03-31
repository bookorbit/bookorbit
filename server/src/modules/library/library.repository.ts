import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AccessLevel } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraryFolders, libraries } from '../../db/schema';
import { LIBRARY_BOOK_STATUS_PRESENT } from './library.constants';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class LibraryRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db
      .select({
        ...getTableColumns(libraries),
        bookCount: sql<number>`count(${books.id})::int`,
      })
      .from(libraries)
      .leftJoin(books, eq(books.libraryId, libraries.id))
      .groupBy(libraries.id)
      .orderBy(libraries.displayOrder, libraries.name);
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
        bookCount: sql<number>`count(${books.id})::int`,
      })
      .from(libraries)
      .innerJoin(schema.userLibraryAccess, and(eq(schema.userLibraryAccess.libraryId, libraries.id), eq(schema.userLibraryAccess.userId, userId)))
      .leftJoin(books, eq(books.libraryId, libraries.id))
      .groupBy(libraries.id)
      .orderBy(libraries.displayOrder, libraries.name);
  }

  findAllIds() {
    return this.db.select({ id: libraries.id }).from(libraries).orderBy(libraries.displayOrder, libraries.name);
  }

  findAccessibleIdsForUser(userId: number) {
    return this.db
      .select({ id: libraries.id })
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

  findAllFolders() {
    return this.db.select().from(libraryFolders);
  }

  findFoldersByLibraryIds(libraryIds: number[]) {
    if (libraryIds.length === 0) return Promise.resolve([]);
    return this.db.select().from(libraryFolders).where(inArray(libraryFolders.libraryId, libraryIds));
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
    await this.db.transaction(async (tx) => {
      for (const item of order) {
        await tx.update(libraries).set({ displayOrder: item.displayOrder }).where(eq(libraries.id, item.id));
      }
    });
  }

  async getStats(libraryId: number) {
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)));

    const formatRows = await this.db
      .select({
        format: bookFiles.format,
        count: sql<number>`count(*)::int`,
        totalSize: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint`,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(eq(books.libraryId, libraryId), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)))
      .groupBy(bookFiles.format);

    const formatCounts: Record<string, number> = {};
    let totalSizeBytes = 0n;
    for (const row of formatRows) {
      if (row.format) formatCounts[row.format] = row.count;
      totalSizeBytes += toBigInt(row.totalSize);
    }

    return {
      totalBooks: countRow?.count ?? 0,
      totalSizeBytes: toSafeNumber(totalSizeBytes),
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

  async grantAccess(libraryId: number, userId: number, accessLevel: AccessLevel) {
    await this.db
      .insert(schema.userLibraryAccess)
      .values({ libraryId, userId, accessLevel })
      .onConflictDoUpdate({
        target: [schema.userLibraryAccess.libraryId, schema.userLibraryAccess.userId],
        set: { accessLevel },
      });
  }

  async updateAccess(libraryId: number, userId: number, accessLevel: AccessLevel) {
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

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new TypeError(`Unsupported bigint value: ${String(value)}`);
}

function toSafeNumber(value: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maxSafe) {
    throw new RangeError('Library stats totalSizeBytes exceeds Number.MAX_SAFE_INTEGER');
  }
  return Number(value);
}
