import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../db/schema';
import { authors, bookMetadata, bookSeries, collections, genres, narrators, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SearchResult = { name: string };
type SearchResultWithId = { id: number; name: string };
type NamedTable = typeof authors | typeof genres | typeof tags | typeof narrators | typeof bookSeries;
type NamedTableWithId = typeof genres | typeof tags;
type MetadataTextColumn = typeof bookMetadata.publisher | typeof bookMetadata.language;

const DEFAULT_SEARCH_LIMIT = 15;
const COLLECTION_SEARCH_LIMIT = 20;
const LIKE_SPECIAL_CHARS = /[%_\\]/g;

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  searchAuthors(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, authors);
  }

  searchGenres(q: string): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(q, genres);
  }

  searchTags(q: string): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(q, tags);
  }

  searchNarrators(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, narrators);
  }

  searchPublishers(q: string): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.publisher);
  }

  searchSeries(q: string): Promise<SearchResult[]> {
    return this.searchByName(q, bookSeries);
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
      .where(and(eq(collections.userId, userId), accentInsensitiveIlike(collections.name, pattern)))
      .orderBy(collections.name)
      .limit(COLLECTION_SEARCH_LIMIT);
  }

  private searchByName(q: string, table: NamedTable): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db
      .select({ name: table.name })
      .from(table)
      .where(accentInsensitiveIlike(table.name, pattern))
      .orderBy(table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private searchByNameWithId(q: string, table: NamedTableWithId): Promise<SearchResultWithId[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(accentInsensitiveIlike(table.name, pattern))
      .orderBy(table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private async searchDistinctMetadataField(q: string, column: MetadataTextColumn): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const rows = await this.db
      .selectDistinct({ name: column })
      .from(bookMetadata)
      .where(and(isNotNull(column), accentInsensitiveIlike(column, pattern)))
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
