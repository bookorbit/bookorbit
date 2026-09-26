import { readdir } from 'fs/promises';
import { join } from 'path';

/**
 * Generic recursive directory traversal shared by the book scanner and the podcast importer.
 *
 * Only the traversal itself lives here: what a directory's files *mean* differs per library type,
 * so each caller receives the entries through `visit` and does its own grouping. Behaviour that is
 * genuinely common stays here - dotfile and symlink skips, the path-length ceiling, tolerating an
 * unreadable directory instead of failing the whole walk, and bounding how many directories are
 * read at once so a deep tree cannot exhaust the file descriptor table.
 */

export const WALK_MAX_PATH_LENGTH = 4096;
export const WALK_DIR_CONCURRENCY_LIMIT = 50;

export interface WalkedDirectory {
  /** Absolute path of the directory being visited. */
  path: string;
  /** Absolute paths of its regular, non-symlink, non-excluded files. */
  filePaths: string[];
  /** Absolute paths of the subdirectories the walk is about to descend into. */
  subdirectoryPaths: string[];
}

export type WalkSkippedEntryReason = 'symlink' | 'path_too_long';

export interface WalkDirectoryTreeOptions {
  /** Called for every readable directory, parents before children. */
  visit: (directory: WalkedDirectory) => Promise<void> | void;
  shouldExclude?: (name: string) => boolean;
  logger?: (message: string) => void;
  /** Entries the walk refused to hand to `visit`, for callers that have to account for them. */
  onSkippedEntry?: (entry: { path: string; reason: WalkSkippedEntryReason }) => void;
  maxPathLength?: number;
  concurrencyLimit?: number;
}

export interface WalkDirectoryTreeResult {
  /** Directories that could not be read because of permissions. */
  skippedDirs: Set<string>;
}

/**
 * Compiles exclude patterns into a name matcher. A pattern without `*` matches the entry name
 * exactly; `*` is the only wildcard, and every other regex metacharacter is escaped.
 */
export function buildNameExcludeMatcher(patterns: string[]): (name: string) => boolean {
  if (patterns.length === 0) return () => false;
  const compiled = patterns.map((pattern) => {
    if (!pattern.includes('*')) return { literal: pattern, regex: null as RegExp | null };
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return { literal: null as string | null, regex: new RegExp(`^${escaped}$`) };
  });
  return (name: string) => {
    for (const { literal, regex } of compiled) {
      if (literal !== null ? name === literal : regex!.test(name)) return true;
    }
    return false;
  };
}

export async function walkDirectoryTree(root: string, options: WalkDirectoryTreeOptions): Promise<WalkDirectoryTreeResult> {
  const skippedDirs = new Set<string>();
  await collectDirectory(root, options, skippedDirs);
  return { skippedDirs };
}

async function collectDirectory(dir: string, options: WalkDirectoryTreeOptions, skippedDirs: Set<string>): Promise<void> {
  const maxPathLength = options.maxPathLength ?? WALK_MAX_PATH_LENGTH;
  const concurrencyLimit = options.concurrencyLimit ?? WALK_DIR_CONCURRENCY_LIMIT;
  const shouldExclude = options.shouldExclude ?? (() => false);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      options.logger?.(`Permission denied reading folder, skipping: ${dir}`);
      skippedDirs.add(dir);
      return;
    }
    throw err;
  }

  const subdirectoryPaths: string[] = [];
  const filePaths: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.name.startsWith('.')) continue;
    if (shouldExclude(entry.name)) continue;

    if (entry.isSymbolicLink()) {
      options.onSkippedEntry?.({ path: full, reason: 'symlink' });
      continue;
    }
    if (entry.isDirectory()) {
      subdirectoryPaths.push(full);
    } else if (entry.isFile()) {
      if (full.length > maxPathLength) {
        options.logger?.(`Path exceeds ${maxPathLength} characters, skipping: ${full}`);
        options.onSkippedEntry?.({ path: full, reason: 'path_too_long' });
        continue;
      }
      filePaths.push(full);
    }
  }

  // Parents are visited before children so a caller can carry state down the tree.
  await options.visit({ path: dir, filePaths, subdirectoryPaths });

  for (let index = 0; index < subdirectoryPaths.length; index += concurrencyLimit) {
    const chunk = subdirectoryPaths.slice(index, index + concurrencyLimit);
    await Promise.all(chunk.map((full) => collectDirectory(full, options, skippedDirs)));
  }
}
