import { Inject, Injectable } from '@nestjs/common';
import { ilike } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async searchAuthors(q: string): Promise<{ id: number; name: string }[]> {
    if (!q.trim()) return [];
    return this.db
      .select({ id: authors.id, name: authors.name })
      .from(authors)
      .where(ilike(authors.name, `%${q}%`))
      .orderBy(authors.name)
      .limit(15);
  }

  async searchTags(q: string): Promise<{ id: number; name: string }[]> {
    if (!q.trim()) return [];
    return this.db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(ilike(tags.name, `%${q}%`))
      .orderBy(tags.name)
      .limit(15);
  }
}
