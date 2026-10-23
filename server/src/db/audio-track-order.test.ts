import { drizzle } from 'drizzle-orm/node-postgres';

import type { CapturedQuery } from '../common/test-utils/capture-sql-db';
import { realignAudioTrackOrder } from './audio-track-order';
import * as schema from './schema';

type FileRow = [id: number, absolutePath: string, format: string | null, sortOrder: number | null];

/** Records the SQL Postgres would receive and answers the read of the book's files with `files`. */
function createDb(files: FileRow[]) {
  const queries: CapturedQuery[] = [];
  const client = {
    query: (query: string | { text: string; values?: unknown[] }, params?: unknown[]) => {
      const text = typeof query === 'string' ? query : query.text;
      queries.push({ sql: text, params: params ?? (typeof query === 'string' ? [] : (query.values ?? [])) });
      const readsFiles = text.startsWith('select') && text.includes('from "book_files"');
      return Promise.resolve({ rows: readsFiles ? files : [], fields: [], rowCount: 0 });
    },
  };
  return { db: drizzle(client as never, { schema }), queries };
}

const folder = '/library/Andy Weir/Project Hail Mary (2021)';

describe('realignAudioTrackOrder', () => {
  it('locks the book before reading its files, so concurrent writers renumber one at a time', async () => {
    const { db, queries } = createDb([]);

    await realignAudioTrackOrder(db, 7);

    expect(queries[0]!.sql).toMatch(/^select .* from "books" where "books"\."id" = \$1 for update$/);
    expect(queries[0]!.params).toEqual([7]);
    expect(queries[1]!.sql).toMatch(/from "book_files" where "book_files"\."book_id" = \$1$/);
    expect(queries[1]!.params).toEqual([7]);
  });

  it('writes nothing while the tracks already play in path order', async () => {
    const { db, queries } = createDb([
      [1, `${folder}/cover.jpg`, 'jpg', 0],
      [2, `${folder}/Project Hail Mary (01).mp3`, 'mp3', 1],
      [3, `${folder}/Project Hail Mary (02).mp3`, 'mp3', 2],
    ]);

    await expect(realignAudioTrackOrder(db, 7)).resolves.toBe(0);
    expect(queries.some((query) => query.sql.startsWith('update'))).toBe(false);
  });

  it('renumbers out-of-order tracks of that book in one statement and marks them updated', async () => {
    const { db, queries } = createDb([
      [11, `${folder}/Project Hail Mary (01).mp3`, 'mp3', 7],
      [12, `${folder}/Project Hail Mary (02).mp3`, 'mp3', 8],
      [13, `${folder}/Project Hail Mary (03).mp3`, 'mp3', 0],
      [14, `${folder}/Project Hail Mary (04).mp3`, 'mp3', 1],
    ]);

    await expect(realignAudioTrackOrder(db, 7)).resolves.toBe(4);

    const updates = queries.filter((query) => query.sql.startsWith('update'));
    expect(updates).toHaveLength(1);
    const [update] = updates;
    expect(update!.sql).toContain('update "book_files" set "sort_order" = case "book_files"."id" when $1 then $2::integer');
    // The audiobook manifest revision hashes each file's updated_at, so players reload the new order.
    expect(update!.sql).toContain('"updated_at" =');
    expect(update!.sql).toMatch(/where \("book_files"\."book_id" = \$\d+ and "book_files"\."id" in \(\$\d+, \$\d+, \$\d+, \$\d+\)\)$/);
    expect(update!.params.slice(0, 8)).toEqual([11, 0, 12, 1, 13, 2, 14, 3]);
    expect(update!.params).toContain(7);
  });

  it('propagates a failed write so the caller rolls the whole transaction back', async () => {
    const failure = new Error('could not serialize access');
    const db = drizzle(
      {
        query: (query: string | { text: string }) =>
          (typeof query === 'string' ? query : query.text).startsWith('update')
            ? Promise.reject(failure)
            : Promise.resolve({
                rows: (typeof query === 'string' ? query : query.text).includes('from "book_files"')
                  ? [
                      [1, `${folder}/b.mp3`, 'mp3', 0],
                      [2, `${folder}/a.mp3`, 'mp3', 1],
                    ]
                  : [],
                fields: [],
                rowCount: 0,
              }),
      } as never,
      { schema },
    );

    await expect(realignAudioTrackOrder(db, 7)).rejects.toMatchObject({ cause: failure });
  });
});
