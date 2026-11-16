import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { BOOK_DOCK_HOLD_REASONS } from '@bookorbit/types';

import { bookDockFiles } from './book-dock';
import { libraryDocks } from './library-docks';

const dialect = new PgDialect();

function quotedLiterals(value: Parameters<PgDialect['sqlToQuery']>[0]): string[] {
  return [...dialect.sqlToQuery(value).sql.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/**
 * The CHECK bodies are literal SQL, so these tests are what stop them drifting from the shared
 * constants a client reads.
 */
describe('library dock schema SQL matches the shared constants', () => {
  it('accepts exactly the hold reasons declared in @bookorbit/types', () => {
    const check = getTableConfig(bookDockFiles).checks.find((c) => c.name === 'book_dock_files_hold_reason_chk');
    expect(check).toBeDefined();
    expect(quotedLiterals(check!.value).sort()).toEqual([...BOOK_DOCK_HOLD_REASONS].sort());
  });

  it('accepts exactly the three metadata modes for a dock override', () => {
    const check = getTableConfig(libraryDocks).checks.find((c) => c.name === 'library_docks_auto_finalize_metadata_mode_chk');
    expect(check).toBeDefined();
    expect(quotedLiterals(check!.value).sort()).toEqual(['embedded_only', 'fetched_only', 'safe_merge']);
  });
});
