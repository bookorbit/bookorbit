import type { SevenZipFS } from '../../../common/sevenzip';

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function pathBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Page order for a CB7 extracted with its folders kept. CB7 pages used to be extracted flat and
 * sorted by file name alone, and saved reading positions are page indexes into that order, so the
 * file name stays the primary key. The full path only separates pages that share a name, which the
 * flat extraction collapsed into one.
 */
export function compareComicPagePaths(a: string, b: string): number {
  return naturalCompare(pathBasename(a), pathBasename(b)) || naturalCompare(a, b);
}

function entryKind(fs: SevenZipFS, root: string, path: string): 'dir' | 'file' | null {
  try {
    const { mode } = fs.lstat(path);
    if (fs.isDir(mode)) return 'dir';
    if (fs.isFile(mode)) return 'file';
    if (!fs.isLink(mode)) return null;
    // 7-Zip already refuses to extract a link that points outside the output folder. Checking
    // the resolved target again keeps that true here, so a page can never read another file's
    // working tree in the shared WASM filesystem. Links to folders are never followed.
    const target = fs.lookupPath(path, { follow: true }).path;
    return target.startsWith(`${root}/`) && fs.isFile(fs.stat(target).mode) ? 'file' : null;
  } catch {
    return null;
  }
}

/** Every readable file under `root`, as paths relative to it. Nothing is read into our heap. */
export function listExtractedFiles(fs: SevenZipFS, root: string): string[] {
  const files: string[] = [];
  const dirs = [''];

  for (let i = 0; i < dirs.length; i++) {
    const relativeDir = dirs[i]!;
    let names: string[];
    try {
      names = fs.readdir(relativeDir ? `${root}/${relativeDir}` : root);
    } catch {
      continue;
    }

    for (const name of names) {
      if (name === '.' || name === '..') continue;
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
      const kind = entryKind(fs, root, `${root}/${relativePath}`);
      if (kind === 'dir') dirs.push(relativePath);
      else if (kind === 'file') files.push(relativePath);
    }
  }

  return files;
}

/** Best effort: a leftover tree only costs WASM memory, never a failed request. */
export function removeExtractedTree(fs: SevenZipFS, path: string): void {
  let names: string[];
  try {
    names = fs.readdir(path).filter((name) => name !== '.' && name !== '..');
  } catch {
    return;
  }

  for (const name of names) {
    const child = `${path}/${name}`;
    let isDir: boolean;
    try {
      isDir = fs.isDir(fs.lstat(child).mode);
    } catch {
      continue;
    }
    if (isDir) {
      removeExtractedTree(fs, child);
      continue;
    }
    try {
      fs.unlink(child);
    } catch {
      // Best effort, as above.
    }
  }

  try {
    fs.rmdir(path);
  } catch {
    // Already gone, or still holds an entry that could not be removed.
  }
}
