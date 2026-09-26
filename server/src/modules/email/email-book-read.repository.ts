import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, bookTags, books, libraries, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailBookReadRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findBookById(bookId: number): Promise<typeof books.$inferSelect | null> {
    const [book] = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    return book ?? null;
  }

  async findBookPrimaryFileId(bookId: number): Promise<number | null> {
    const [book] = await this.db.select({ primaryFileId: books.primaryFileId }).from(books).where(eq(books.id, bookId)).limit(1);
    return book?.primaryFileId ?? null;
  }

  async findFileForBook(bookId: number, fileId: number): Promise<typeof bookFiles.$inferSelect | null> {
    const [file] = await this.db
      .select()
      .from(bookFiles)
      .where(and(eq(bookFiles.id, fileId), eq(bookFiles.bookId, bookId)))
      .limit(1);
    return file ?? null;
  }

  findFilesByBookId(bookId: number): Promise<(typeof bookFiles.$inferSelect)[]> {
    return this.db.select().from(bookFiles).where(eq(bookFiles.bookId, bookId)).orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  async findLibraryFormatPriority(bookId: number): Promise<string[] | null> {
    const [row] = await this.db
      .select({ formatPriority: libraries.formatPriority })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, bookId))
      .limit(1);
    return (row?.formatPriority as string[] | null | undefined) ?? null;
  }

  async findMetadataByBookId(bookId: number): Promise<typeof bookMetadata.$inferSelect | null> {
    const [metadata] = await this.db.select().from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return metadata ?? null;
  }

  findAuthorNamesByBookId(bookId: number): Promise<{ name: string | null }[]> {
    return this.db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eq(bookAuthors.bookId, bookId))
      .orderBy(bookAuthors.displayOrder);
  }

  findTagNamesByBookId(bookId: number): Promise<{ name: string }[]> {
    return this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, bookId));
  }

  async findFileById(fileId: number): Promise<typeof bookFiles.$inferSelect | null> {
    const [file] = await this.db.select().from(bookFiles).where(eq(bookFiles.id, fileId)).limit(1);
    return file ?? null;
  }
}
