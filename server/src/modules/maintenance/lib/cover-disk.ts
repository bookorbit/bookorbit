import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { COVER_MEDIA, type CoverMedium } from '@bookorbit/types';

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
    const dir = join(coversRoot, String(bookId));
    const files = await readdir(dir, { withFileTypes: true });
    if (findPreferredBookCoverFileName(files.filter((entry) => entry.isFile()).map((entry) => entry.name)) !== null) return true;
    for (const medium of ['ebook', 'audio']) {
      const slotFiles = await readdir(join(dir, medium)).catch((error: unknown) => {
        if (isMissingEntry(error)) return [];
        throw error;
      });
      if (findPreferredBookCoverFileName(slotFiles) !== null) return true;
    }
    return false;
  } catch (err) {
    if (isMissingEntry(err)) return false;
    throw err;
  }
}

/** The slots, of those a book has rows for, whose folder holds no cover that would be served. */
export async function findBrokenCoverSlots(coversRoot: string, bookId: number, media: readonly CoverMedium[]): Promise<CoverMedium[]> {
  const broken: CoverMedium[] = [];
  for (const medium of media) {
    let files: string[];
    try {
      files = await readdir(join(coversRoot, String(bookId), medium));
    } catch (err) {
      if (!isMissingEntry(err)) throw err;
      files = [];
    }
    if (findPreferredBookCoverFileName(files) === null) broken.push(medium);
  }
  return broken;
}

export async function measureCoverDir(coversRoot: string, bookId: number): Promise<{ fileCount: number; sizeBytes: number; media: CoverMedium[] }> {
  const dir = join(coversRoot, String(bookId));
  let files;
  try {
    files = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissingEntry(err)) return { fileCount: 0, sizeBytes: 0, media: [] };
    throw err;
  }
  let sizeBytes = 0;
  let fileCount = 0;
  const media = COVER_MEDIA.filter((medium) => files.some((file) => file.isDirectory() && file.name === medium));
  for (const file of files) {
    try {
      if (file.isDirectory()) {
        const nested = await measureDirectory(join(dir, file.name));
        fileCount += nested.fileCount;
        sizeBytes += nested.sizeBytes;
      } else if (file.isFile()) {
        const stats = await stat(join(dir, file.name));
        fileCount++;
        sizeBytes += stats.size;
      }
    } catch (err) {
      if (!isMissingEntry(err)) throw err;
    }
  }
  return { fileCount, sizeBytes, media };
}

async function measureDirectory(dir: string): Promise<{ fileCount: number; sizeBytes: number }> {
  const entries = await readdir(dir, { withFileTypes: true });
  let fileCount = 0;
  let sizeBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await measureDirectory(join(dir, entry.name));
      fileCount += nested.fileCount;
      sizeBytes += nested.sizeBytes;
    } else if (entry.isFile()) {
      const info = await stat(join(dir, entry.name));
      fileCount++;
      sizeBytes += info.size;
    }
  }
  return { fileCount, sizeBytes };
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
