import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { INDEXER_ADAPTER_TYPES } from '@bookorbit/types';

import { requestIndexers } from './request-indexers';

const dialect = new PgDialect();

function toSql(value: Parameters<PgDialect['sqlToQuery']>[0]): string {
  return dialect.sqlToQuery(value).sql;
}

/**
 * The CHECK body is hand-written literal SQL. It is a slug pattern rather than a list, so what
 * this test guards is that every adapter type the code declares actually satisfies it, and that
 * the pattern still refuses anything that is not a slug.
 */
describe('request indexer schema SQL matches the shared constants', () => {
  const config = getTableConfig(requestIndexers);
  const check = config.checks.find((c) => c.name === 'request_indexers_adapter_type_chk');
  const pattern = /'(\^[^']+)'/.exec(toSql(check!.value))?.[1];
  const slug = new RegExp(pattern!);

  it('declares the constraint as a slug pattern', () => {
    expect(check).toBeDefined();
    expect(pattern).toBeDefined();
  });

  it('accepts every adapter type declared in @bookorbit/types', () => {
    for (const type of INDEXER_ADAPTER_TYPES) expect(slug.test(type)).toBe(true);
  });

  /**
   * A row whose adapter was removed from the build has to survive the upgrade. Deleting it would
   * throw away an encrypted credential the operator may still want, and the settings page can
   * only explain the row if the row is still there.
   */
  it('keeps a row whose adapter type is no longer built in', () => {
    expect(slug.test('mam')).toBe(true);
  });

  it('rejects anything that is not a slug', () => {
    for (const bad of ['', 'Torznab', 'tor znab', "tor'znab", '-leading', 'a'.repeat(31)]) {
      expect(slug.test(bad)).toBe(false);
    }
  });
});
