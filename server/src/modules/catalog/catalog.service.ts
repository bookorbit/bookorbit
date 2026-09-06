import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, eq, inArray, isNotNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { DB } from '../../db';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import type { RequestUser } from '../../common/types/request-user';
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
import { LibraryService } from '../library/library.service';

type Db = NodePgDatabase<typeof schema>;
type SearchResult = { name: string };
type SearchResultWithId = { id: number; name: string };
type NamedTable = typeof authors | typeof genres | typeof tags | typeof narrators | typeof bookSeries;
type NamedTableWithId = typeof genres | typeof tags;
type MetadataTextColumn = typeof bookMetadata.publisher | typeof bookMetadata.language;

/** How a vocabulary table reaches `books`, so a suggestion can be proven reachable. */
type Junction = { table: PgTable; entityId: PgColumn; bookId: PgColumn };

const DEFAULT_SEARCH_LIMIT = 15;
const COLLECTION_SEARCH_LIMIT = 20;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly libraryService: LibraryService,
  ) {}

  searchAuthors(user: RequestUser, q: string): Promise<SearchResult[]> {
    return this.searchByName(user, q, authors, {
      table: bookAuthors,
      entityId: bookAuthors.authorId,
      bookId: bookAuthors.bookId,
    });
  }

  searchGenres(user: RequestUser, q: string): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(user, q, genres, {
      table: bookGenres,
      entityId: bookGenres.genreId,
      bookId: bookGenres.bookId,
    });
  }

  searchTags(user: RequestUser, q: string): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(user, q, tags, {
      table: bookTags,
      entityId: bookTags.tagId,
      bookId: bookTags.bookId,
    });
  }

  searchNarrators(user: RequestUser, q: string): Promise<SearchResult[]> {
    return this.searchByName(user, q, narrators, {
      table: bookNarrators,
      entityId: bookNarrators.narratorId,
      bookId: bookNarrators.bookId,
    });
  }

  searchPublishers(user: RequestUser, q: string): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(user, q, bookMetadata.publisher);
  }

  searchSeries(user: RequestUser, q: string): Promise<SearchResult[]> {
    return this.searchByName(user, q, bookSeries, {
      table: bookSeriesMemberships,
      entityId: bookSeriesMemberships.seriesId,
      bookId: bookSeriesMemberships.bookId,
    });
  }

  searchLanguages(user: RequestUser, q: string): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(user, q, bookMetadata.language);
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

  /**
   * The clauses that make a suggestion reachable: the book carrying it must sit in a
   * library this user can open, and must survive their content filters.
   *
   * Returns null when the user can open no library at all, which is not the same as an
   * empty clause list -- an empty list would suggest the entire vocabulary.
   *
   * Superusers skip the content filter, matching AuthorsService.
   */
  private async visibilityClauses(user: RequestUser): Promise<SQL[] | null> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (libraryIds.length === 0) return null;

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    return [inArray(books.libraryId, libraryIds), ...(contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [])];
  }

  private async searchByName(user: RequestUser, q: string, table: NamedTable, junction: Junction): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const visibility = await this.visibilityClauses(user);
    if (!visibility) return [];

    return this.db
      .selectDistinct({ name: table.name })
      .from(table)
      .innerJoin(junction.table, eq(junction.entityId, table.id))
      .innerJoin(books, eq(books.id, junction.bookId))
      .where(and(accentInsensitiveIlike(table.name, pattern), ...visibility))
      .orderBy(table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private async searchByNameWithId(user: RequestUser, q: string, table: NamedTableWithId, junction: Junction): Promise<SearchResultWithId[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const visibility = await this.visibilityClauses(user);
    if (!visibility) return [];

    return this.db
      .selectDistinct({ id: table.id, name: table.name })
      .from(table)
      .innerJoin(junction.table, eq(junction.entityId, table.id))
      .innerJoin(books, eq(books.id, junction.bookId))
      .where(and(accentInsensitiveIlike(table.name, pattern), ...visibility))
      .orderBy(table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private async searchDistinctMetadataField(user: RequestUser, q: string, column: MetadataTextColumn): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const visibility = await this.visibilityClauses(user);
    if (!visibility) return [];

    const rows = await this.db
      .selectDistinct({ name: column })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(column), accentInsensitiveIlike(column, pattern), ...visibility))
      .orderBy(column)
      .limit(DEFAULT_SEARCH_LIMIT);

    return rows.filter((row): row is SearchResult => row.name !== null);
  }

  private toContainsPattern(q: string): string | null {
    const term = q.trim();
    if (!term) return null;

    return buildSearchPattern(term);
  }
}
