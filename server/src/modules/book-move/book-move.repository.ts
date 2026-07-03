import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraries, libraryFolders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookMoveFile {
  id: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
  role: string;
}

export interface BookMoveBookData {
  id: number;
  libraryId: number;
  libraryFolderId: number;
  libraryFolderPath: string;
  folderPath: string;
  status: string;
  files: BookMoveFile[];
}

export interface BookMoveLibrary {
  id: number;
  allowedFormats: string[];
}

export interface BookMoveFolder {
  id: number;
  libraryId: number;
  path: string;
}

export interface BookMoveTarget {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export interface BookMoveFileUpdate {
  id: number;
  absolutePath: string;
  relPath: string | null;
}

@Injectable()
export class BookMoveRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findBookForMove(bookId: number): Promise<BookMoveBookData | null> {
    const [row] = await this.db
      .select({
        id: books.id,
        libraryId: books.libraryId,
        libraryFolderId: books.libraryFolderId,
        libraryFolderPath: libraryFolders.path,
        folderPath: books.folderPath,
        status: books.status,
      })
      .from(books)
      .innerJoin(libraryFolders, eq(libraryFolders.id, books.libraryFolderId))
      .where(eq(books.id, bookId));

    if (!row) return null;

    const files = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        format: bookFiles.format,
        role: bookFiles.role,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.id));

    return { ...row, files };
  }

  async findLibrary(libraryId: number): Promise<BookMoveLibrary | null> {
    const [row] = await this.db
      .select({ id: libraries.id, allowedFormats: libraries.allowedFormats })
      .from(libraries)
      .where(eq(libraries.id, libraryId));

    return row ?? null;
  }

  async findFolder(folderId: number): Promise<BookMoveFolder | null> {
    const [row] = await this.db
      .select({ id: libraryFolders.id, libraryId: libraryFolders.libraryId, path: libraryFolders.path })
      .from(libraryFolders)
      .where(eq(libraryFolders.id, folderId));

    return row ?? null;
  }

  async findFoldersByLibrary(libraryId: number): Promise<BookMoveFolder[]> {
    return this.db
      .select({ id: libraryFolders.id, libraryId: libraryFolders.libraryId, path: libraryFolders.path })
      .from(libraryFolders)
      .where(eq(libraryFolders.libraryId, libraryId))
      .orderBy(asc(libraryFolders.id));
  }

  async findExistingPaths(absolutePaths: string[]): Promise<Map<string, number>> {
    if (absolutePaths.length === 0) return new Map();

    const result = new Map<string, number>();
    const batchSize = 500;

    for (let i = 0; i < absolutePaths.length; i += batchSize) {
      const batch = absolutePaths.slice(i, i + batchSize);
      const rows = await this.db
        .select({ absolutePath: bookFiles.absolutePath, bookId: bookFiles.bookId })
        .from(bookFiles)
        .where(inArray(bookFiles.absolutePath, batch));

      for (const row of rows) {
        result.set(row.absolutePath, row.bookId);
      }
    }

    return result;
  }

  async applyMove(bookId: number, target: BookMoveTarget, files: BookMoveFileUpdate[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      // books must be updated first: book_files_book_folder_consistency_fk references
      // books(id, library_folder_id) with ON UPDATE CASCADE, so the new folder id
      // propagates to the files; updating a file first violates the FK.
      await tx
        .update(books)
        .set({ libraryId: target.libraryId, libraryFolderId: target.libraryFolderId, folderPath: target.folderPath })
        .where(eq(books.id, bookId));
      for (const file of files) {
        await tx
          .update(bookFiles)
          .set({ absolutePath: file.absolutePath, relPath: file.relPath, libraryFolderId: target.libraryFolderId })
          .where(eq(bookFiles.id, file.id));
      }
    });
  }
}
