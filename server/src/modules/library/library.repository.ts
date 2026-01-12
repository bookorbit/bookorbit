import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraryFolders, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class LibraryRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db.select().from(libraries).orderBy(libraries.name);
  }

  findAllForUser(userId: number) {
    return this.db
      .select({ id: libraries.id, name: libraries.name, icon: libraries.icon, scanMode: libraries.scanMode })
      .from(libraries)
      .innerJoin(schema.userLibraryAccess, and(eq(schema.userLibraryAccess.libraryId, libraries.id), eq(schema.userLibraryAccess.userId, userId)))
      .orderBy(libraries.name);
  }

  findById(id: number) {
    return this.db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
  }

  findFoldersByLibrary(libraryId: number) {
    return this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
  }

  insert(data: typeof libraries.$inferInsert) {
    return this.db.insert(libraries).values(data).returning();
  }

  insertFolder(data: typeof libraryFolders.$inferInsert) {
    return this.db.insert(libraryFolders).values(data).returning();
  }

  delete(id: number) {
    return this.db.delete(libraries).where(eq(libraries.id, id));
  }

  deleteFolder(id: number) {
    return this.db.delete(libraryFolders).where(eq(libraryFolders.id, id));
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
}
