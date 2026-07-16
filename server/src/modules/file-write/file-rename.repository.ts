import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, libraries, libraryFolders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookRenameData {
  file: {
    id: number;
    absolutePath: string;
    relPath: string | null;
    format: string | null;
    role: string;
  };
  libraryId: number;
  libraryFolderId: number;
  libraryFolderPath: string;
  organizationMode: string;
  fileRenameEnabled: boolean;
  fileNamingPattern: string | null;
  bookFolderPath: string;
  metadata: {
    title: string | null;
    subtitle: string | null;
    publisher: string | null;
    language: string | null;
    isbn13: string | null;
    publishedYear: number | null;
    seriesName: string | null;
    seriesIndex: number | null;
  };
  authors: string[];
}

export interface BookFilePathUpdate {
  id: number;
  absolutePath: string;
  relPath: string | null;
}

@Injectable()
export class FileRenameRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findBookRenameData(bookId: number): Promise<BookRenameData | null> {
    const [row] = await this.db
      .select({
        fileId: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        format: bookFiles.format,
        role: bookFiles.role,
        libraryFolderId: bookFiles.libraryFolderId,
        libraryFolderPath: libraryFolders.path,
        libraryId: books.libraryId,
        organizationMode: libraries.organizationMode,
        fileRenameEnabled: libraries.fileRenameEnabled,
        fileNamingPattern: libraries.fileNamingPattern,
        bookFolderPath: books.folderPath,
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
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, bookId));

    if (!row) return null;

    const authorRows = await this.db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eq(bookAuthors.bookId, bookId))
      .orderBy(asc(bookAuthors.displayOrder));

    return {
      file: {
        id: row.fileId,
        absolutePath: row.absolutePath,
        relPath: row.relPath,
        format: row.format,
        role: row.role,
      },
      libraryId: row.libraryId,
      libraryFolderId: row.libraryFolderId,
      libraryFolderPath: row.libraryFolderPath,
      organizationMode: row.organizationMode,
      fileRenameEnabled: row.fileRenameEnabled,
      fileNamingPattern: row.fileNamingPattern,
      bookFolderPath: row.bookFolderPath,
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
      authors: authorRows.map((author) => author.name),
    };
  }

  async findAllBookFiles(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        role: bookFiles.role,
        format: bookFiles.format,
        sortOrder: bookFiles.sortOrder,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.id));
  }

  async updateBookFilePath(fileId: number, absolutePath: string, relPath: string | null): Promise<void> {
    await this.db.update(bookFiles).set({ absolutePath, relPath }).where(eq(bookFiles.id, fileId));
  }

  async updateBookFolderPath(bookId: number, folderPath: string): Promise<void> {
    await this.db.update(books).set({ folderPath }).where(eq(books.id, bookId));
  }

  async applyFolderRename(bookId: number, updates: BookFilePathUpdate[], folderPath: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const update of updates) {
        await tx.update(bookFiles).set({ absolutePath: update.absolutePath, relPath: update.relPath }).where(eq(bookFiles.id, update.id));
      }
      await tx.update(books).set({ folderPath }).where(eq(books.id, bookId));
    });
  }

  async findBookByExactFolderPath(
    libraryId: number,
    folderPath: string,
  ): Promise<Pick<typeof books.$inferSelect, 'id' | 'folderPath' | 'primaryFileId' | 'status'> | null> {
    const [row] = await this.db
      .select({
        id: books.id,
        folderPath: books.folderPath,
        primaryFileId: books.primaryFileId,
        status: books.status,
      })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), eq(books.folderPath, folderPath)))
      .limit(1);

    return row ?? null;
  }

  async applyExistingFolderMerge(input: {
    sourceBookId: number;
    targetBookId: number;
    updates: BookFilePathUpdate[];
    fallbackPrimaryFileId: number | null;
  }): Promise<void> {
    if (input.sourceBookId === input.targetBookId) return;

    await this.db.transaction(async (tx) => {
      const now = new Date();
      const [target] = await tx
        .select({ libraryFolderId: books.libraryFolderId, primaryFileId: books.primaryFileId })
        .from(books)
        .where(eq(books.id, input.targetBookId))
        .for('update')
        .limit(1);
      if (!target) return;

      for (const update of input.updates) {
        await tx
          .update(bookFiles)
          .set({
            bookId: input.targetBookId,
            libraryFolderId: target.libraryFolderId,
            absolutePath: update.absolutePath,
            relPath: update.relPath,
            updatedAt: now,
          })
          .where(eq(bookFiles.id, update.id));
      }

      await tx.delete(books).where(eq(books.id, input.sourceBookId));

      await tx
        .update(books)
        .set({
          ...(target?.primaryFileId == null && input.fallbackPrimaryFileId != null ? { primaryFileId: input.fallbackPrimaryFileId } : {}),
          status: 'present',
          updatedAt: now,
        })
        .where(eq(books.id, input.targetBookId));
    });
  }

  async checkPathTakenByOtherBook(absolutePath: string, currentBookId: number): Promise<boolean> {
    const rows = await this.db
      .select({ bookId: books.id })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.absolutePath, absolutePath))
      .limit(1);

    return rows.length > 0 && rows[0].bookId !== currentBookId;
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
}
