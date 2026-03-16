import { readdir, stat } from 'fs/promises';
import { basename, join, relative } from 'path';

import { isPrimaryFormat } from './classify';

export interface FileStat {
  absolutePath: string;
  relPath: string; // relative to library folder root
  ino: number;
  sizeBytes: number;
  mtime: Date;
}

export interface BookCandidate {
  folderPath: string; // absolute path — unique key for a book in the DB
  files: FileStat[]; // all files in this folder
}

const MAX_PATH_LENGTH = 4096;

function matchesExcludePattern(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      if (name === pattern) return true;
    } else {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (new RegExp(`^${escaped}$`).test(name)) return true;
    }
  }
  return false;
}

// Recursively collect files, grouped by their parent directory.
async function collectByDir(
  dir: string,
  libraryRoot: string,
  acc: Map<string, FileStat[]>,
  excludePatterns: string[],
  logger?: (msg: string) => void,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      logger?.(`Permission denied reading folder, skipping: ${dir}`);
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.name.startsWith('.')) continue;
    if (excludePatterns.length > 0 && matchesExcludePattern(entry.name, excludePatterns)) continue;

    if (entry.isDirectory()) {
      await collectByDir(full, libraryRoot, acc, excludePatterns, logger);
    } else if (entry.isFile()) {
      if (full.length > MAX_PATH_LENGTH) {
        logger?.(`Path exceeds ${MAX_PATH_LENGTH} characters, skipping: ${full}`);
        continue;
      }

      const s = await stat(full);
      const fileInfo: FileStat = {
        absolutePath: full,
        relPath: relative(libraryRoot, full),
        ino: s.ino,
        sizeBytes: s.size,
        mtime: s.mtime,
      };

      if (!acc.has(dir)) acc.set(dir, []);
      acc.get(dir)!.push(fileInfo);
    }
  }
}

function stemOf(absolutePath: string): string {
  const name = basename(absolutePath);
  const dot = name.lastIndexOf('.');
  return dot !== -1 ? name.substring(0, dot) : name;
}

// Lowercase-only version used for grouping comparisons so that Book.epub and
// book.jpg pair correctly on case-sensitive filesystems, without changing the
// original stem used for the DB folderPath key.
function normStemOf(absolutePath: string): string {
  return stemOf(absolutePath).toLowerCase();
}

/**
 * Walk a library folder and return book candidates.
 *
 * Rules:
 *  - Root-level primary file → its own BookCandidate (folderPath = absolutePath).
 *  - Subdirectory where all primary files share the same stem
 *    (e.g. book.epub + book.mobi = same book in two formats) → one BookCandidate,
 *    folderPath = dir, files = everything in the dir.
 *  - Subdirectory with primary files of DIFFERENT stems (e.g. series folder with one
 *    epub per book) → one BookCandidate per stem, folderPath = join(dir, stem),
 *    files = primary files for that stem + any non-primary files with matching stem.
 *  - Directories with no primary files are skipped (author/grouping folders).
 */
export async function findBookCandidates(
  libraryFolderPath: string,
  excludePatterns: string[] = [],
  logger?: (msg: string) => void,
): Promise<BookCandidate[]> {
  const byDir = new Map<string, FileStat[]>();
  await collectByDir(libraryFolderPath, libraryFolderPath, byDir, excludePatterns, logger);

  const candidates: BookCandidate[] = [];

  for (const [dir, files] of byDir) {
    const primaryFiles = files.filter((f) => isPrimaryFormat(f.absolutePath));
    if (primaryFiles.length === 0) continue;

    if (dir === libraryFolderPath) {
      // Root-level: each primary file is its own book.
      for (const file of primaryFiles) {
        candidates.push({ folderPath: file.absolutePath, files: [file] });
      }
      continue;
    }

    // Group primary files by normalised stem so that Book.epub and book.mobi
    // are treated as the same book on case-sensitive filesystems. The original
    // stem (from the first primary found) is preserved for the folderPath key
    // so existing DB records are not invalidated.
    const stemGroups = new Map<string, { origStem: string; files: FileStat[] }>();
    for (const f of primaryFiles) {
      const norm = normStemOf(f.absolutePath);
      if (!stemGroups.has(norm)) {
        stemGroups.set(norm, { origStem: stemOf(f.absolutePath), files: [] });
      }
      stemGroups.get(norm)!.files.push(f);
    }

    if (stemGroups.size === 1) {
      // Single logical book: directory is the book.
      candidates.push({ folderPath: dir, files });
    } else {
      // Multiple books sharing a folder (series folder pattern).
      const nonPrimary = files.filter((f) => !isPrimaryFormat(f.absolutePath));
      for (const [normStem, { origStem, files: stemPrimaries }] of stemGroups) {
        const sidecar = nonPrimary.filter((f) => normStemOf(f.absolutePath) === normStem);
        candidates.push({
          folderPath: join(dir, origStem), // virtual unique key, not a real path
          files: [...stemPrimaries, ...sidecar],
        });
      }
    }
  }

  return candidates;
}
