import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;
type AuthorSortKeyExecutor = Pick<Db, 'execute'>;

function uniqueSafeIds(ids: number[]): number[] {
  return [...new Set(ids)].filter((id) => Number.isSafeInteger(id));
}

function intArray(ids: number[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::int[]`;
}

const primaryAuthorSortKeySql = sql`
  SELECT NULLIF(btrim(COALESCE(a.sort_name, a.name)), '')
  FROM book_authors ba
  INNER JOIN authors a ON a.id = ba.author_id
  WHERE ba.book_id = b.id
  ORDER BY ba.display_order ASC, ba.author_id ASC
  LIMIT 1
`;

export async function refreshPrimaryAuthorSortNamesForBooks(executor: AuthorSortKeyExecutor, bookIds: number[]): Promise<number> {
  const ids = uniqueSafeIds(bookIds);
  if (ids.length === 0) return 0;

  const result = await executor.execute(sql`
    UPDATE books b
    SET primary_author_sort_name = (${primaryAuthorSortKeySql})
    WHERE b.id = ANY(${intArray(ids)})
  `);
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export async function refreshPrimaryAuthorSortNamesForAuthors(executor: AuthorSortKeyExecutor, authorIds: number[]): Promise<number> {
  const ids = uniqueSafeIds(authorIds);
  if (ids.length === 0) return 0;

  const result = await executor.execute(sql`
    UPDATE books b
    SET primary_author_sort_name = (${primaryAuthorSortKeySql})
    WHERE EXISTS (
      SELECT 1
      FROM book_authors ba
      WHERE ba.book_id = b.id
        AND ba.author_id = ANY(${intArray(ids)})
    )
  `);
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export async function hasMissingPrimaryAuthorSortNames(executor: AuthorSortKeyExecutor): Promise<boolean> {
  const result = await executor.execute<{ found: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM books b
      WHERE b.primary_author_sort_name IS NULL
        AND EXISTS (
          SELECT 1
          FROM book_authors ba
          WHERE ba.book_id = b.id
        )
      LIMIT 1
    ) AS found
  `);
  return Boolean(result.rows[0]?.found);
}

export async function refreshMissingPrimaryAuthorSortNames(executor: AuthorSortKeyExecutor): Promise<number> {
  const result = await executor.execute(sql`
    UPDATE books b
    SET primary_author_sort_name = (${primaryAuthorSortKeySql})
    WHERE b.primary_author_sort_name IS NULL
      AND EXISTS (
        SELECT 1
        FROM book_authors ba
        WHERE ba.book_id = b.id
      )
  `);
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}
