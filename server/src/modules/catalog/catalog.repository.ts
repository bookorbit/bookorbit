import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { ContentFilterRules } from '@bookorbit/types';
import { accentInsensitiveExactMatchRank, accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { normalizeMetadataText } from '../../common/utils/metadata-text-normalize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookGenres,
  bookMetadata,
  bookNarrators,
  bookSeries,
  bookSeriesMemberships,
  bookTags,
  books,
  collections,
  genres,
  narrators,
  tags,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SearchResult = { name: string };
type SearchResultWithId = { id: number; name: string };
type NamedTable = typeof authors | typeof narrators | typeof bookSeries;
type NamedTableWithId = typeof genres | typeof tags;
type MetadataTextColumn = typeof bookMetadata.publisher | typeof bookMetadata.language;
type Junction = { table: PgTable; entityId: PgColumn; bookId: PgColumn };

const AUTHOR_JUNCTION: Junction = { table: bookAuthors, entityId: bookAuthors.authorId, bookId: bookAuthors.bookId };
const GENRE_JUNCTION: Junction = { table: bookGenres, entityId: bookGenres.genreId, bookId: bookGenres.bookId };
const TAG_JUNCTION: Junction = { table: bookTags, entityId: bookTags.tagId, bookId: bookTags.bookId };
const NARRATOR_JUNCTION: Junction = { table: bookNarrators, entityId: bookNarrators.narratorId, bookId: bookNarrators.bookId };
const SERIES_JUNCTION: Junction = {
  table: bookSeriesMemberships,
  entityId: bookSeriesMemberships.seriesId,
  bookId: bookSeriesMemberships.bookId,
};

export interface CatalogSearchScope {
  libraryIds: number[];
  contentFilters?: ContentFilterRules;
}

const DEFAULT_SEARCH_LIMIT = 15;
const COLLECTION_SEARCH_LIMIT = 20;

@Injectable()
export class CatalogRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  searchAuthors(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchByName(q, authors, AUTHOR_JUNCTION, scope);
  }

  searchGenres(q: string, scope: CatalogSearchScope): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(q, genres, GENRE_JUNCTION, scope);
  }

  searchTags(q: string, scope: CatalogSearchScope): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(q, tags, TAG_JUNCTION, scope);
  }

  searchNarrators(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchByName(q, narrators, NARRATOR_JUNCTION, scope);
  }

  searchPublishers(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.publisher, scope);
  }

  searchSeries(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchByName(q, bookSeries, SERIES_JUNCTION, scope);
  }

  searchLanguages(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.language, scope);
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

  private searchByName(q: string, table: NamedTable, junction: Junction, scope: CatalogSearchScope): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db
      .selectDistinct({ name: table.name })
      .from(table)
      .innerJoin(junction.table, eq(junction.entityId, table.id))
      .innerJoin(books, eq(books.id, junction.bookId))
      .where(and(accentInsensitiveIlike(table.name, pattern), ...this.visibilityClauses(scope)))
      .orderBy(table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private searchByNameWithId(q: string, table: NamedTableWithId, junction: Junction, scope: CatalogSearchScope): Promise<SearchResultWithId[]> {
    const term = normalizeMetadataText(q);
    if (!term) return Promise.resolve([]);

    return this.db
      .select({ id: table.id, name: table.name })
      .from(table)
      .innerJoin(junction.table, eq(junction.entityId, table.id))
      .innerJoin(books, eq(books.id, junction.bookId))
      .where(and(accentInsensitiveIlike(table.name, buildSearchPattern(term)), ...this.visibilityClauses(scope)))
      .groupBy(table.id, table.name)
      .orderBy(accentInsensitiveExactMatchRank(table.name, term), table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private async searchDistinctMetadataField(q: string, column: MetadataTextColumn, scope: CatalogSearchScope): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const rows = await this.db
      .selectDistinct({ name: column })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(column), accentInsensitiveIlike(column, pattern), ...this.visibilityClauses(scope)))
      .orderBy(column)
      .limit(DEFAULT_SEARCH_LIMIT);

    return rows.filter((row): row is SearchResult => row.name !== null);
  }

  private visibilityClauses(scope: CatalogSearchScope): SQL[] {
    return [inArray(books.libraryId, scope.libraryIds), ...(scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, this.db) : [])];
  }

  private toContainsPattern(q: string): string | null {
    const term = q.trim();
    if (!term) return null;

    return buildSearchPattern(term);
  }
}
