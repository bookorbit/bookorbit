import { readdir, stat } from 'fs/promises';
import { join } from 'path';

import { findPreferredBookCoverFileName } from '../../../common/book-cover-storage';

export const COVER_DISK_CONCURRENCY = 16;

function isMissingEntry(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Book ids that own a directory under the covers root. Non-numeric entries are ignored. */
export async function readCoverDirBookIds(coversRoot: string): Promise<Set<number>> {
  let entries;
  try {
    entries = await readdir(coversRoot, { withFileTypes: true });
  } catch (err) {
    if (isMissingEntry(err)) return new Set();
    throw err;
  }
  const ids = new Set<number>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d+$/.test(entry.name)) continue;
    const id = Number(entry.name);
    if (Number.isSafeInteger(id)) ids.add(id);
  }
  return ids;
}

/**
 * Mirrors how a cover is actually served: a directory only counts when it holds a file
 * `findPreferredBookCoverFileName` would pick. A thumbnail on its own does not count.
 */
export async function hasServableCover(coversRoot: string, bookId: number): Promise<boolean> {
  try {
    const files = await readdir(join(coversRoot, String(bookId)));
    return findPreferredBookCoverFileName(files) !== null;
  } catch (err) {
    if (isMissingEntry(err)) return false;
    throw err;
  }
}

export async function measureCoverDir(coversRoot: string, bookId: number): Promise<{ fileCount: number; sizeBytes: number }> {
  const dir = join(coversRoot, String(bookId));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if (isMissingEntry(err)) return { fileCount: 0, sizeBytes: 0 };
    throw err;
  }
  let sizeBytes = 0;
  for (const file of files) {
    try {
      const stats = await stat(join(dir, file));
      if (stats.isFile()) sizeBytes += stats.size;
    } catch (err) {
      if (!isMissingEntry(err)) throw err;
    }
  }
  return { fileCount: files.length, sizeBytes };
}

/** Chunked fan-out; keeps open file handles bounded on libraries with tens of thousands of covers. */
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  fn: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...(await Promise.all(items.slice(index, index + concurrency).map(fn))));
  }
  return results;
}
