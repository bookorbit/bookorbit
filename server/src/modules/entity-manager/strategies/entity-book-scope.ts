import { ForbiddenException } from '@nestjs/common';
import { inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import * as schema from '../../../db/schema';
import { books } from '../../../db/schema';
import type { EntityBookScope } from './entity-strategy.interface';

type Db = NodePgDatabase<typeof schema>;

export function buildEntityBookScopeClauses(db: Db, scope: EntityBookScope): SQL[] {
  if (scope.libraryIds.length === 0) return [sql`false`];

  return [inArray(books.libraryId, scope.libraryIds), ...(scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, db) : [])];
}

export async function assertEntityRelationsWithinLibraries(
  db: Db,
  relationTableName: string,
  relationEntityIdColumn: string,
  entityIds: number[],
  libraryIds: number[],
): Promise<void> {
  if (entityIds.length === 0) return;

  const relationTable = sql.raw(relationTableName);
  const relationEntityId = sql.raw(`scoped_relation.${relationEntityIdColumn}`);
  const relationBookId = sql.raw('scoped_relation.book_id');
  const entityIdList = sql.join(
    entityIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const outsideLibraryCondition =
    libraryIds.length > 0
      ? sql`${books.libraryId} NOT IN (${sql.join(
          libraryIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`true`;

  const result = await db.execute(sql`
    SELECT 1
    FROM ${relationTable} scoped_relation
    JOIN ${books} ON ${relationBookId} = ${books.id}
    WHERE ${relationEntityId} IN (${entityIdList})
      AND ${outsideLibraryCondition}
    LIMIT 1
  `);

  if (result.rows.length > 0) {
    throw new ForbiddenException('Entity is used by a library outside the accessible scope');
  }
}
