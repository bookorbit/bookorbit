import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, genres, tags } from '../../db/schema';
import { BookEmbeddingSourceData } from './book-embedding.types';

type Db = NodePgDatabase<typeof schema>;
type NameRow = { name: string | null };

@Injectable()
export class BookEmbedderRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findSourceData(bookId: number): Promise<BookEmbeddingSourceData | null> {
    const [metadata] = await this.db
      .select({
        title: bookMetadata.title,
        seriesName: bookMetadata.seriesName,
        publisher: bookMetadata.publisher,
        description: bookMetadata.description,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    if (!metadata) return null;

    const [authorNames, genreNames, tagNames] = await Promise.all([
      this.fetchRelationNames(
        this.db
          .select({ name: authors.name })
          .from(bookAuthors)
          .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
          .where(eq(bookAuthors.bookId, bookId)),
      ),
      this.fetchRelationNames(
        this.db
          .select({ name: genres.name })
          .from(bookGenres)
          .innerJoin(genres, eq(genres.id, bookGenres.genreId))
          .where(eq(bookGenres.bookId, bookId)),
      ),
      this.fetchRelationNames(
        this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, bookId)),
      ),
    ]);

    return {
      title: metadata.title,
      seriesName: metadata.seriesName,
      publisher: metadata.publisher,
      description: metadata.description,
      authors: authorNames,
      genres: genreNames,
      tags: tagNames,
    };
  }

  async saveEmbedding(bookId: number, embedding: number[]): Promise<void> {
    await this.db.update(bookMetadata).set({ embedding }).where(eq(bookMetadata.bookId, bookId));
  }

  private async fetchRelationNames(queryPromise: Promise<NameRow[]>): Promise<string[]> {
    const rows = await queryPromise;
    return rows.map((row) => (row.name ?? '').trim()).filter((name): name is string => name.length > 0);
  }
}
