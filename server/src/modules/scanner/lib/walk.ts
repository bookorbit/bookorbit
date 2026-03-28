import { readdir, stat } from 'fs/promises';
import { basename, dirname, join, relative } from 'path';

import { classifyFile, isPrimaryFormat, isAudioFormat } from './classify';

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

// Matches common disc subdirectory names: "CD 1", "Disc 2", "Disk 3", "Part 2", "Side A"
const DISC_DIR_PATTERN = /^(?:cd|disc|disk|part|side)\s*[\dA-Za-z]+$/i;

function isDiscDirectory(name: string): boolean {
  return DISC_DIR_PATTERN.test(name);
}

// Returns the filename stem (basename without the last extension).
function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

// Natural sort: splits on numeric runs so "Chapter 10" sorts after "Chapter 9"
function naturalCompare(a: string, b: string): number {
  const re = /(\d+)/;
  const aParts = a.split(re);
  const bParts = b.split(re);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    if (/^\d+$/.test(ap) && /^\d+$/.test(bp)) {
      const diff = parseInt(ap, 10) - parseInt(bp, 10);
      if (diff !== 0) return diff;
    } else {
      const diff = ap.localeCompare(bp);
      if (diff !== 0) return diff;
    }
  }
  return 0;
}

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

  const subdirs: string[] = [];
  const filePaths: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.name.startsWith('.')) continue;
    if (excludePatterns.length > 0 && matchesExcludePattern(entry.name, excludePatterns)) continue;

    if (entry.isDirectory()) {
      subdirs.push(full);
    } else if (entry.isFile()) {
      if (full.length > MAX_PATH_LENGTH) {
        logger?.(`Path exceeds ${MAX_PATH_LENGTH} characters, skipping: ${full}`);
        continue;
      }
      filePaths.push(full);
    }
  }

  if (filePaths.length > 0) {
    const stats = await Promise.all(filePaths.map(async (full) => ({ full, s: await stat(full) })));
    for (const { full, s } of stats) {
      if (!acc.has(dir)) acc.set(dir, []);
      acc.get(dir)!.push({
        absolutePath: full,
        relPath: relative(libraryRoot, full),
        ino: s.ino,
        sizeBytes: s.size,
        mtime: s.mtime,
      });
    }
  }

  await Promise.all(subdirs.map((full) => collectByDir(full, libraryRoot, acc, excludePatterns, logger)));
}

/**
 * Walk a library folder and return book candidates.
 *
 * Rules:
 *  - Root-level primary file → its own BookCandidate (folderPath = absolutePath).
 *  - Disc subdirectories (e.g. "CD 1", "Disc 2") are flattened into their parent
 *    before any other grouping logic runs.
 *  - Subdirectory where any primary file is an audio format → one BookCandidate
 *    for the whole folder, files natural-sorted by basename.
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

  // Flatten disc subdirectories (e.g. "CD 1", "Disc 2") into their parent.
  // Collect disc dirs first to avoid mutating the map while iterating.
  const discDirs: string[] = [];
  for (const [dir] of byDir) {
    if (isDiscDirectory(basename(dir))) {
      discDirs.push(dir);
    }
  }
  for (const discDir of discDirs) {
    const files = byDir.get(discDir)!;
    const parent = dirname(discDir);
    if (!byDir.has(parent)) byDir.set(parent, []);
    byDir.get(parent)!.push(...files);
    byDir.delete(discDir);
  }

  // Stem-named subfolder flattening: if a subdirectory's name exactly matches the
  // stem of a sibling file in its parent, treat it as part of the parent book.
  // This handles the common pattern of ebooks alongside a same-named audio folder
  // (e.g. "Book.epub" + "Book/" containing mp3 tracks).
  // Skipped when the parent is the library root — root-level files are always
  // individual candidates and should not absorb subfolder content.
  const stemNamedDirs: string[] = [];
  for (const [dir] of byDir) {
    const parent = dirname(dir);
    if (parent === libraryFolderPath || !byDir.has(parent)) continue;
    const parentStems = new Set(byDir.get(parent)!.map((f) => stemOf(basename(f.absolutePath))));
    if (parentStems.has(basename(dir))) stemNamedDirs.push(dir);
  }
  for (const stemDir of stemNamedDirs) {
    const files = byDir.get(stemDir)!;
    const parent = dirname(stemDir);
    if (!byDir.has(parent)) byDir.set(parent, []);
    byDir.get(parent)!.push(...files);
    byDir.delete(stemDir);
  }

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

    // If any primary file is an audio format, treat the entire folder as one audiobook.
    // Files are natural-sorted by basename so playback order is deterministic.
    const hasAudio = primaryFiles.some((f) => {
      const { format } = classifyFile(f.absolutePath);
      return format !== null && isAudioFormat(format);
    });

    if (hasAudio) {
      const sorted = [...files].sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath)));
      candidates.push({ folderPath: dir, files: sorted });
      continue;
    }

    // One folder = one book. All formats and sidecar files belong to the same book.
    candidates.push({ folderPath: dir, files });
  }

  return candidates;
}

/**
 * Walk a library folder and return one BookCandidate per primary content file,
 * regardless of folder depth. Used when `organizationMode === 'book_per_file'`.
 *
 * Each candidate has:
 *   folderPath = absolutePath of the file  (the unique book key in the DB)
 *   files      = [that single file]
 *
 * Non-primary files (covers, sidecars, NFO, etc.) are intentionally excluded
 * because in this mode there is no unambiguous way to associate a sidecar with
 * a specific book without folder co-location.
 */
export async function findLooseFileCandidates(
  libraryFolderPath: string,
  excludePatterns: string[] = [],
  logger?: (msg: string) => void,
): Promise<BookCandidate[]> {
  const byDir = new Map<string, FileStat[]>();
  await collectByDir(libraryFolderPath, libraryFolderPath, byDir, excludePatterns, logger);

  const candidates: BookCandidate[] = [];

  for (const files of byDir.values()) {
    for (const fileStat of files) {
      if (isPrimaryFormat(fileStat.absolutePath)) {
        candidates.push({ folderPath: fileStat.absolutePath, files: [fileStat] });
      }
    }
  }

  return candidates;
}

/**
 * Build a single BookCandidate for a known book folder without treating it as a
 * library root. Reads only direct children of folderPath plus any disc subdirectories
 * (CD 1, Disc 2, etc.). Returns null if the folder is unreadable or has no primary files.
 *
 * This is used by targeted folder scans triggered by file-system events so that files
 * in the book folder are never misclassified as root-level loose-file books.
 */
export async function buildSingleBookCandidate(
  folderPath: string,
  libraryFolderPath: string,
  excludePatterns: string[] = [],
  logger?: (msg: string) => void,
): Promise<BookCandidate | null> {
  let entries;
  try {
    entries = await readdir(folderPath, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger?.(`Cannot read folder ${folderPath}: ${(err as Error).message}`);
    return null;
  }

  const filePaths: string[] = [];
  const discDirs: string[] = [];
  const nonDiscDirs: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (excludePatterns.length > 0 && matchesExcludePattern(entry.name, excludePatterns)) continue;
    const full = join(folderPath, entry.name);
    if (entry.isDirectory()) {
      if (isDiscDirectory(entry.name)) {
        discDirs.push(full);
      } else {
        nonDiscDirs.push({ name: entry.name, path: full });
      }
    } else if (entry.isFile() && full.length <= MAX_PATH_LENGTH) {
      filePaths.push(full);
    }
  }

  for (const discDir of discDirs) {
    const discEntries = await readdir(discDir, { withFileTypes: true }).catch(() => []);
    for (const entry of discEntries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const full = join(discDir, entry.name);
      if (full.length <= MAX_PATH_LENGTH) filePaths.push(full);
    }
  }

  if (filePaths.length === 0) return null;

  // Stem-named non-disc subdirectory flattening: same logic as findBookCandidates.
  // If a subdir's name matches the stem of a direct sibling file, include its files.
  const fileStems = new Set(filePaths.map((fp) => stemOf(basename(fp))));
  for (const { name, path: stemDir } of nonDiscDirs) {
    if (!fileStems.has(name)) continue;
    const stemEntries = await readdir(stemDir, { withFileTypes: true }).catch(() => []);
    for (const entry of stemEntries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const full = join(stemDir, entry.name);
      if (full.length <= MAX_PATH_LENGTH) filePaths.push(full);
    }
  }

  const stats = await Promise.all(
    filePaths.map(async (full) => {
      const s = await stat(full).catch(() => null);
      if (!s) return null;
      return { absolutePath: full, relPath: relative(libraryFolderPath, full), ino: s.ino, sizeBytes: s.size, mtime: s.mtime } satisfies FileStat;
    }),
  );

  const allFiles = stats.filter((f): f is FileStat => f !== null);
  if (!allFiles.some((f) => isPrimaryFormat(f.absolutePath))) return null;

  return {
    folderPath,
    files: allFiles.sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath))),
  };
}
