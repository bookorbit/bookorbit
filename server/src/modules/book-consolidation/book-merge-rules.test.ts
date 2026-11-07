import { BOOK_FILE_RETIRE_RULES } from './book-file-retire-rules';
import { BOOK_MERGE_RULES, BOOK_MERGE_SET_NULL_COLUMNS } from './book-merge-rules';
import { foreignKeysReferencing } from './schema-foreign-keys';

describe('book merge rule registry', () => {
  const bookForeignKeys = foreignKeysReferencing('books');

  it('has a rule for every foreign key that references books', () => {
    const missing = bookForeignKeys.map((foreignKey) => foreignKey.key).filter((key) => !(key in BOOK_MERGE_RULES));
    expect(missing).toEqual([]);
  });

  it('names no column that no longer references books', () => {
    const present = new Set(bookForeignKeys.map((foreignKey) => foreignKey.key));
    expect(Object.keys(BOOK_MERGE_RULES).filter((key) => !present.has(key))).toEqual([]);
  });

  it('covers the 59 single columns and the composite file key', () => {
    expect(bookForeignKeys).toHaveLength(60);
    expect(bookForeignKeys.filter((foreignKey) => foreignKey.key.includes('+'))).toEqual([
      { key: 'book_files.book_id+library_folder_id', onDelete: 'cascade' },
    ]);
  });

  it('leaves no set-null column to the delete', () => {
    const setNull = bookForeignKeys.filter((foreignKey) => foreignKey.onDelete === 'set null').map((foreignKey) => foreignKey.key);
    expect(setNull).toEqual([...BOOK_MERGE_SET_NULL_COLUMNS].sort((a, b) => a.localeCompare(b)));
    for (const key of setNull) {
      expect(['repoint', 'reconcile']).toContain(BOOK_MERGE_RULES[key]);
    }
  });
});

describe('book file retire rule registry', () => {
  const fileForeignKeys = foreignKeysReferencing('book_files');

  it('has a rule for every foreign key that references book_files, and none extra', () => {
    const keys = fileForeignKeys.map((foreignKey) => foreignKey.key);
    expect(keys.filter((key) => !(key in BOOK_FILE_RETIRE_RULES))).toEqual([]);
    expect(Object.keys(BOOK_FILE_RETIRE_RULES).filter((key) => !keys.includes(key))).toEqual([]);
    expect(keys).toHaveLength(22);
  });

  it('never drops reading time or a reader’s position', () => {
    for (const key of ['reading_sessions.book_file_id', 'reading_progress.book_file_id', 'audiobook_progress.current_file_id']) {
      expect(BOOK_FILE_RETIRE_RULES[key]).not.toBe('drop');
    }
  });
});
