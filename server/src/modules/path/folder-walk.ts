import type { Dirent } from 'fs';
import { lstat, readdir, realpath } from 'fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'path';

import { isAudioFormat, isPrimaryFormat } from '../scanner/lib/classify';
import { isDiscDirectory, stemOf } from '../scanner/lib/walk';

export const BLOCKED_PATHS = ['/proc', '/sys', '/dev', '/run', '/var/run', '/etc', '/root'];

/** Operating-system folders directly under `/`, hidden from the picker unless asked for. */
export const SYSTEM_FOLDERS = new Set([
  'app',
  'bin',
  'boot',
  'home',
  'lib',
  'lib32',
  'lib64',
  'libx32',
  'lost+found',
  'opt',
  'sbin',
  'snap',
  'srv',
  'tmp',
  'usr',
  'var',
  'Applications',
  'Library',
  'System',
  'Volumes',
  'cores',
  'private',
]);

export function isBlockedPath(path: string): boolean {
  return BLOCKED_PATHS.some((blocked) => path === blocked || path.startsWith(blocked + sep));
}

/** `path` with symlinks followed, or as given when it cannot be resolved (a missing folder). */
export async function realTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Blocked as typed or once symlinks are followed, so a link to `/etc` is refused like `/etc`. */
export async function isBlockedTarget(path: string): Promise<boolean> {
  return isBlockedPath(path) || isBlockedPath(await realTarget(path));
}

export function isInsideOrAt(path: string, parent: string): boolean {
  if (path === parent) return true;
  return parent === sep ? path.startsWith(sep) : path.startsWith(parent + sep);
}

/** A folder BookOrbit lists: a real directory, not hidden, not a symlink, not a blocked system path. */
export function isListableDirectory(entry: Dirent, fullPath: string): boolean {
  return entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !isBlockedPath(fullPath);
}

export interface WalkLimits {
  /** Directory entries to read before stopping; the result is then a lower bound. */
  maxEntries: number;
  /** Epoch milliseconds after which the walk stops. */
  deadline: number;
  /** Sum the size of every book file counted. */
  withSizes?: boolean;
  /** How many book files to return as samples, relative to the root. */
  samples?: number;
}

export interface WalkOutcome {
  state: 'ok' | 'denied' | 'missing';
  files: number;
  folderBooks: number;
  formats: Record<string, number>;
  folders: number;
  mergedFolders: number;
  splitAudioFolders: number;
  truncated: boolean;
  bytes: number;
  samples: string[];
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function stateForError(error: unknown): 'denied' | 'missing' {
  const code = errorCode(error);
  return code === 'EACCES' || code === 'EPERM' ? 'denied' : 'missing';
}

/** What one folder holds, as the scanner groups it. */
interface DirFiles {
  books: number;
  audio: number;
  /** Stems of the non-audio book files: several mean several titles. */
  bookStems: Set<string>;
  /** Stems of every file, sidecars included: a subfolder named after one folds into this folder. */
  stems: Set<string>;
}

function mergeInto(groups: Map<string, DirFiles>, from: string, to: string) {
  const source = groups.get(from)!;
  const target = groups.get(to);
  groups.delete(from);
  if (!target) {
    groups.set(to, source);
    return;
  }
  target.books += source.books;
  target.audio += source.audio;
  for (const stem of source.bookStems) target.bookStems.add(stem);
  for (const stem of source.stems) target.stems.add(stem);
}

/**
 * Counts what a library would import from `root` by the scanner's grouping rules
 * (`findBookCandidates`): every book file directly in the root is its own book; below it, Folder as
 * Book reads each folder holding book files as one book, after folding disc folders ("CD 1") and then
 * folders named after a sibling file into their parent. Depth-first in name order, so samples are stable.
 */
export async function walkFolder(root: string, limits: WalkLimits): Promise<WalkOutcome> {
  const outcome: WalkOutcome = {
    state: 'ok',
    files: 0,
    folderBooks: 0,
    formats: {},
    folders: 0,
    mergedFolders: 0,
    splitAudioFolders: 0,
    truncated: false,
    bytes: 0,
    samples: [],
  };
  const sampleLimit = limits.samples ?? 0;
  const groups = new Map<string, DirFiles>();
  const stack = [root];
  let entries = 0;

  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (entries >= limits.maxEntries || Date.now() > limits.deadline) {
      outcome.truncated = true;
      break;
    }

    let read: { entries: Dirent[]; cut: boolean };
    try {
      read = await readEntries(dir, limits.maxEntries - entries);
    } catch (error) {
      if (dir === root) {
        outcome.state = stateForError(error);
        return outcome;
      }
      // Books in a folder that cannot be opened are not counted, so the counts are a lower bound.
      outcome.truncated = true;
      continue;
    }
    const dirents = read.entries.sort(byName);
    entries += dirents.length;
    if (read.cut) outcome.truncated = true;

    const children: string[] = [];
    const bookFiles: string[] = [];
    const stems = new Set<string>();
    for (const entry of dirents) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (isListableDirectory(entry, full)) children.push(full);
      else if (entry.isFile()) {
        stems.add(stemOf(entry.name));
        if (isPrimaryFormat(full)) bookFiles.push(full);
      }
    }
    if (dir === root) outcome.folders = children.length;

    const group: DirFiles = { books: bookFiles.length, audio: 0, bookStems: new Set(), stems };
    for (const file of bookFiles) {
      const format = extname(file).slice(1).toLowerCase();
      outcome.files += 1;
      outcome.formats[format] = (outcome.formats[format] ?? 0) + 1;
      if (isAudioFormat(format)) group.audio += 1;
      else group.bookStems.add(stemOf(basename(file)));
      if (outcome.samples.length < sampleLimit) outcome.samples.push(relative(root, file).split(sep).join('/'));
      if (limits.withSizes && !outcome.truncated) {
        if (Date.now() > limits.deadline) {
          outcome.truncated = true;
          continue;
        }
        try {
          outcome.bytes += (await lstat(file)).size;
        } catch {
          // A file that vanished mid-walk adds nothing.
        }
      }
    }
    if (stems.size > 0) groups.set(dir, group);

    if (read.cut) break;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  // The scanner's two folding passes, in its order. The root never folds: its files are each a book.
  for (const dir of [...groups.keys()]) if (dir !== root && isDiscDirectory(basename(dir))) mergeInto(groups, dir, dirname(dir));
  const stemNamed = [...groups.keys()].filter((dir) => {
    const parent = dirname(dir);
    return dir !== root && parent !== root && !!groups.get(parent)?.stems.has(basename(dir));
  });
  for (const dir of stemNamed) if (groups.has(dir)) mergeInto(groups, dir, dirname(dir));

  for (const [dir, group] of groups) {
    if (group.books === 0) continue;
    if (dir === root) {
      outcome.folderBooks += group.books;
      continue;
    }
    outcome.folderBooks += 1;
    if (group.audio === 0 && group.bookStems.size > 1) outcome.mergedFolders += 1;
    if (group.audio > 1) outcome.splitAudioFolders += 1;
  }
  return outcome;
}

/** Whether `dir` holds at least one listable folder. */
export async function hasListableChild(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir, { withFileTypes: true })).some((entry) => isListableDirectory(entry, join(dir, entry.name)));
  } catch {
    return false;
  }
}

/**
 * The first `budget` entries of `dir` in name order. `readdir` rather than a streamed `opendir`: on
 * filesystems that do not report entry types (some NFS and FUSE mounts) `opendir` falls back to a
 * synchronous lstat per entry, which would stall the server for every user.
 */
async function readEntries(dir: string, budget: number): Promise<{ entries: Dirent[]; cut: boolean }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const limit = Math.max(0, budget);
  if (entries.length <= limit) return { entries, cut: false };
  return { entries: entries.sort(byName).slice(0, limit), cut: true };
}

/** Code-unit order: stable and cheap on folders of tens of thousands of entries. */
function byName(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Runs `task` over `items` with at most `limit` in flight, keeping the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
