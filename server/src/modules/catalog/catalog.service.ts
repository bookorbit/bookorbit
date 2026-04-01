import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, isNotNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookMetadata, collections, genres, narrators, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SearchResult = { name: string };
type NamedTable = typeof authors | typeof genres | typeof tags | typeof narrators;
type MetadataTextColumn = typeof bookMetadata.publisher | typeof bookMetadata.seriesName | typeof bookMetadata.language;

const DEFAULT_SEARCH_LIMIT = 15;
const COLLECTION_SEARCH_LIMIT = 20;
const LIKE_SPECIAL_CHARS = /[%_\\]/g;

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  searchAuthors(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, authors);
  }

  searchGenres(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, genres);
  }

  searchTags(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, tags);
  }

  searchNarrators(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, narrators);
  }

  searchPublishers(q: string): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.publisher);
  }

  searchSeries(q: string): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.seriesName);
  }

  searchLanguages(q: string): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.language);
  }

  searchCollections(userId: number, q: string): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db
      .select({ name: collections.name })
      .from(collections)
      .where(and(eq(collections.userId, userId), ilike(collections.name, pattern)))
      .orderBy(collections.name)
      .limit(COLLECTION_SEARCH_LIMIT);
  }

  private searchByName(q: string, table: NamedTable): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db.select({ name: table.name }).from(table).where(ilike(table.name, pattern)).orderBy(table.name).limit(DEFAULT_SEARCH_LIMIT);
  }

  private async searchDistinctMetadataField(q: string, column: MetadataTextColumn): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const rows = await this.db
      .selectDistinct({ name: column })
      .from(bookMetadata)
      .where(and(isNotNull(column), ilike(column, pattern)))
      .orderBy(column)
      .limit(DEFAULT_SEARCH_LIMIT);

    return rows.filter((row): row is SearchResult => row.name !== null);
  }

  private toContainsPattern(q: string): string | null {
    const term = q.trim();
    if (!term) return null;

    const escaped = term.replace(LIKE_SPECIAL_CHARS, '\\$&');
    return `%${escaped}%`;
  }
}
