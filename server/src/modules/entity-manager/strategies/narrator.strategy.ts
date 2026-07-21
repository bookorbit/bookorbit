import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { bookMetadata, bookNarrators, books, narrators } from '../../../db/schema';
import type { BrowseParams, BrowseResult, EntityBookScope } from './entity-strategy.interface';
import { buildEntityBookScopeClauses } from './entity-book-scope';
import { JunctionEntityStrategy } from './junction-entity.strategy';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class NarratorStrategy extends JunctionEntityStrategy {
  readonly entityType = 'narrator' as const;
  protected readonly entityTable = narrators;
  protected readonly junctionTable = bookNarrators;
  protected readonly entityIdCol = narrators.id;
  protected readonly junctionEntityIdCol = bookNarrators.narratorId;
  protected readonly junctionBookIdCol = bookNarrators.bookId;
  protected readonly nameCol = narrators.name;
  protected readonly rawTableName = 'narrators';
  protected readonly rawJunctionTable = 'book_narrators';
  protected readonly rawEntityIdCol = 'narrator_id';
  protected readonly hasCascade = false;

  constructor(@Inject(DB) db: Db) {
    super(db);
  }

  protected buildJunctionRow(bookId: number, entityId: number) {
    return { bookId, narratorId: entityId, displayOrder: 0 };
  }

  override async browse(params: BrowseParams): Promise<BrowseResult> {
    const result = await super.browse(params);
    const ids = result.items.map((item) => item.id as number);
    if (ids.length === 0) return result;

    const sortNames = await this.db
      .select({ id: narrators.id, sortName: narrators.sortName })
      .from(narrators)
      .where(sql`${narrators.id} IN (${sql.raw(ids.join(','))})`);

    const sortNameMap = new Map(sortNames.map((r) => [r.id, r.sortName]));
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, sortName: sortNameMap.get(item.id as number) ?? null })),
    };
  }

  override async getBookTitles(id: number | string, limit: number, scope?: EntityBookScope): Promise<string[]> {
    const rows = await this.db
      .select({ title: sql<string>`COALESCE(${bookMetadata.title}, 'Untitled')` })
      .from(bookNarrators)
      .innerJoin(books, eq(books.id, bookNarrators.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(eq(bookNarrators.narratorId, id as number), ...(scope ? buildEntityBookScopeClauses(this.db, scope) : [])))
      .orderBy(asc(bookMetadata.title))
      .limit(limit);
    return rows.map((r) => r.title);
  }
}
