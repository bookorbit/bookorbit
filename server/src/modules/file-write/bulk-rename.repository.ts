import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, libraries, libraryFolders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BulkRenameBookData {
  bookId: number;
  title: string | null;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
  libraryFolderPath: string;
  organizationMode: string;
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

@Injectable()
export class BulkRenameRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAllBooksForLibrary(libraryId: number): Promise<BulkRenameBookData[]> {
    const rows = await this.db
      .select({
        bookId: books.id,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        format: bookFiles.format,
        libraryFolderPath: libraryFolders.path,
        organizationMode: libraries.organizationMode,
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
      .where(eq(books.libraryId, libraryId))
      .orderBy(asc(books.id));

    const bookIds = rows.map((r) => r.bookId);
    if (bookIds.length === 0) return [];

    const authorRows = await this.db
      .select({
        bookId: bookAuthors.bookId,
        name: authors.name,
      })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(inArray(bookAuthors.bookId, bookIds))
      .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder));

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const existing = authorsByBook.get(row.bookId);
      if (existing) {
        existing.push(row.name);
      } else {
        authorsByBook.set(row.bookId, [row.name]);
      }
    }

    return rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      absolutePath: row.absolutePath,
      relPath: row.relPath,
      format: row.format,
      libraryFolderPath: row.libraryFolderPath,
      organizationMode: row.organizationMode,
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
      authors: authorsByBook.get(row.bookId) ?? [],
    }));
  }

  async findLibrarySettings(libraryId: number): Promise<{
    fileRenameEnabled: boolean;
    fileNamingPattern: string | null;
    organizationMode: string;
    watch: boolean;
  } | null> {
    const [row] = await this.db
      .select({
        fileRenameEnabled: libraries.fileRenameEnabled,
        fileNamingPattern: libraries.fileNamingPattern,
        organizationMode: libraries.organizationMode,
        watch: libraries.watch,
      })
      .from(libraries)
      .where(eq(libraries.id, libraryId))
      .limit(1);

    return row ?? null;
  }

  async findLibraryBookIds(libraryId: number): Promise<number[]> {
    const rows = await this.db.select({ id: books.id }).from(books).where(eq(books.libraryId, libraryId)).orderBy(asc(books.id));
    return rows.map((r) => r.id);
  }
}
