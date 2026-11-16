import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql, type AnyColumn } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sep } from 'path';

import type { BookDockUploadTarget } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  bookDockFiles,
  bookDockKeptFiles,
  bookDockUnitFiles,
  libraries,
  libraryDocks,
  type LibraryDockRow,
  type NewLibraryDockRow,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export type LibraryDockWithLibrary = LibraryDockRow & { libraryName: string };

/**
 * One row per library at most, so every list here is bounded by the number of libraries and is
 * read whole.
 */
@Injectable()
export class LibraryDockRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listAll(): Promise<LibraryDockWithLibrary[]> {
    return this.selectWithLibrary().orderBy(asc(libraries.name), asc(libraries.id));
  }

  async listEnabled(): Promise<LibraryDockWithLibrary[]> {
    return this.selectWithLibrary().where(eq(libraryDocks.enabled, true)).orderBy(asc(libraries.name), asc(libraries.id));
  }

  /** Turned-on docks in these libraries, with what each library accepts. */
  async listUploadTargets(libraryIds: number[]): Promise<BookDockUploadTarget[]> {
    if (libraryIds.length === 0) return [];
    return this.db
      .select({
        dockId: libraryDocks.id,
        libraryId: libraryDocks.libraryId,
        libraryName: libraries.name,
        allowedFormats: libraries.allowedFormats,
      })
      .from(libraryDocks)
      .innerJoin(libraries, eq(libraries.id, libraryDocks.libraryId))
      .where(and(eq(libraryDocks.enabled, true), inArray(libraryDocks.libraryId, libraryIds)))
      .orderBy(asc(libraries.name), asc(libraries.id));
  }

  async findById(id: number): Promise<LibraryDockRow | undefined> {
    const [row] = await this.db.select().from(libraryDocks).where(eq(libraryDocks.id, id)).limit(1);
    return row;
  }

  async findByLibraryId(libraryId: number): Promise<LibraryDockRow | undefined> {
    const [row] = await this.db.select().from(libraryDocks).where(eq(libraryDocks.libraryId, libraryId)).limit(1);
    return row;
  }

  /** Folder names are unique ignoring case, the way the shares they sit on usually compare them. */
  async findByFolderName(folderName: string): Promise<LibraryDockRow | undefined> {
    const [row] = await this.db
      .select()
      .from(libraryDocks)
      .where(eq(sql`lower(${libraryDocks.folderName})`, folderName.normalize('NFC').toLowerCase()))
      .limit(1);
    return row;
  }

  async create(data: NewLibraryDockRow): Promise<LibraryDockRow> {
    const [row] = await this.db.insert(libraryDocks).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<Omit<NewLibraryDockRow, 'id' | 'libraryId' | 'createdAt'>>): Promise<LibraryDockRow | undefined> {
    const [row] = await this.db.update(libraryDocks).set(data).where(eq(libraryDocks.id, id)).returning();
    return row;
  }

  /**
   * Renames a dock's folder in the database: its name, and every dock path under the old folder.
   * One transaction, so a failure leaves the rows matching the folder the caller puts back.
   * Returns how many dock files moved.
   */
  async renameFolder(id: number, folderName: string, from: string, to: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.update(libraryDocks).set({ folderName }).where(eq(libraryDocks.id, id));
      return movePathPrefix(tx, from, to);
    });
  }

  /** Repoints every dock path at or under `from` to `to`, in one transaction. Returns how many dock files moved. */
  async movePaths(from: string, to: string): Promise<number> {
    return this.db.transaction((tx) => movePathPrefix(tx, from, to));
  }

  private selectWithLibrary() {
    return this.db
      .select({
        id: libraryDocks.id,
        libraryId: libraryDocks.libraryId,
        folderName: libraryDocks.folderName,
        enabled: libraryDocks.enabled,
        targetFolderId: libraryDocks.targetFolderId,
        autoFetchMetadata: libraryDocks.autoFetchMetadata,
        autoFinalizeEnabled: libraryDocks.autoFinalizeEnabled,
        autoFinalizeThreshold: libraryDocks.autoFinalizeThreshold,
        autoFinalizeMetadataMode: libraryDocks.autoFinalizeMetadataMode,
        autoJoin: libraryDocks.autoJoin,
        keepOriginal: libraryDocks.keepOriginal,
        createdAt: libraryDocks.createdAt,
        updatedAt: libraryDocks.updatedAt,
        libraryName: libraries.name,
      })
      .from(libraryDocks)
      .innerJoin(libraries, eq(libraries.id, libraryDocks.libraryId))
      .$dynamic();
  }
}

async function movePathPrefix(tx: DbTransaction, from: string, to: string): Promise<number> {
  // Measured in SQL, so a name outside the Basic Multilingual Plane counts the way Postgres counts it.
  const moved = (column: AnyColumn) => sql`${to}::text || substr(${column}, length(${from}::text) + 1)`;
  const under = (column: AnyColumn) => or(eq(column, from), sql`starts_with(${column}, ${from + sep})`);
  const files = await tx
    .update(bookDockFiles)
    .set({ absolutePath: moved(bookDockFiles.absolutePath) })
    .where(under(bookDockFiles.absolutePath));
  await tx
    .update(bookDockFiles)
    .set({ unitDirectory: moved(bookDockFiles.unitDirectory) })
    .where(under(bookDockFiles.unitDirectory));
  await tx
    .update(bookDockUnitFiles)
    .set({ absolutePath: moved(bookDockUnitFiles.absolutePath) })
    .where(under(bookDockUnitFiles.absolutePath));
  await tx
    .update(bookDockKeptFiles)
    .set({ absolutePath: moved(bookDockKeptFiles.absolutePath) })
    .where(under(bookDockKeptFiles.absolutePath));
  return files.rowCount ?? 0;
}
