/**
 * What retiring a duplicate `book_files` row does with every column that references
 * `book_files.id`, keyed `table.column`. Deleting the row outright would cascade readers' sessions,
 * progress and KOReader state, so `retireFile` moves them to the copy that stays first. The guard
 * test fails when the schema gains a foreign key to `book_files` without an entry here.
 *
 * - `repoint`: rows move to the surviving file.
 * - `newer-wins`: one row per user (or device) on each file; the newer survives on the surviving file.
 * - `survivor-wins`: the surviving file's row is kept, the loser's moves only when the survivor has none.
 * - `drop`: the loser's rows are derived data and are deleted.
 * - `primary`: the book's primary file moves to the survivor.
 */
export type BookFileRetireRuleKind = 'repoint' | 'newer-wins' | 'survivor-wins' | 'drop' | 'primary';

export const BOOK_FILE_RETIRE_RULES: Readonly<Record<string, BookFileRetireRuleKind>> = {
  'books.primary_file_id': 'primary',
  'reading_progress.book_file_id': 'newer-wins',
  'reading_sessions.book_file_id': 'repoint',
  'audiobook_progress.current_file_id': 'repoint',
  'reader_preferences.book_file_id': 'survivor-wins',
  'tts_reading_position.book_file_id': 'newer-wins',
  'annotation_positions.book_file_id': 'survivor-wins',
  'bookmarks.book_file_id': 'repoint',
  'koreader_book_hash_links.book_file_id': 'survivor-wins',
  'koreader_device_progress.book_file_id': 'newer-wins',
  'koreader_page_stats.book_file_id': 'survivor-wins',
  'koreader_progress_resets.book_file_id': 'newer-wins',
  'koreader_session_tombstones.book_file_id': 'survivor-wins',
  'book_file_chapters.book_file_id': 'drop',
  'book_file_hash_history.book_file_id': 'repoint',
  'delivery_artifacts.book_file_id': 'drop',
  'delivery_inspections.book_file_id': 'drop',
  'email_send_log.book_file_id': 'repoint',
  'file_write_log.book_file_id': 'repoint',
  'kobo_device_deliveries.source_file_id': 'drop',
  'read_aloud_jobs.output_file_id': 'repoint',
  'read_aloud_jobs.replace_file_id': 'repoint',
};
