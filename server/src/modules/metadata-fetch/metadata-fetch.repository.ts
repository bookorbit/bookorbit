import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, books, userLibraryAccess } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface StoredProviderIdsRow {
  libraryId: number;
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
  itunesId: string | null;
  audibleId: string | null;
  comicvineId: string | null;
  ranobedbId: string | null;
}

@Injectable()
export class MetadataFetchRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findStoredProviderIdsRow(bookId: number): Promise<StoredProviderIdsRow | null> {
    const [row] = await this.db
      .select({
        libraryId: books.libraryId,
        googleBooksId: bookMetadata.googleBooksId,
        goodreadsId: bookMetadata.goodreadsId,
        amazonId: bookMetadata.amazonId,
        hardcoverId: bookMetadata.hardcoverId,
        openLibraryId: bookMetadata.openLibraryId,
        itunesId: bookMetadata.itunesId,
        audibleId: bookMetadata.audibleId,
        comicvineId: bookMetadata.comicvineId,
        ranobedbId: bookMetadata.ranobedbId,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(books.id, bookId))
      .limit(1);

    return row ?? null;
  }

  async hasLibraryAccess(userId: number, libraryId: number): Promise<boolean> {
    const row = await this.db.query.userLibraryAccess.findFirst({
      where: and(eq(userLibraryAccess.userId, userId), eq(userLibraryAccess.libraryId, libraryId)),
      columns: {
        userId: true,
      },
    });
    return row != null;
  }
}
