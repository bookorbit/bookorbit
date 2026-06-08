import { readdir, stat } from 'fs/promises';
import { basename, dirname, join, relative } from 'path';

import { classifyFile, isPrimaryFormat, isAudioFormat, type FileRole } from './classify';

const JS_NUMBER_MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Convert a raw filesystem inode (bigint from stat with { bigint: true }) to a number
 * that can be matched safely in JavaScript.
 *
 * Any inode above Number.MAX_SAFE_INTEGER cannot be represented exactly as a JS number,
 * so we clamp it to 0. Value 0 is the existing sentinel meaning "rename detection
 * disabled for this file".
 */
export function clampIno(ino: bigint): number {
  if (ino < 0n || ino > JS_NUMBER_MAX_SAFE_INTEGER) return 0;
  return Number(ino);
}

export interface FileStat {
  absolutePath: string;
  relPath: string; // relative to library folder root
  ino: number;
  sizeBytes: number;
  mtime: Date;
  format: string | null;
  role: FileRole;
}

export interface BookCandidate {
  folderPath: string; // absolute path — unique key for a book in the DB
  files: FileStat[]; // all files in this folder
}

export interface WalkResult {
  candidates: BookCandidate[];
  skippedDirs: Set<string>;
  unchangedDirs: Set<string>;
  dirMtimes: Map<string, number>;
}

const MAX_PATH_LENGTH = 4096;
const DIR_CONCURRENCY_LIMIT = 50;

// Matches common disc subdirectory names: "CD 1", "Disc 2", "Disk03", "Part A", "Side IV"
// but avoids broad matches like "Discography".
const DISC_DIR_PATTERN = /^(?:cd|disc|disk|part|pt|side)(?:[\s_-]*(?:\d+|[A-Za-z]|[IVXLCM]+))$/i;

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

function buildExcludeMatcher(patterns: string[]): (name: string) => boolean {
  if (patterns.length === 0) return () => false;
  const compiled = patterns.map((p) => {
    if (!p.includes('*')) return { literal: p, regex: null as RegExp | null };
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return { literal: null as string | null, regex: new RegExp(`^${escaped}$`) };
  });
  return (name: string) => {
    for (const { literal, regex } of compiled) {
      if (literal !== null ? name === literal : regex!.test(name)) return true;
    }
    return false;
  };
}

async function statFilesIntoAcc(
  filePaths: string[],
  dir: string,
  libraryRoot: string,
  acc: Map<string, FileStat[]>,
  logger?: (msg: string) => void,
): Promise<void> {
  const statResults = await Promise.all(
    filePaths.map(async (full) => {
      const s = await stat(full, { bigint: true }).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      return s ? { full, s } : null;
    }),
  );
  for (const entry of statResults) {
    if (!entry) continue;
    const { full, s } = entry;
    const ino = clampIno(s.ino);
    if (s.ino === 0n) {
      logger?.(`File has inode 0 (likely network mount), rename detection disabled: ${full}`);
    } else if (ino === 0) {
      logger?.(`File inode cannot be represented safely for matching (inode ${s.ino}), rename detection disabled: ${full}`);
    }
    if (!acc.has(dir)) acc.set(dir, []);
    const { format, role } = classifyFile(full);
    acc.get(dir)!.push({
      absolutePath: full,
      relPath: relative(libraryRoot, full),
      ino,
      sizeBytes: Number(s.size),
      mtime: s.mtime,
      format,
      role,
    });
  }
}

// Recursively collect files, grouped by their parent directory.
async function collectByDir(
  dir: string,
  libraryRoot: string,
  acc: Map<string, FileStat[]>,
  shouldExclude: (name: string) => boolean,
  skippedDirs: Set<string>,
  logger?: (msg: string) => void,
  knownDirMtimes?: Map<string, number>,
  unchangedDirs?: Set<string>,
  dirMtimes?: Map<string, number>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      logger?.(`Permission denied reading folder, skipping: ${dir}`);
      skippedDirs.add(dir);
      return;
    }
    throw err;
  }

  // Record this directory's mtime for incremental scan state
  if (dirMtimes) {
    try {
      const dirStat = await stat(dir);
      dirMtimes.set(dir, Math.round(dirStat.mtimeMs));
    } catch {
      // Dir was readable (readdir succeeded) but stat failed - unusual, just skip mtime tracking
    }
  }

  const subdirs: string[] = [];
  const filePaths: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.name.startsWith('.')) continue;
    if (shouldExclude(entry.name)) continue;

    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      subdirs.push(full);
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      if (full.length > MAX_PATH_LENGTH) {
        logger?.(`Path exceeds ${MAX_PATH_LENGTH} characters, skipping: ${full}`);
        continue;
      }
      filePaths.push(full);
    }
  }

  // Leaf-level mtime skip: if this dir has files, check if its mtime is unchanged.
  // Safety rules:
  // 1. Never skip disc dirs (they get flattened into parent)
  // 2. Never skip dirs with disc subdirs (flattening merges disc files into parent,
  //    so parent must always have its own files scanned for a complete candidate)
  // 3. Never skip non-root dirs if parent dir's mtime changed (parent may have new files
  //    that turn this dir into a stem-named subdir needing flattening).
  //    Root is exempt: root-level files are never stem-merged into a parent (see
  //    buildBookCandidates: parent === libraryFolderPath is explicitly skipped).
  const hasDiscSubdirs = subdirs.some((s) => isDiscDirectory(basename(s)));
  const canSkip = knownDirMtimes && unchangedDirs && dirMtimes && filePaths.length > 0 && !isDiscDirectory(basename(dir)) && !hasDiscSubdirs;

  if (canSkip) {
    // For non-root dirs, also require parent mtime to be unchanged (guards stem-named merging).
    // Root has no library parent, so this check is skipped — root-level files are never
    // stem-merged and the stem-flattening loop explicitly skips root children.
    let parentChanged = false;
    if (dir !== libraryRoot) {
      const parentDir = dirname(dir);
      const parentStoredMtime = knownDirMtimes!.get(parentDir);
      const parentCurrentMtime = dirMtimes!.get(parentDir);
      parentChanged = parentStoredMtime === undefined || parentCurrentMtime === undefined || parentStoredMtime !== parentCurrentMtime;
    }

    const storedMtime = knownDirMtimes!.get(dir);
    const currentMtime = dirMtimes!.get(dir);
    if (!parentChanged && storedMtime !== undefined && currentMtime !== undefined && storedMtime === currentMtime) {
      unchangedDirs!.add(dir);
    } else {
      await statFilesIntoAcc(filePaths, dir, libraryRoot, acc, logger);
    }
  } else {
    if (filePaths.length > 0) {
      await statFilesIntoAcc(filePaths, dir, libraryRoot, acc, logger);
    }
  }

  // Bounded concurrency: process subdirs in chunks to avoid EMFILE
  for (let i = 0; i < subdirs.length; i += DIR_CONCURRENCY_LIMIT) {
    const chunk = subdirs.slice(i, i + DIR_CONCURRENCY_LIMIT);
    await Promise.all(
      chunk.map((full) => collectByDir(full, libraryRoot, acc, shouldExclude, skippedDirs, logger, knownDirMtimes, unchangedDirs, dirMtimes)),
    );
  }
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
  knownDirMtimes?: Map<string, number>,
): Promise<WalkResult> {
  const byDir = new Map<string, FileStat[]>();
  const shouldExclude = buildExcludeMatcher(excludePatterns);
  const skippedDirs = new Set<string>();
  const unchangedDirs = new Set<string>();
  const dirMtimes = new Map<string, number>();
  await collectByDir(libraryFolderPath, libraryFolderPath, byDir, shouldExclude, skippedDirs, logger, knownDirMtimes, unchangedDirs, dirMtimes);

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
      // Root-level: each primary file is its own book. Sidecar files (non-primary)
      // are grouped with their primary by matching stem (e.g. book.epub + book.opf + book.jpg).
      const sidecarsByStem = new Map<string, FileStat[]>();
      for (const file of files) {
        if (isPrimaryFormat(file.absolutePath)) continue;
        const stem = stemOf(basename(file.absolutePath));
        const existing = sidecarsByStem.get(stem);
        if (existing) existing.push(file);
        else sidecarsByStem.set(stem, [file]);
      }
      for (const file of primaryFiles) {
        const stem = stemOf(basename(file.absolutePath));
        const sidecars = sidecarsByStem.get(stem) ?? [];
        sidecarsByStem.delete(stem);
        candidates.push({ folderPath: file.absolutePath, files: [file, ...sidecars] });
      }
      continue;
    }

    // If any primary file is an audio format, treat the entire folder as one audiobook.
    // Files are natural-sorted by basename so playback order is deterministic.
    const hasAudio = primaryFiles.some((f) => {
      return f.format !== null && f.format !== undefined && isAudioFormat(f.format);
    });

    if (hasAudio) {
      const sorted = [...files].sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath)));
      candidates.push({ folderPath: dir, files: sorted });
      continue;
    }

    // One folder = one book. All formats and sidecar files belong to the same book.
    candidates.push({ folderPath: dir, files });
  }

  return { candidates, skippedDirs, unchangedDirs, dirMtimes };
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
  knownDirMtimes?: Map<string, number>,
): Promise<WalkResult> {
  const byDir = new Map<string, FileStat[]>();
  const shouldExclude = buildExcludeMatcher(excludePatterns);
  const skippedDirs = new Set<string>();
  const unchangedDirs = new Set<string>();
  const dirMtimes = new Map<string, number>();
  await collectByDir(libraryFolderPath, libraryFolderPath, byDir, shouldExclude, skippedDirs, logger, knownDirMtimes, unchangedDirs, dirMtimes);

  const candidates: BookCandidate[] = [];

  for (const files of byDir.values()) {
    for (const fileStat of files) {
      if (isPrimaryFormat(fileStat.absolutePath)) {
        candidates.push({ folderPath: fileStat.absolutePath, files: [fileStat] });
      }
    }
  }

  return { candidates, skippedDirs, unchangedDirs, dirMtimes };
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

  const shouldExclude = buildExcludeMatcher(excludePatterns);
  const filePaths: string[] = [];
  const discDirs: string[] = [];
  const nonDiscDirs: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (shouldExclude(entry.name)) continue;
    const full = join(folderPath, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (isDiscDirectory(entry.name)) {
        discDirs.push(full);
      } else {
        nonDiscDirs.push({ name: entry.name, path: full });
      }
    } else if (entry.isFile() && !entry.isSymbolicLink() && full.length <= MAX_PATH_LENGTH) {
      filePaths.push(full);
    }
  }

  for (const discDir of discDirs) {
    const discEntries = await readdir(discDir, { withFileTypes: true }).catch(() => []);
    for (const entry of discEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      if (shouldExclude(entry.name)) continue;
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
      if (shouldExclude(entry.name)) continue;
      const full = join(stemDir, entry.name);
      if (full.length <= MAX_PATH_LENGTH) filePaths.push(full);
    }
  }

  const stats = await Promise.all(
    filePaths.map(async (full) => {
      const s = await stat(full, { bigint: true }).catch(() => null);
      if (!s) return null;
      const { format, role } = classifyFile(full);
      const ino = clampIno(s.ino);
      if (s.ino !== 0n && ino === 0) {
        logger?.(`File inode cannot be represented safely for matching (inode ${s.ino}), rename detection disabled: ${full}`);
      }
      return {
        absolutePath: full,
        relPath: relative(libraryFolderPath, full),
        ino,
        sizeBytes: Number(s.size),
        mtime: s.mtime,
        format,
        role,
      } satisfies FileStat;
    }),
  );

  const allFiles = stats.filter((f): f is FileStat => f !== null);
  if (!allFiles.some((f) => isPrimaryFormat(f.absolutePath))) return null;

  return {
    folderPath,
    files: allFiles.sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath))),
  };
}
