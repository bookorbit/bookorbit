import { join, sep } from 'path';

/** The folder in the dock root that holds one folder per library dock. Matched ignoring case. */
export const LIBRARIES_DIR = '_libraries';

/** Where dock covers lived before they moved to app data. Rows from then still point into it. */
export const LEGACY_COVERS_DIR = 'covers';

/**
 * Where a path sits in the dock:
 * - `unsorted`: under the root, outside the reserved folders. `dockRoot` is the root.
 * - `dock`: inside `_libraries/<folderName>`, or that folder itself. `dockRoot` is the folder; it
 *   may be a library's dock, a folder no dock owns, or a loose file sitting directly in `_libraries`.
 * - `libraries`: the `_libraries` folder itself.
 * - `reserved`: the legacy covers folder or anything in it.
 * - `outside`: not under the root, or the root itself.
 *
 * `relParts` are the path's segments below `dockRoot`, so a unit folder is `relParts.length === 1`
 * and anything nested in one is longer.
 */
export type DockPathInfo =
  | { area: 'unsorted'; dockRoot: string; relParts: string[] }
  | { area: 'dock'; folderName: string; dockRoot: string; relParts: string[] }
  | { area: 'libraries'; path: string }
  | { area: 'reserved' }
  | { area: 'outside' };

export function isLibrariesDirName(name: string): boolean {
  return name.toLowerCase() === LIBRARIES_DIR;
}

/** Names the root reserves for itself. Unsorted never treats them as books. */
export function isReservedRootName(name: string): boolean {
  return name === LEGACY_COVERS_DIR || isLibrariesDirName(name);
}

export function classifyDockPath(root: string, path: string): DockPathInfo {
  if (!path.startsWith(root + sep)) return { area: 'outside' };
  const parts = path
    .substring(root.length + 1)
    .split(sep)
    .filter(Boolean);
  if (parts.length === 0) return { area: 'outside' };
  const [first, ...rest] = parts;
  if (first === LEGACY_COVERS_DIR) return { area: 'reserved' };
  if (!isLibrariesDirName(first)) return { area: 'unsorted', dockRoot: root, relParts: parts };
  const librariesPath = join(root, first);
  if (rest.length === 0) return { area: 'libraries', path: librariesPath };
  const [folderName, ...inside] = rest;
  return { area: 'dock', folderName, dockRoot: join(librariesPath, folderName), relParts: inside };
}

/** The unit folder a path belongs to: the first level under its dock root, when the path is deeper. */
export function unitDirectoryOf(info: DockPathInfo): string | null {
  if (info.area !== 'unsorted' && info.area !== 'dock') return null;
  if (info.relParts.length < 2) return null;
  return join(info.dockRoot, info.relParts[0]);
}
