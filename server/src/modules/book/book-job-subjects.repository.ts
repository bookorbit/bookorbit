import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, books } from '../../db/schema';

export interface BookJobSubjectRow {
  title: string | null;
  coverUpdatedAt: Date | null;
  authors: string[];
}

/** Titles, authors and cover versions for the books a page of jobs is about, in two queries. */
@Injectable()
export class BookJobSubjectsRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async find(bookIds: readonly number[]): Promise<Map<number, BookJobSubjectRow>> {
    if (bookIds.length === 0) return new Map();
    const ids = [...bookIds];
    const [rows, credits] = await Promise.all([
      this.db
        .select({ id: books.id, title: bookMetadata.title, coverUpdatedAt: bookMetadata.coverUpdatedAt })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, ids)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, ids))
        .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder)),
    ]);
    const found = new Map<number, BookJobSubjectRow>(
      rows.map((row) => [row.id, { title: row.title, coverUpdatedAt: row.coverUpdatedAt, authors: [] }]),
    );
    for (const credit of credits) found.get(credit.bookId)?.authors.push(credit.name);
    return found;
  }
}
