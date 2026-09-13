import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { ACTIVE_BOOK_REQUEST_STATUSES, BOOK_REQUEST_MEDIA_KINDS, BOOK_REQUEST_STATUSES } from '@bookorbit/types';

import { bookRequests } from './book-requests';

const dialect = new PgDialect();

function toSql(value: Parameters<PgDialect['sqlToQuery']>[0]): string {
  return dialect.sqlToQuery(value).sql;
}

/**
 * The CHECK body and the partial index predicate are hand-written literal SQL, because both need
 * literals and `sql.raw()` cannot run at import time here (see the note in `book-requests.ts`).
 * These tests are what stop that hand-written SQL drifting away from the shared constants.
 */
describe('book_requests status SQL matches the shared constants', () => {
  const config = getTableConfig(bookRequests);

  it('accepts exactly the statuses declared in @bookorbit/types', () => {
    const check = config.checks.find((c) => c.name === 'book_requests_status_chk');
    expect(check).toBeDefined();

    const quoted = [...toSql(check!.value).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(quoted.sort()).toEqual([...BOOK_REQUEST_STATUSES].sort());
  });

  it('scopes the dedupe unique index to exactly the active statuses', () => {
    const index = config.indexes.find((i) => i.config.name === 'book_requests_active_dedupe_key_uidx');
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);

    const predicate = index!.config.where;
    expect(predicate).toBeDefined();

    const quoted = [...toSql(predicate!).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(quoted.sort()).toEqual([...ACTIVE_BOOK_REQUEST_STATUSES].sort());
  });

  it('keeps every active status inside the full status set', () => {
    for (const status of ACTIVE_BOOK_REQUEST_STATUSES) {
      expect(BOOK_REQUEST_STATUSES).toContain(status);
    }
  });

  it('leaves settled statuses out of the active set, so a book can be requested again', () => {
    for (const status of ['rejected', 'cancelled', 'available', 'failed'] as const) {
      expect(ACTIVE_BOOK_REQUEST_STATUSES).not.toContain(status);
    }
  });

  it('declares the media kind enum from the shared constant', () => {
    expect(config.columns.find((c) => c.name === 'media_kind')?.enumValues).toEqual([...BOOK_REQUEST_MEDIA_KINDS]);
  });
});
