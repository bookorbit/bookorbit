import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ilike, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, bookTags, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findCards(libraryId: number, opts: { page: number; size: number; search?: string }) {
    const { page, size, search } = opts;
    const offset = page * size;

    const searchFilter = search?.trim() ? ilike(bookMetadata.title, `%${search.trim()}%`) : undefined;

    const where = and(eq(books.libraryId, libraryId), searchFilter);

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: books.id,
          status: books.status,
          folderPath: books.folderPath,
          title: bookMetadata.title,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(bookMetadata.title)
        .limit(size)
        .offset(offset),
      this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where),
    ]);

    const bookIds = rows.map((r) => r.id);
    const authorRows =
      bookIds.length > 0
        ? await this.db
            .select({ bookId: bookAuthors.bookId, name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(inArray(bookAuthors.bookId, bookIds))
            .orderBy(bookAuthors.displayOrder)
        : [];

    return { rows, authorRows, total: Number(total) };
  }

  async findById(id: number) {
    const [book] = await this.db.select().from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(eq(books.id, id)).limit(1);

    if (!book) return null;

    const [authorRows, tagRows, fileRows] = await Promise.all([
      this.db
        .select({ id: authors.id, name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, id))
        .orderBy(bookAuthors.displayOrder),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, id)),
      this.db
        .select({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          absolutePath: bookFiles.absolutePath,
        })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, id)),
    ]);

    return { book, authorRows, tagRows, fileRows };
  }
}
