import { randomBytes } from 'crypto';
import type { Dirent } from 'fs';
import { link, lstat, readdir, rename, rmdir, unlink, writeFile } from 'fs/promises';
import { extname, join, sep } from 'path';

import type { LibraryDockFiling } from '@bookorbit/types';

import { isIgnoredDockEntryName } from './book-dock-ignored-entries';
import { isLibrariesDirName, isReservedRootName, LIBRARIES_DIR } from './library-dock-paths';

/** How far `(2)`, `(3)` and so on go before a move gives up on finding a free name. */
const MAX_NAME_ATTEMPTS = 1000;

/** Errors a hard link raises on filesystems or shares that do not support one. */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EXDEV']);

/** Files an operating system writes into any folder a person opens. They never hold a book. */
export function isFolderMetadataJunk(name: string): boolean {
  const lower = name.toLowerCase();
  return name === '.DS_Store' || name.startsWith('._') || lower === 'thumbs.db' || lower === 'desktop.ini';
}

export function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** The `_libraries` folder in the dock root, matched ignoring case, preferring the exact spelling. */
export async function findLibrariesDir(root: string): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const folders = entries.filter((entry) => entry.isDirectory() && isLibrariesDirName(entry.name));
  const exact = folders.find((entry) => entry.name === LIBRARIES_DIR) ?? folders[0];
  return exact ? join(root, exact.name) : null;
}

export interface LibrariesListing {
  folders: string[];
  files: string[];
  filesTruncated: boolean;
}

/** What sits directly in `_libraries`, without clutter. Files are capped; folders are all listed. */
export async function listLibrariesDir(librariesPath: string | null, maxFiles: number): Promise<LibrariesListing> {
  const listing: LibrariesListing = { folders: [], files: [], filesTruncated: false };
  if (!librariesPath) return listing;
  let entries: Dirent[];
  try {
    entries = await readdir(librariesPath, { withFileTypes: true });
  } catch {
    return listing;
  }
  for (const entry of entries) {
    if (isIgnoredDockEntryName(entry.name)) continue;
    if (entry.isDirectory()) listing.folders.push(entry.name);
    else if (entry.isFile()) {
      if (listing.files.length < maxFiles) listing.files.push(entry.name);
      else listing.filesTruncated = true;
    }
  }
  listing.folders.sort((a, b) => a.localeCompare(b));
  listing.files.sort((a, b) => a.localeCompare(b));
  return listing;
}

/**
 * Moves `source` into `directory` under `name`, or `name (2)` and so on when that is taken, and
 * never over anything already there. Names the dock root reserves for itself are skipped. Returns
 * the path it landed at.
 */
export async function moveWithoutOverwrite(source: string, directory: string, name: string, isDirectory: boolean): Promise<string> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const candidate = numberedName(name, attempt, isDirectory);
    if (isReservedRootName(candidate)) continue;
    const destination = join(directory, candidate);
    if (await pathExists(destination)) continue;
    if (isDirectory) {
      try {
        await rename(source, destination);
        return destination;
      } catch (error) {
        // Another folder appeared at that name first; a non-empty one refuses the rename.
        if (errnoCode(error) === 'ENOTEMPTY' || errnoCode(error) === 'EEXIST') continue;
        throw error;
      }
    }
    // A hard link fails when the name is taken, where a rename would replace the file there.
    try {
      await link(source, destination);
    } catch (error) {
      const code = errnoCode(error);
      if (code === 'EEXIST') continue;
      if (!code || !LINK_UNSUPPORTED.has(code)) throw error;
      await rename(source, destination);
      return destination;
    }
    await unlink(source);
    return destination;
  }
  throw new Error(`No free name for ${name} after ${MAX_NAME_ATTEMPTS} attempts`);
}

/**
 * Removes a folder that holds nothing but operating-system clutter, clutter first. Returns the
 * number of other entries when it is not empty, and leaves it untouched.
 */
export async function removeFolderIfEmpty(path: string): Promise<{ removed: boolean; remaining: number }> {
  const entries = await readdir(path, { withFileTypes: true });
  const junk = entries.filter((entry) => entry.isFile() && isFolderMetadataJunk(entry.name));
  const remaining = entries.length - junk.length;
  if (remaining > 0) return { removed: false, remaining };
  for (const entry of junk) await unlink(join(path, entry.name));
  try {
    await rmdir(path);
  } catch (error) {
    if (errnoCode(error) === 'ENOTEMPTY' || errnoCode(error) === 'EEXIST') return { removed: false, remaining: 1 };
    throw error;
  }
  return { removed: true, remaining: 0 };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Whether `inner` is `outer` or sits somewhere inside it. */
export function isSameOrInside(inner: string, outer: string): boolean {
  if (inner === outer) return true;
  const prefix = outer.endsWith(sep) ? outer : `${outer}${sep}`;
  return inner.startsWith(prefix);
}

/**
 * Whether filing takes a file from `sourceDir` to `targetDir` instantly or has to copy it. It tries
 * what filing does: a rename, or a hardlink when the dock keeps originals. Device ids cannot answer
 * this: two bind mounts of one filesystem share `st_dev`, yet a rename or link across them still
 * fails with EXDEV. So a throwaway file makes the trip and is removed again. Nothing can be tried
 * when either folder is missing or cannot be written.
 */
export async function probeFiling(
  sourceDir: string,
  targetDir: string,
  placement: 'rename' | 'link',
): Promise<{ filing: LibraryDockFiling; errorCode?: string }> {
  const probeName = `.bookorbit-filing-probe-${randomBytes(8).toString('hex')}`;
  const source = join(sourceDir, probeName);
  const target = join(targetDir, probeName);
  try {
    await writeFile(source, '', { flag: 'wx' });
  } catch (error) {
    return { filing: 'unknown', errorCode: errnoCode(error) };
  }
  let placed = false;
  try {
    await (placement === 'link' ? link(source, target) : rename(source, target));
    placed = true;
    return { filing: 'move' };
  } catch (error) {
    const code = errnoCode(error);
    const copies = placement === 'link' ? code !== undefined && LINK_UNSUPPORTED.has(code) : code === 'EXDEV';
    return { filing: copies ? 'copy' : 'unknown', errorCode: code };
  } finally {
    await unlink(source).catch(() => undefined);
    if (placed) await unlink(target).catch(() => undefined);
  }
}

function numberedName(name: string, attempt: number, isDirectory: boolean): string {
  if (attempt === 1) return name;
  const ext = isDirectory ? '' : extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem} (${attempt})${ext}`;
}
