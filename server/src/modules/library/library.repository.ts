import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
}
