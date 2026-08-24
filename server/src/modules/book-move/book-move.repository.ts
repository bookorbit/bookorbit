import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookMetadata,
  bookMoveJobs,
  books,
  koboDevices,
  libraries,
  libraryFolders,
  userLibraryAccess,
  users,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const ID_BATCH_SIZE = 500;

export interface MoveBookFile {
  id: number;
  absolutePath: string;
  relPath: string | null;
  role: string;
  format: string | null;
  fileHash: string | null;
  sortOrder: number | null;
}

export interface MoveBookData {
  bookId: number;
  status: string;
  libraryId: number;
  libraryFolderId: number;
  libraryFolderPath: string;
  organizationMode: string;
  folderPath: string;
  primaryFileId: number | null;
  title: string | null;
  metadata: {
    title: string | null;
    subtitle: string | null;
    publisher: string | null;
    language: string | null;
    isbn13: string | null;
    publishedYear: number | null;
    seriesName: string | null;
    seriesIndex: string | null;
  };
  authors: string[];
  files: MoveBookFile[];
}

export interface MoveTargetLibrary {
  libraryId: number;
  libraryName: string;
  organizationMode: string;
  fileNamingPattern: string | null;
  allowedFormats: string[];
  folderId: number;
  folderPath: string;
  watch: boolean;
}

export interface BookFileMoveUpdate {
  fileId: number;
  absolutePath: string;
  relPath: string;
  ino: bigint;
  sizeBytes: number;
  mtime: Date;
  fileHash?: string | null;
}

export interface ApplyBookMoveInput {
  bookId: number;
  targetLibraryId: number;
  targetFolderId: number;
  targetFolderPathKey: string;
  fileUpdates: BookFileMoveUpdate[];
  /** When set, this book in the target library is replaced by the moved book. */
  mergeDuplicateBookId?: number | null;
}

@Injectable()
export class BookMoveRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findTargetLibrary(targetLibraryId: number, targetFolderId: number): Promise<MoveTargetLibrary | null> {
    const [row] = await this.db
      .select({
        libraryId: libraries.id,
        libraryName: libraries.name,
        organizationMode: libraries.organizationMode,
        fileNamingPattern: libraries.fileNamingPattern,
        allowedFormats: libraries.allowedFormats,
        watch: libraries.watch,
        folderId: libraryFolders.id,
        folderPath: libraryFolders.path,
      })
      .from(libraryFolders)
      .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
      .where(and(eq(libraryFolders.id, targetFolderId), eq(libraryFolders.libraryId, targetLibraryId)))
      .limit(1);

    return row ?? null;
  }

  async findMoveBookData(bookIds: number[]): Promise<MoveBookData[]> {
    if (bookIds.length === 0) return [];

    const rows: MoveBookData[] = [];

    for (let index = 0; index < bookIds.length; index += ID_BATCH_SIZE) {
      const batch = bookIds.slice(index, index + ID_BATCH_SIZE);

      const bookRows = await this.db
        .select({
          bookId: books.id,
          status: books.status,
          libraryId: books.libraryId,
          libraryFolderId: books.libraryFolderId,
          libraryFolderPath: libraryFolders.path,
          organizationMode: libraries.organizationMode,
          folderPath: books.folderPath,
          primaryFileId: books.primaryFileId,
          title: bookMetadata.title,
          subtitle: bookMetadata.subtitle,
          publisher: bookMetadata.publisher,
          language: bookMetadata.language,
          isbn13: bookMetadata.isbn13,
          publishedYear: bookMetadata.publishedYear,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
        })
        .from(books)
        .innerJoin(libraryFolders, eq(libraryFolders.id, books.libraryFolderId))
        .innerJoin(libraries, eq(libraries.id, books.libraryId))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, batch));

      if (bookRows.length === 0) continue;

      const batchIds = bookRows.map((row) => row.bookId);

      const fileRows = await this.db
        .select({
          bookId: bookFiles.bookId,
          id: bookFiles.id,
          absolutePath: bookFiles.absolutePath,
          relPath: bookFiles.relPath,
          role: bookFiles.role,
          format: bookFiles.format,
          fileHash: bookFiles.fileHash,
          sortOrder: bookFiles.sortOrder,
        })
        .from(bookFiles)
        .where(inArray(bookFiles.bookId, batchIds))
        .orderBy(asc(bookFiles.id));

      const authorRows = await this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, batchIds))
        .orderBy(asc(bookAuthors.displayOrder));

      const filesByBook = new Map<number, MoveBookFile[]>();
      for (const file of fileRows) {
        const list = filesByBook.get(file.bookId);
        const entry: MoveBookFile = {
          id: file.id,
          absolutePath: file.absolutePath,
          relPath: file.relPath,
          role: file.role,
          format: file.format,
          fileHash: file.fileHash,
          sortOrder: file.sortOrder,
        };
        if (list) list.push(entry);
        else filesByBook.set(file.bookId, [entry]);
      }

      const authorsByBook = new Map<number, string[]>();
      for (const author of authorRows) {
        const list = authorsByBook.get(author.bookId);
        if (list) list.push(author.name);
        else authorsByBook.set(author.bookId, [author.name]);
      }

      for (const row of bookRows) {
        rows.push({
          bookId: row.bookId,
          status: row.status,
          libraryId: row.libraryId,
          libraryFolderId: row.libraryFolderId,
          libraryFolderPath: row.libraryFolderPath,
          organizationMode: row.organizationMode,
          folderPath: row.folderPath,
          primaryFileId: row.primaryFileId,
          title: row.title,
          metadata: {
            title: row.title,
            subtitle: row.subtitle,
            publisher: row.publisher,
            language: row.language,
            isbn13: row.isbn13,
            publishedYear: row.publishedYear,
            seriesName: row.seriesName,
            seriesIndex: row.seriesIndex,
          },
          authors: authorsByBook.get(row.bookId) ?? [],
          files: filesByBook.get(row.bookId) ?? [],
        });
      }
    }

    return rows;
  }

  /** Maps folderPath to the owning book id, for books already in the target library. */
  async findFolderPathOwners(libraryId: number, folderPaths: string[]): Promise<Map<string, number>> {
    const owners = new Map<string, number>();
    if (folderPaths.length === 0) return owners;

    for (let index = 0; index < folderPaths.length; index += ID_BATCH_SIZE) {
      const batch = folderPaths.slice(index, index + ID_BATCH_SIZE);
      const rows = await this.db
        .select({ id: books.id, folderPath: books.folderPath })
        .from(books)
        .where(and(eq(books.libraryId, libraryId), inArray(books.folderPath, batch)));

      for (const row of rows) owners.set(row.folderPath, row.id);
    }

    return owners;
  }

  /** Maps absolutePath to the owning book id, across every library (path is globally unique). */
  async findFilePathOwners(absolutePaths: string[]): Promise<Map<string, number>> {
    const owners = new Map<string, number>();
    if (absolutePaths.length === 0) return owners;

    for (let index = 0; index < absolutePaths.length; index += ID_BATCH_SIZE) {
      const batch = absolutePaths.slice(index, index + ID_BATCH_SIZE);
      const rows = await this.db
        .select({ absolutePath: bookFiles.absolutePath, bookId: bookFiles.bookId })
        .from(bookFiles)
        .where(inArray(bookFiles.absolutePath, batch));

      for (const row of rows) owners.set(row.absolutePath, row.bookId);
    }

    return owners;
  }

  /** Maps content hash to a present book already holding it in the target library. */
  async findHashOwnersInLibrary(libraryId: number, hashes: string[]): Promise<Map<string, number>> {
    const owners = new Map<string, number>();
    if (hashes.length === 0) return owners;

    for (let index = 0; index < hashes.length; index += ID_BATCH_SIZE) {
      const batch = hashes.slice(index, index + ID_BATCH_SIZE);
      const rows = await this.db
        .select({ fileHash: bookFiles.fileHash, bookId: bookFiles.bookId })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(eq(books.libraryId, libraryId), eq(books.status, 'present'), eq(bookFiles.role, 'content'), inArray(bookFiles.fileHash, batch)));

      for (const row of rows) {
        if (row.fileHash && !owners.has(row.fileHash)) owners.set(row.fileHash, row.bookId);
      }
    }

    return owners;
  }

  async findLibraryAccess(libraryIds: number[]): Promise<{ libraryId: number; userId: number; accessLevel: string }[]> {
    if (libraryIds.length === 0) return [];
    return this.db
      .select({
        libraryId: userLibraryAccess.libraryId,
        userId: userLibraryAccess.userId,
        accessLevel: userLibraryAccess.accessLevel,
      })
      .from(userLibraryAccess)
      .where(inArray(userLibraryAccess.libraryId, libraryIds));
  }

  async findUsers(userIds: number[]): Promise<{ id: number; username: string; isSuperuser: boolean }[]> {
    if (userIds.length === 0) return [];
    return this.db.select({ id: users.id, username: users.username, isSuperuser: users.isSuperuser }).from(users).where(inArray(users.id, userIds));
  }

  async countKoboDevicesByUser(userIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (userIds.length === 0) return counts;

    const rows = await this.db
      .select({ userId: koboDevices.userId, deviceCount: sql<number>`count(*)::int` })
      .from(koboDevices)
      .where(inArray(koboDevices.userId, userIds))
      .groupBy(koboDevices.userId);

    for (const row of rows) counts.set(row.userId, row.deviceCount);
    return counts;
  }

  /**
   * Re-parents a book and its files in one transaction.
   *
   * Statement order matters and follows the scanner's duplicate-repair precedent:
   * the duplicate is deleted first so its rows release the globally unique
   * `book_files_absolute_path_uidx`, then `books` is updated in a single statement
   * because `books_library_folder_library_fk` is not deferrable, and finally the
   * file rows are rewritten in place so no path is ever owned twice.
   */
  async applyBookMove(input: ApplyBookMoveInput): Promise<{ moved: boolean; mergedBookId: number | null }> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: books.id, libraryId: books.libraryId, status: books.status })
        .from(books)
        .where(eq(books.id, input.bookId))
        .for('update')
        .limit(1);

      if (!current) return { moved: false, mergedBookId: null };

      let mergedBookId: number | null = null;
      if (input.mergeDuplicateBookId != null && input.mergeDuplicateBookId !== input.bookId) {
        const [duplicate] = await tx
          .select({ id: books.id, libraryId: books.libraryId })
          .from(books)
          .where(eq(books.id, input.mergeDuplicateBookId))
          .for('update')
          .limit(1);

        if (duplicate && duplicate.libraryId === input.targetLibraryId) {
          await tx.delete(books).where(eq(books.id, duplicate.id));
          mergedBookId = duplicate.id;
        }
      }

      const now = new Date();

      await tx
        .update(books)
        .set({
          libraryId: input.targetLibraryId,
          libraryFolderId: input.targetFolderId,
          folderPath: input.targetFolderPathKey,
          status: 'present',
          updatedAt: now,
        })
        .where(eq(books.id, input.bookId));

      for (const update of input.fileUpdates) {
        await tx
          .update(bookFiles)
          .set({
            libraryFolderId: input.targetFolderId,
            absolutePath: update.absolutePath,
            relPath: update.relPath,
            ino: update.ino,
            sizeBytes: update.sizeBytes,
            mtime: update.mtime,
            ...(update.fileHash !== undefined ? { fileHash: update.fileHash } : {}),
            updatedAt: now,
          })
          .where(eq(bookFiles.id, update.fileId));
      }

      return { moved: true, mergedBookId };
    });
  }

  async findBooksInTargetFolder(targetLibraryId: number, bookIds: number[]): Promise<Set<number>> {
    const found = new Set<number>();
    if (bookIds.length === 0) return found;

    for (let index = 0; index < bookIds.length; index += ID_BATCH_SIZE) {
      const batch = bookIds.slice(index, index + ID_BATCH_SIZE);
      const rows = await this.db
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.libraryId, targetLibraryId), inArray(books.id, batch)));
      for (const row of rows) found.add(row.id);
    }

    return found;
  }

  async createJob(input: {
    startedBy: number;
    targetLibraryId: number;
    targetFolderId: number;
    sourceLibraryIds: number[];
    totalBooks: number;
  }): Promise<number> {
    const [row] = await this.db
      .insert(bookMoveJobs)
      .values({
        startedBy: input.startedBy,
        targetLibraryId: input.targetLibraryId,
        targetFolderId: input.targetFolderId,
        sourceLibraryIds: input.sourceLibraryIds,
        totalBooks: input.totalBooks,
        status: 'running',
      })
      .returning({ id: bookMoveJobs.id });

    return row.id;
  }

  async finishJob(
    jobId: number,
    status: 'completed' | 'failed',
    counts: { succeeded: number; merged: number; failed: number; skipped: number },
    error?: string,
  ): Promise<void> {
    await this.db
      .update(bookMoveJobs)
      .set({
        status,
        succeeded: counts.succeeded,
        merged: counts.merged,
        failed: counts.failed,
        skipped: counts.skipped,
        error: error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(bookMoveJobs.id, jobId));
  }

  /** Marks jobs left running by a crash and returns the libraries they touched. */
  async markInterruptedJobs(): Promise<{ id: number; libraryIds: number[] }[]> {
    const rows = await this.db
      .update(bookMoveJobs)
      .set({ status: 'interrupted', error: 'Server restarted during move', finishedAt: new Date() })
      .where(eq(bookMoveJobs.status, 'running'))
      .returning({
        id: bookMoveJobs.id,
        targetLibraryId: bookMoveJobs.targetLibraryId,
        sourceLibraryIds: bookMoveJobs.sourceLibraryIds,
      });

    return rows.map((row) => ({
      id: row.id,
      libraryIds: [...new Set([row.targetLibraryId, ...(row.sourceLibraryIds ?? [])])],
    }));
  }

  async findLibraryFolders(libraryIds: number[]): Promise<{ libraryId: number; path: string }[]> {
    if (libraryIds.length === 0) return [];
    return this.db
      .select({ libraryId: libraryFolders.libraryId, path: libraryFolders.path })
      .from(libraryFolders)
      .where(inArray(libraryFolders.libraryId, libraryIds));
  }

  async findWatchedLibraryIds(libraryIds: number[]): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(and(inArray(libraries.id, libraryIds), eq(libraries.watch, true)));
    return rows.map((row) => row.id);
  }
}
