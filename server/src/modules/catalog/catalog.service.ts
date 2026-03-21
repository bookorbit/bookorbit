import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, isNotNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookMetadata, collections, genres, narrators, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  searchAuthors(q: string): Promise<{ name: string }[]> {
    return this.searchByName(q, authors);
  }

  searchGenres(q: string): Promise<{ name: string }[]> {
    return this.searchByName(q, genres);
  }

  searchTags(q: string): Promise<{ name: string }[]> {
    return this.searchByName(q, tags);
  }

  searchNarrators(q: string): Promise<{ name: string }[]> {
    if (!q.trim()) return Promise.resolve([]);
    return this.db
      .select({ name: narrators.name })
      .from(narrators)
      .where(ilike(narrators.name, `%${q}%`))
      .orderBy(narrators.name)
      .limit(15);
  }

  searchPublishers(q: string): Promise<{ name: string }[]> {
    if (!q.trim()) return Promise.resolve([]);
    return this.db
      .selectDistinct({ name: bookMetadata.publisher })
      .from(bookMetadata)
      .where(and(isNotNull(bookMetadata.publisher), ilike(bookMetadata.publisher, `%${q}%`)))
      .orderBy(bookMetadata.publisher)
      .limit(15) as Promise<{ name: string }[]>;
  }

  searchSeries(q: string): Promise<{ name: string }[]> {
    if (!q.trim()) return Promise.resolve([]);
    return this.db
      .selectDistinct({ name: bookMetadata.seriesName })
      .from(bookMetadata)
      .where(and(isNotNull(bookMetadata.seriesName), ilike(bookMetadata.seriesName, `%${q}%`)))
      .orderBy(bookMetadata.seriesName)
      .limit(15) as Promise<{ name: string }[]>;
  }

  searchLanguages(q: string): Promise<{ name: string }[]> {
    if (!q.trim()) return Promise.resolve([]);
    return this.db
      .selectDistinct({ name: bookMetadata.language })
      .from(bookMetadata)
      .where(and(isNotNull(bookMetadata.language), ilike(bookMetadata.language, `%${q}%`)))
      .orderBy(bookMetadata.language)
      .limit(15) as Promise<{ name: string }[]>;
  }

  searchCollections(userId: number, q: string): Promise<{ name: string }[]> {
    const baseWhere = eq(collections.userId, userId);
    const where = q.trim() ? and(baseWhere, ilike(collections.name, `%${q}%`)) : baseWhere;
    return this.db.select({ name: collections.name }).from(collections).where(where).orderBy(collections.name).limit(20);
  }

  private searchByName(q: string, table: typeof authors | typeof genres | typeof tags): Promise<{ name: string }[]> {
    if (!q.trim()) return Promise.resolve([]);
    return this.db
      .select({ name: table.name })
      .from(table)
      .where(ilike(table.name, `%${q}%`))
      .orderBy(table.name)
      .limit(15);
  }
}
