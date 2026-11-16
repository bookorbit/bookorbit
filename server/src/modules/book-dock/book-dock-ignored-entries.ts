import { relative, sep } from 'path';

/**
 * Folders and files that operating systems, NAS boxes and sync tools leave in a shared folder.
 * A recycle bin or a sync tool's version store holds real book files, so walking into one would
 * bring a deleted or superseded book back into the dock.
 */
const IGNORED_NAMES = new Set([
  '@eadir',
  '@recycle',
  '@recently-snapshot',
  '#recycle',
  '#snapshot',
  '$recycle.bin',
  'system volume information',
  'lost+found',
  'thumbs.db',
  'desktop.ini',
]);

/**
 * Dot-prefixed names cover macOS `._*` AppleDouble companions, which carry the book's own
 * extension, along with `.DS_Store`, `.Trash-*`, Syncthing's `.stfolder` and `.stversions`.
 */
export function isIgnoredDockEntryName(name: string): boolean {
  return name.startsWith('.') || IGNORED_NAMES.has(name.toLowerCase());
}

/** True when any segment of `path` below `root` is an ignored name. The root itself is never ignored. */
export function isIgnoredDockPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith('..')) return false;
  return rel.split(sep).some(isIgnoredDockEntryName);
}
