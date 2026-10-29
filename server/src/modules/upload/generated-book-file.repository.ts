import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraries, libraryFolders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class GeneratedBookFileRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Where the book lives and what its library accepts. */
  async findBookPlacement(bookId: number) {
    const [book] = await this.db
      .select({
        folderPath: books.folderPath,
        libraryId: books.libraryId,
        libraryFolderId: books.libraryFolderId,
        allowedFormats: libraries.allowedFormats,
        organizationMode: libraries.organizationMode,
        libraryFolderPath: libraryFolders.path,
      })
      .from(books)
      .innerJoin(libraries, eq(books.libraryId, libraries.id))
      .innerJoin(libraryFolders, eq(books.libraryFolderId, libraryFolders.id))
      .where(eq(books.id, bookId))
      .limit(1);
    return book ?? null;
  }

  async findFile(bookId: number, fileId: number) {
    const [file] = await this.db
      .select({ id: bookFiles.id, absolutePath: bookFiles.absolutePath, fileHash: bookFiles.fileHash, format: bookFiles.format })
      .from(bookFiles)
      .where(and(eq(bookFiles.id, fileId), eq(bookFiles.bookId, bookId)))
      .limit(1);
    return file ?? null;
  }

  async findFileByPath(absolutePath: string): Promise<{ id: number; bookId: number } | null> {
    const [row] = await this.db
      .select({ id: bookFiles.id, bookId: bookFiles.bookId })
      .from(bookFiles)
      .where(eq(bookFiles.absolutePath, absolutePath))
      .limit(1);
    return row ?? null;
  }

  async findFileIdByHash(bookId: number, fileHash: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: bookFiles.id })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.fileHash, fileHash)))
      .limit(1);
    return row?.id ?? null;
  }
}
