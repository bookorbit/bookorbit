import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  annotations,
  bookmarks,
  readerDefaultPreferences,
  readerPreferences,
  readingProgress,
  readingSessions,
  userReadingDailyStats,
} from './reader';

const fkByColumn = (table: unknown) => {
  const config = getTableConfig(table as never);
  return new Map(
    config.foreignKeys.map((fk) => [
      fk
        .reference()
        .columns.map((col) => col.name)
        .join(','),
      fk,
    ]),
  );
};

describe('reader schema', () => {
  it('uses a composite primary key for reading progress and indexes by user', () => {
    const config = getTableConfig(readingProgress);
    const pkColumns = config.primaryKeys.map((pk) => pk.columns.map((col) => col.name));
    const indexNames = config.indexes.map((idx) => idx.config.name);

    expect(pkColumns).toContainEqual(['book_file_id', 'user_id']);
    expect(indexNames).toContain('reading_progress_user_id_idx');
    expect(readingProgress.percentage.default).toBe(0);
    expect(readingProgress.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);
  });

  it('stores reading sessions with idempotency and time indexes', () => {
    const config = getTableConfig(readingSessions);
    const uniqueIndexes = config.indexes.filter((idx) => idx.config.unique);
    const indexNames = config.indexes.map((idx) => idx.config.name);
    const fkMap = fkByColumn(readingSessions);

    expect(uniqueIndexes.some((idx) => idx.config.name === 'rs_user_session_id_uidx')).toBe(true);
    expect(indexNames).toContain('rs_user_started_at_idx');
    expect(indexNames).toContain('rs_book_file_started_at_idx');
    expect(indexNames).toContain('rs_user_book_file_idx');
    expect(fkMap.get('user_id')?.onDelete).toBe('cascade');
    expect(fkMap.get('book_file_id')?.onDelete).toBe('cascade');
  });

  it('stores user daily reading aggregates keyed by user, library, and day', () => {
    const config = getTableConfig(userReadingDailyStats);
    const pkColumns = config.primaryKeys.map((pk) => pk.columns.map((col) => col.name));
    const indexNames = config.indexes.map((idx) => idx.config.name);
    const fkMap = fkByColumn(userReadingDailyStats);

    expect(pkColumns).toContainEqual(['user_id', 'library_id', 'day']);
    expect(indexNames).toContain('urds_user_day_idx');
    expect(indexNames).not.toContain('urds_user_library_day_idx');
    expect(fkMap.get('user_id')?.onDelete).toBe('cascade');
    expect(fkMap.get('library_id')?.onDelete).toBe('cascade');
    expect(userReadingDailyStats.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);
  });

  it('enforces cascade deletes and bookmark uniqueness by logical location', () => {
    const bookmarkFks = fkByColumn(bookmarks);
    const annotationFks = fkByColumn(annotations);
    const bookmarkConfig = getTableConfig(bookmarks);
    const bookmarkIndexNames = bookmarkConfig.indexes.map((idx) => idx.config.name);

    expect(bookmarkFks.get('user_id')?.onDelete).toBe('cascade');
    expect(bookmarkFks.get('book_id')?.onDelete).toBe('cascade');
    expect(bookmarkIndexNames).toContain('bookmarks_user_book_idx');
    expect(bookmarkIndexNames).toContain('bookmarks_user_book_cfi_uidx');
    expect(bookmarkIndexNames).toContain('bookmarks_user_book_pos_uidx');
    expect(annotationFks.get('user_id')?.onDelete).toBe('cascade');
    expect(annotationFks.get('book_id')?.onDelete).toBe('cascade');
    expect(annotations.color.default).toBe('yellow');
    expect(annotations.style.default).toBe('highlight');
  });

  it('keeps reader preference uniqueness scoped to user and format/file', () => {
    const defaultConfig = getTableConfig(readerDefaultPreferences);
    const perBookConfig = getTableConfig(readerPreferences);

    const defaultUniqueIndex = defaultConfig.indexes.find((idx) => idx.config.name === 'rdp_user_format_idx');
    const perBookUniqueIndex = perBookConfig.indexes.find((idx) => idx.config.name === 'rp_user_file_idx');

    expect(defaultUniqueIndex?.config.unique).toBe(true);
    expect(defaultUniqueIndex?.config.columns.map((col) => col.name)).toEqual(['user_id', 'format_group']);
    expect(perBookUniqueIndex?.config.unique).toBe(true);
    expect(perBookUniqueIndex?.config.columns.map((col) => col.name)).toEqual(['user_id', 'book_file_id']);
  });
});
