import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface LibraryFolderRow {
  libraryId: number;
  readOnly: boolean;
  name: string;
  icon: string | null;
  path: string;
}

@Injectable()
export class PathRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findWriteRoots(libraryIds: readonly number[]) {
    return this.db
      .select({ libraryId: libraries.id, path: libraryFolders.path, readOnly: libraries.readOnly })
      .from(libraries)
      .innerJoin(libraryFolders, eq(libraries.id, libraryFolders.libraryId))
      .where(or(eq(libraries.readOnly, true), libraryIds.length ? inArray(libraries.id, [...libraryIds]) : undefined));
  }

  /** Every library's folders, for landmarks and overlap checks. Callers hold ManageLibraries. */
  findLibraryFolders(): Promise<LibraryFolderRow[]> {
    return this.db
      .select({ libraryId: libraries.id, name: libraries.name, readOnly: libraries.readOnly, icon: libraries.icon, path: libraryFolders.path })
      .from(libraryFolders)
      .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
      .orderBy(asc(libraries.displayOrder), asc(libraries.name), asc(libraryFolders.createdAt), asc(libraryFolders.id));
  }
}
