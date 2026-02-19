import { Inject, Injectable } from '@nestjs/common';
import { ilike } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, genres, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  searchAuthors(q: string) {
    return this.searchByName(q, authors);
  }

  searchGenres(q: string) {
    return this.searchByName(q, genres);
  }

  searchTags(q: string) {
    return this.searchByName(q, tags);
  }

  private searchByName(q: string, table: typeof authors | typeof genres | typeof tags): Promise<{ id: number; name: string }[]> {
    if (!q.trim()) return Promise.resolve([]);
    return this.db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(ilike(table.name, `%${q}%`))
      .orderBy(table.name)
      .limit(15);
  }
}
