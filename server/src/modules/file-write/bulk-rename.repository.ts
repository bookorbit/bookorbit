import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import type { TargetBookFile } from './book-file-targets';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, bookNarrators, books, libraries, libraryFolders, narrators } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BulkRenameBookData {
  bookId: number;
  title: string | null;
  primaryFileId: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
  libraryFolderPath: string;
  libraryName: string;
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
    seriesIndex: string | null;
  };
  authors: string[];
  narrators: string[];
  /**
   * Every file the book owns, not just the primary one. A multi-track audiobook only reveals that
   * its parts collide on one filename when the siblings are visible, and the preview has to see
   * that to avoid promising a rename the executor would refuse.
   */
  files: TargetBookFile[];
}

@Injectable()
export class BulkRenameRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAllBooksForLibrary(libraryId: number): Promise<BulkRenameBookData[]> {
    const rows = await this.db
      .select({
        bookId: books.id,
        primaryFileId: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        format: bookFiles.format,
        libraryFolderPath: libraryFolders.path,
        libraryName: libraries.name,
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

    if (rows.length === 0) return [];

    const libraryBookIds = this.db.select({ id: books.id }).from(books).where(eq(books.libraryId, libraryId));

    const [authorRows, narratorRows, fileRows] = await Promise.all([
      this.db
        .select({
          bookId: bookAuthors.bookId,
          name: authors.name,
        })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, libraryBookIds))
        .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder)),
      this.db
        .select({
          bookId: bookNarrators.bookId,
          name: narrators.name,
        })
        .from(bookNarrators)
        .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
        .where(inArray(bookNarrators.bookId, libraryBookIds))
        .orderBy(asc(bookNarrators.bookId), asc(bookNarrators.displayOrder)),
      this.db
        .select({
          bookId: bookFiles.bookId,
          id: bookFiles.id,
          absolutePath: bookFiles.absolutePath,
          format: bookFiles.format,
          role: bookFiles.role,
          sortOrder: bookFiles.sortOrder,
        })
        .from(bookFiles)
        .where(inArray(bookFiles.bookId, libraryBookIds))
        .orderBy(asc(bookFiles.bookId), asc(bookFiles.id)),
    ]);

    const filesByBook = new Map<number, TargetBookFile[]>();
    for (const row of fileRows) {
      const entry: TargetBookFile = {
        id: row.id,
        absolutePath: row.absolutePath,
        format: row.format,
        role: row.role,
        sortOrder: row.sortOrder,
      };
      const existing = filesByBook.get(row.bookId);
      if (existing) existing.push(entry);
      else filesByBook.set(row.bookId, [entry]);
    }

    const groupByBook = (rows: { bookId: number; name: string }[]): Map<number, string[]> => {
      const byBook = new Map<number, string[]>();
      for (const row of rows) {
        const existing = byBook.get(row.bookId);
        if (existing) {
          existing.push(row.name);
        } else {
          byBook.set(row.bookId, [row.name]);
        }
      }
      return byBook;
    };

    const authorsByBook = groupByBook(authorRows);
    const narratorsByBook = groupByBook(narratorRows);

    return rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      primaryFileId: row.primaryFileId,
      absolutePath: row.absolutePath,
      relPath: row.relPath,
      format: row.format,
      libraryFolderPath: row.libraryFolderPath,
      libraryName: row.libraryName,
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
      narrators: narratorsByBook.get(row.bookId) ?? [],
      files: filesByBook.get(row.bookId) ?? [],
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
}
