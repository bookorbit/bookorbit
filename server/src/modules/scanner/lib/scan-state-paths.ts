import { dirname } from 'path';

/**
 * Returns every directory path whose incremental scan state must be invalidated
 * when a book living at `folderPath` is deleted: the folder path itself plus all
 * of its ancestors up to the filesystem root.
 *
 * `folderPath` is the book's on-disk folder for `book_per_folder` libraries, or
 * the primary file's absolute path for `book_per_file` libraries. Walking up via
 * `dirname()` covers both: folder paths invalidate themselves, file paths
 * invalidate their containing directory, and both reach every ancestor the
 * scanner records in `library_dir_scan_state`.
 *
 * Ancestors above the library root are harmless extras: they are never present in
 * `library_dir_scan_state`, so they simply match nothing on delete.
 */
export function scanStateInvalidationPaths(folderPath: string): string[] {
  const paths = new Set<string>([folderPath]);
  let current = dirname(folderPath);
  while (current !== dirname(current)) {
    paths.add(current);
    current = dirname(current);
  }
  return [...paths];
}
