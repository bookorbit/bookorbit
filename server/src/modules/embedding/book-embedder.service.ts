import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, genres, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const DIMS = 256;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'to',
  'for',
  'is',
  'it',
  'on',
  'at',
  'by',
  'with',
  'as',
  'be',
  'this',
  'that',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'not',
  'but',
  'from',
  'can',
  'all',
  'so',
  'if',
  'no',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'do',
  'does',
  'did',
  'been',
  'being',
  'into',
  'out',
  'up',
  'one',
  'two',
  'more',
  'most',
  'also',
  'just',
  'about',
  'after',
  'its',
]);

@Injectable()
export class BookEmbedderService {
  private readonly logger = new Logger(BookEmbedderService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async embedBook(bookId: number): Promise<number[] | null> {
    const [meta] = await this.db
      .select({
        title: bookMetadata.title,
        seriesName: bookMetadata.seriesName,
        publisher: bookMetadata.publisher,
        description: bookMetadata.description,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    if (!meta) return null;

    const [authorRows, genreRows, tagRows] = await Promise.all([
      this.db
        .select({ name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, bookId)),
      this.db
        .select({ name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(eq(bookGenres.bookId, bookId)),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, bookId)),
    ]);

    const embedding = this.buildVector({
      title: meta.title,
      seriesName: meta.seriesName,
      publisher: meta.publisher,
      description: meta.description,
      authors: authorRows.map((r) => r.name),
      genres: genreRows.map((r) => r.name),
      tags: tagRows.map((r) => r.name),
    });

    await this.db.update(bookMetadata).set({ embedding }).where(eq(bookMetadata.bookId, bookId));

    this.logger.debug(`Embedded book ${bookId}`);
    return embedding;
  }

  buildVector(params: {
    title: string | null;
    authors: string[];
    genres: string[];
    tags: string[];
    seriesName: string | null;
    publisher: string | null;
    description: string | null;
  }): number[] {
    const acc = new Float64Array(DIMS);

    const addExact = (text: string, weight: number) => {
      const key = text.toLowerCase().trim();
      if (key.length > 0) acc[this.fnv32(key) % DIMS] += weight;
    };

    const addTokens = (text: string, weight: number) => {
      for (const token of this.tokenize(text)) {
        acc[this.fnv32(token) % DIMS] += weight;
      }
    };

    if (params.seriesName) addExact(params.seriesName, 3.0);
    for (const author of params.authors) addExact(author, 1.0);
    for (const genre of params.genres) addExact(genre, 4.0);
    for (const tag of params.tags) addExact(tag, 3.5);
    if (params.title) addTokens(params.title, 3.0);
    if (params.publisher) addExact(params.publisher, 2.0);
    if (params.description) {
      addTokens(params.description.split(/\s+/).slice(0, 100).join(' '), 1.0);
    }

    return this.l2normalize(Array.from(acc));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  }

  private fnv32(s: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  private l2normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}
