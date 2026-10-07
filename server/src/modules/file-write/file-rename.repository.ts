import { deleteBooksWithHashInvalidation } from '../../db/book-file-hash-history';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, bookNarrators, books, libraries, libraryFolders, narrators } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookRenameData {
  file: {
    id: number;
    absolutePath: string;
    relPath: string | null;
    format: string | null;
    role: string;
    mediaOverlayAvailable: boolean;
  };
  libraryId: number;
  libraryName: string;
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
    isbn10: string | null;
    isbn13: string | null;
    publishedYear: number | null;
    seriesName: string | null;
    seriesIndex: string | null;
  };
  authors: string[];
  narrators: string[];
}

export interface BookFilePathUpdate {
  id: number;
  absolutePath: string;
  relPath: string | null;
}

export interface FolderOwner {
  bookId: number;
  title: string | null;
  primaryAuthor: string | null;
}

const FOLDER_OWNER_BATCH_SIZE = 500;

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
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
        libraryFolderId: bookFiles.libraryFolderId,
        libraryFolderPath: libraryFolders.path,
        libraryId: books.libraryId,
        libraryName: libraries.name,
        organizationMode: libraries.organizationMode,
        fileRenameEnabled: libraries.fileRenameEnabled,
        fileNamingPattern: libraries.fileNamingPattern,
        bookFolderPath: books.folderPath,
        title: bookMetadata.title,
        subtitle: bookMetadata.subtitle,
        publisher: bookMetadata.publisher,
        language: bookMetadata.language,
        isbn10: bookMetadata.isbn10,
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

    const [authorRows, narratorRows] = await Promise.all([
      this.db
        .select({ name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, bookId))
        .orderBy(asc(bookAuthors.displayOrder)),
      this.db
        .select({ name: narrators.name })
        .from(bookNarrators)
        .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
        .where(eq(bookNarrators.bookId, bookId))
        .orderBy(asc(bookNarrators.displayOrder)),
    ]);

    return {
      file: {
        id: row.fileId,
        absolutePath: row.absolutePath,
        relPath: row.relPath,
        format: row.format,
        role: row.role,
        mediaOverlayAvailable: row.mediaOverlayAvailable,
      },
      libraryId: row.libraryId,
      libraryName: row.libraryName,
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
        isbn10: row.isbn10,
        isbn13: row.isbn13,
        publishedYear: row.publishedYear,
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
      },
      authors: authorRows.map((author) => author.name),
      narrators: narratorRows.map((narrator) => narrator.name),
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
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
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

  /** The book that holds each folder, keyed by folder path. Folders no book holds are absent. */
  async findFolderOwners(libraryId: number, folderPaths: string[]): Promise<Map<string, FolderOwner>> {
    const owners = new Map<string, FolderOwner>();
    const uniquePaths = [...new Set(folderPaths)];

    for (let i = 0; i < uniquePaths.length; i += FOLDER_OWNER_BATCH_SIZE) {
      const batch = uniquePaths.slice(i, i + FOLDER_OWNER_BATCH_SIZE);
      const rows = await this.db
        .select({ bookId: books.id, folderPath: books.folderPath, title: bookMetadata.title })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(eq(books.libraryId, libraryId), inArray(books.folderPath, batch)));
      if (rows.length === 0) continue;

      const ownerIds = rows.map((row) => row.bookId);
      const authorRows = await this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, ownerIds))
        .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder));
      const primaryAuthorByBookId = new Map<number, string>();
      for (const author of authorRows) {
        if (!primaryAuthorByBookId.has(author.bookId)) primaryAuthorByBookId.set(author.bookId, author.name);
      }

      for (const row of rows) {
        owners.set(row.folderPath, {
          bookId: row.bookId,
          title: row.title ?? null,
          primaryAuthor: primaryAuthorByBookId.get(row.bookId) ?? null,
        });
      }
    }

    return owners;
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

      await deleteBooksWithHashInvalidation(tx, eq(books.id, input.sourceBookId));

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
