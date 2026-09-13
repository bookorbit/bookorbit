import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { BOOK_REQUEST_DOWNLOAD_SOURCES, BOOK_REQUEST_DOWNLOAD_STATUSES, DOWNLOAD_CLIENT_TYPES } from '@bookorbit/types';

import { bookRequestDownloads, downloadClients } from './download-clients';

const dialect = new PgDialect();

function toSql(value: Parameters<PgDialect['sqlToQuery']>[0]): string {
  return dialect.sqlToQuery(value).sql;
}

function quotedLiterals(sql: string): string[] {
  return [...sql.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/**
 * Same reasoning as `book-requests.schema.test.ts`: the CHECK bodies and the partial index
 * predicate are hand-written literal SQL, and these tests are what stop them drifting away from
 * the shared constants.
 */
describe('download client schema SQL matches the shared constants', () => {
  const clientConfig = getTableConfig(downloadClients);
  const downloadConfig = getTableConfig(bookRequestDownloads);

  it('accepts exactly the adapter types declared in @bookorbit/types', () => {
    const check = clientConfig.checks.find((c) => c.name === 'download_clients_adapter_type_chk');
    expect(check).toBeDefined();
    expect(quotedLiterals(toSql(check!.value)).sort()).toEqual([...DOWNLOAD_CLIENT_TYPES].sort());
  });

  it('accepts exactly the download statuses declared in @bookorbit/types', () => {
    const check = downloadConfig.checks.find((c) => c.name === 'book_request_downloads_status_chk');
    expect(check).toBeDefined();
    expect(quotedLiterals(toSql(check!.value)).sort()).toEqual([...BOOK_REQUEST_DOWNLOAD_STATUSES].sort());
  });

  it('accepts exactly the grab sources declared in @bookorbit/types', () => {
    const check = downloadConfig.checks.find((c) => c.name === 'book_request_downloads_source_chk');
    expect(check).toBeDefined();
    expect(quotedLiterals(toSql(check!.value)).sort()).toEqual([...BOOK_REQUEST_DOWNLOAD_SOURCES].sort());
  });

  it('scopes the one-live-attempt-per-hash index to every status whose bytes are still needed', () => {
    const index = downloadConfig.indexes.find((i) => i.config.name === 'book_request_downloads_active_hash_uidx');
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);

    // `needs_review` is in: those bytes are still on disk waiting for a person, and a second grab
    // of the same release URL would stage over them and then delete them on its way out.
    expect(quotedLiterals(toSql(index!.config.where!)).sort()).toEqual(['completed', 'downloading', 'importing', 'needs_review', 'queued']);
  });
});
