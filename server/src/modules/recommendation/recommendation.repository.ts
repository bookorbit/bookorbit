import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, ne, and, isNotNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, books, genres, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
const ANN_CANDIDATE_FETCH_LIMIT = 100;

export interface AnnCandidate {
  bookId: number;
  cosineSim: number;
  seriesName: string | null;
  rating: number | null;
}

export interface CandidateMetadata {
  bookId: number;
  authorNames: string[];
  genreTagNames: string[];
}

export interface TargetBookData {
  embedding: number[] | null;
  seriesName: string | null;
  rating: number | null;
  authorNames: string[];
  genreTagNames: string[];
}

@Injectable()
export class RecommendationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getTargetBookData(bookId: number): Promise<TargetBookData | null> {
    const [meta] = await this.db
      .select({
        embedding: bookMetadata.embedding,
        seriesName: bookMetadata.seriesName,
        rating: bookMetadata.rating,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    if (!meta) return null;

    const [candidateMetadata] = await this.getCandidateMetadata([bookId]);

    return {
      embedding: meta.embedding,
      seriesName: meta.seriesName,
      rating: meta.rating,
      authorNames: candidateMetadata?.authorNames ?? [],
      genreTagNames: candidateMetadata?.genreTagNames ?? [],
    };
  }

  async findAnnCandidates(embedding: number[], targetBookId: number, libraryIds: number[]): Promise<AnnCandidate[]> {
    if (libraryIds.length === 0 || embedding.length === 0 || embedding.some((v) => !Number.isFinite(v))) return [];

    const vecStr = `[${embedding.join(',')}]`;

    return this.db
      .select({
        bookId: bookMetadata.bookId,
        cosineSim: sql<number>`(1 - (${bookMetadata.embedding} <=> ${vecStr}::vector))::float`,
        seriesName: bookMetadata.seriesName,
        rating: bookMetadata.rating,
      })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(inArray(books.libraryId, libraryIds), ne(bookMetadata.bookId, targetBookId), isNotNull(bookMetadata.embedding)))
      .orderBy(sql`${bookMetadata.embedding} <=> ${vecStr}::vector`)
      .limit(ANN_CANDIDATE_FETCH_LIMIT);
  }

  async getCandidateMetadata(bookIds: number[]): Promise<CandidateMetadata[]> {
    if (bookIds.length === 0) return [];

    const [authorRows, genreRows, tagRows] = await Promise.all([
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds)),
      this.db
        .select({ bookId: bookGenres.bookId, name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(inArray(bookGenres.bookId, bookIds)),
      this.db
        .select({ bookId: bookTags.bookId, name: tags.name })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(inArray(bookTags.bookId, bookIds)),
    ]);

    const authorsByBook = this.groupNamesByBook(authorRows);
    const genreTagsByBook = this.groupNamesByBook([...genreRows, ...tagRows]);

    return bookIds.map((id) => ({
      bookId: id,
      authorNames: authorsByBook.get(id) ?? [],
      genreTagNames: genreTagsByBook.get(id) ?? [],
    }));
  }

  private groupNamesByBook(rows: Array<{ bookId: number; name: string }>): Map<number, string[]> {
    const grouped = new Map<number, string[]>();
    for (const row of rows) {
      const names = grouped.get(row.bookId) ?? [];
      names.push(row.name);
      grouped.set(row.bookId, names);
    }
    return grouped;
  }
}
