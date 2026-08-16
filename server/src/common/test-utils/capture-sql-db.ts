import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from '../../db/schema';

export type CapturedQuery = { sql: string; params: unknown[] };

/**
 * Drizzle instance over a stub client that records the compiled SQL instead of running it.
 *
 * A hand-mocked `db` only sees the arguments a repository passes in, but column defaults and
 * `$onUpdateFn` columns are injected later, by the dialect. Timestamp behaviour is therefore
 * invisible to those mocks and has to be asserted against what Postgres would actually receive.
 */
export function createCapturingDb(): { db: ReturnType<typeof drizzle>; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const client = {
    query: (query: unknown, params?: unknown[]) => {
      const text = typeof query === 'string' ? query : ((query as { text?: string })?.text ?? '');
      queries.push({ sql: text, params: params ?? [] });
      return Promise.resolve({ rows: [], fields: [], rowCount: 0 });
    },
  };
  return { db: drizzle(client as never, { schema }), queries };
}
