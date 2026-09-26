import { PgDialect } from 'drizzle-orm/pg-core';

import { ReaderPreferencesRepository } from './reader-preferences.repository';

const dialect = new PgDialect();

/**
 * A patch has to merge inside one statement. These tests render the statement the repository
 * builds, because "does the stored row keep the keys nobody sent" is a property of the SQL, not of
 * anything a mocked call argument can show.
 */
function makeDb() {
  const captured: { values?: unknown; conflictSet?: unknown; deleteWhere?: unknown } = {};

  const insertChain = {
    values: vi.fn((value: unknown) => {
      captured.values = value;
      return insertChain;
    }),
    onConflictDoUpdate: vi.fn((config: { set: unknown }) => {
      captured.conflictSet = config.set;
      return Promise.resolve();
    }),
  };

  const deleteChain = {
    where: vi.fn((where: unknown) => {
      captured.deleteWhere = where;
      return Promise.resolve();
    }),
  };

  const db = {
    insert: vi.fn(() => insertChain),
    delete: vi.fn(() => deleteChain),
  };

  return { db, captured, insertChain, deleteChain };
}

function render(fragment: unknown) {
  return dialect.sqlToQuery(fragment as never);
}

describe('ReaderPreferencesRepository', () => {
  describe('patchDefault', () => {
    it('merges the patch over the stored row instead of replacing it', async () => {
      const { db, captured } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchDefault(4, 'epub', { fontSize: 16, isDark: false }, { isDark: true });

      const onConflict = render((captured.conflictSet as { settings: unknown }).settings);
      expect(onConflict.sql).toBe('($1::jsonb || "reader_default_preferences"."settings") || $2::jsonb');
      expect(onConflict.params).toEqual([JSON.stringify({ fontSize: 16, isDark: false }), JSON.stringify({ isDark: true })]);
    });

    it('seeds a brand new row from the built-in defaults plus the patch, so it stays a full object', async () => {
      const { db, captured } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchDefault(4, 'epub', { fontSize: 16, isDark: false }, { isDark: true });

      const insert = render((captured.values as { settings: unknown }).settings);
      expect(insert.sql).toBe('$1::jsonb || $2::jsonb');
      expect(insert.params).toEqual([JSON.stringify({ fontSize: 16, isDark: false }), JSON.stringify({ isDark: true })]);
    });
  });

  describe('patchPreference', () => {
    it('removes the unset keys and merges the set keys in one statement', async () => {
      const { db, captured } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchPreference(4, 88, { isDark: true }, ['themeName', 'lineHeight']);

      const onConflict = render((captured.conflictSet as { settings: unknown }).settings);
      expect(onConflict.sql).toBe('("reader_preferences"."settings" - ARRAY[$1, $2]::text[]) || $3::jsonb');
      expect(onConflict.params).toEqual(['themeName', 'lineHeight', JSON.stringify({ isDark: true })]);
    });

    it('keeps an empty unset list valid rather than dropping the operator', async () => {
      const { db, captured } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchPreference(4, 88, { isDark: true }, []);

      const onConflict = render((captured.conflictSet as { settings: unknown }).settings);
      expect(onConflict.sql).toBe('("reader_preferences"."settings" - ARRAY[]::text[]) || $1::jsonb');
    });

    it('never strips nulls, because a null fontFamily is a value', async () => {
      const { db, captured } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchPreference(4, 88, { fontFamily: null }, []);

      const onConflict = render((captured.conflictSet as { settings: unknown }).settings);
      expect(onConflict.sql).not.toContain('jsonb_strip_nulls');
      expect(onConflict.params).toContain(JSON.stringify({ fontFamily: null }));
    });

    it('deletes the row once its last key is unset', async () => {
      const { db, captured, deleteChain } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchPreference(4, 88, {}, ['isDark']);

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(deleteChain.where).toHaveBeenCalledTimes(1);
      expect(render(captured.deleteWhere).sql).toContain(`"reader_preferences"."settings" = '{}'::jsonb`);
    });

    it('reads nothing before writing, so a concurrent patch cannot lose a field', async () => {
      const { db } = makeDb();
      const repo = new ReaderPreferencesRepository(db as never);

      await repo.patchPreference(4, 88, { isDark: true }, ['themeName']);

      expect(db).not.toHaveProperty('select');
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });
});
