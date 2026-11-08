/**
 * What a merge does with every column that references `books.id`, keyed `table.column` (a composite
 * key joins its columns with `+`). The guard test fails when the schema gains a foreign key to
 * `books` without an entry here, so no new table can silently lose a merged-away book's rows.
 *
 * - `reparent`: rows move to the kept book as part of the file plan.
 * - `repoint`: rows move to the kept book; collisions resolved by the rule's own key.
 * - `reconcile`: per-user rows combined by an explicit rule (reading history, progress, notes).
 * - `fill`: the kept book's value, or the source's when the kept book has none.
 * - `union`: both books' rows, de-duplicated.
 * - `follow-audio`: the book that owns the audio content decides.
 * - `follow-entitlement`: follows the Kobo entitlement rule.
 * - `drop`: the source's rows are deleted (cascade), never moved.
 * - `block-if-active`: an active row blocks the merge; finished rows cascade.
 * - `flatten`: aliases that pointed at the source now point at the kept book.
 */
export type BookMergeRuleKind =
  'reparent' | 'repoint' | 'reconcile' | 'fill' | 'union' | 'follow-audio' | 'follow-entitlement' | 'drop' | 'block-if-active' | 'flatten';

export const BOOK_MERGE_RULES: Readonly<Record<string, BookMergeRuleKind>> = {
  'book_files.book_id': 'reparent',
  'book_files.book_id+library_folder_id': 'reparent',

  'book_metadata.book_id': 'fill',
  'book_authors.book_id': 'fill',
  'book_narrators.book_id': 'follow-audio',
  'book_genres.book_id': 'union',
  'book_tags.book_id': 'union',
  'book_series_memberships.book_id': 'fill',
  'book_custom_metadata_values.book_id': 'fill',
  'comic_metadata.book_id': 'fill',
  'book_community_ratings.book_id': 'fill',
  'book_provider_ids.book_id': 'fill',
  'book_covers.book_id': 'fill',
  'book_chapter_versions.book_id': 'follow-audio',
  'audiobook_manifest_revisions.book_id': 'follow-audio',

  'reading_attempts.book_id': 'reconcile',
  'user_book_status.book_id': 'reconcile',
  'reading_sessions.book_id': 'repoint',
  'reading_session_sync_cursors.book_id': 'repoint',
  'audiobook_progress.book_id': 'follow-audio',
  'annotations.book_id': 'repoint',
  'bookmarks.book_id': 'repoint',
  'book_journal_entries.book_id': 'repoint',
  'user_book_notes.book_id': 'reconcile',
  'user_book_ratings.book_id': 'reconcile',
  'tts_book_preferences.book_id': 'fill',
  'story_edits.book_id': 'reconcile',
  'user_book_read_aloud_sync_settings.book_id': 'fill',
  'collection_books.book_id': 'repoint',

  'kobo_book_entitlements.book_id': 'follow-entitlement',
  'kobo_reading_states.book_id': 'follow-entitlement',
  'kobo_device_reading_states.book_id': 'follow-entitlement',
  'kobo_known_positions.book_id': 'follow-entitlement',
  'kobo_snapshot_books.book_id': 'follow-entitlement',
  'kobo_device_snapshot_books.book_id': 'follow-entitlement',
  'kobo_bookmark_links.book_id': 'follow-entitlement',
  'kobo_device_deliveries.book_id': 'drop',
  'kobo_annotation_serves.book_id': 'drop',

  'hardcover_book_state.book_id': 'reconcile',
  'storygraph_book_state.book_id': 'reconcile',

  'book_metadata_fetch_queue.book_id': 'block-if-active',
  'chapter_lookup_queue.book_id': 'block-if-active',
  'book_chapter_jobs.book_id': 'block-if-active',
  'read_aloud_jobs.book_id': 'block-if-active',
  'file_write_log.book_id': 'repoint',
  'email_send_log.book_id': 'repoint',
  'book_requests.matched_book_id': 'repoint',
  'book_requests.target_book_id': 'repoint',
  'upload_sessions.target_book_id': 'repoint',
  'upload_sessions.result_book_id': 'repoint',
  'book_duplicate_dismissals.book_id_a': 'repoint',
  'book_duplicate_dismissals.book_id_b': 'repoint',
  'book_duplicate_groups.root_book_id': 'drop',
  'book_duplicate_group_members.book_id': 'drop',
  'book_duplicate_pairs.book_id_a': 'drop',
  'book_duplicate_pairs.book_id_b': 'drop',
  'book_duplicate_scan_keys.book_id': 'drop',

  'book_links.book_id': 'repoint',
  'book_link_groups.lead_book_id': 'repoint',
  'book_merges.target_book_id': 'flatten',
};

/** Columns whose foreign key is ON DELETE SET NULL. Deleting the source would orphan them, so none may be left to the delete. */
export const BOOK_MERGE_SET_NULL_COLUMNS = [
  'book_requests.matched_book_id',
  'book_requests.target_book_id',
  'email_send_log.book_id',
  'upload_sessions.target_book_id',
  'upload_sessions.result_book_id',
  'reading_attempts.book_id',
  'book_link_groups.lead_book_id',
] as const;
