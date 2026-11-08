import { sep } from 'path';

/** A library folder as the scanner sees it: one root of one library. */
export interface LibraryRoot {
  id: number;
  libraryId: number;
  path: string;
}

/*
 * Overlapping library folders are refused now, but libraries made before that can still have one
 * folder inside another, or two folders on one path. A file belongs to one book in one library, so
 * every path needs exactly one owner: the deepest folder that contains it, and of two folders on the
 * same path, the older one.
 */

function isStrictlyInside(path: string, root: string): boolean {
  return path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Whether `a` owns what lies under both folders. */
function outranks(a: LibraryRoot, b: LibraryRoot): boolean {
  return isStrictlyInside(a.path, b.path) || (a.path === b.path && a.id < b.id);
}

export function owningRoot(path: string, roots: readonly LibraryRoot[]): LibraryRoot | null {
  let owner: LibraryRoot | null = null;
  for (const root of roots) {
    if (path !== root.path && !isStrictlyInside(path, root.path)) continue;
    if (!owner || outranks(root, owner)) owner = root;
  }
  return owner;
}

/** Directories a walk of `folder` must leave to the folders that own them. Holds `folder.path` itself when an older folder shares it. */
export function directoriesOwnedElsewhere(folder: LibraryRoot, roots: readonly LibraryRoot[]): Set<string> {
  const owned = new Set<string>();
  for (const root of roots) {
    if (root.id !== folder.id && outranks(root, folder)) owned.add(root.path);
  }
  return owned;
}

/** Folders whose books lying under `folder` belong to `folder` instead. */
export function foldersYieldingTo(folder: LibraryRoot, roots: readonly LibraryRoot[]): LibraryRoot[] {
  return roots.filter((root) => root.id !== folder.id && outranks(folder, root));
}
