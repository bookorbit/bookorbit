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

// Recursively collect files, grouped by their parent directory.
async function collectByDir(dir: string, libraryRoot: string, acc: Map<string, FileStat[]>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      await collectByDir(full, libraryRoot, acc);
    } else if (entry.isFile()) {
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
export async function findBookCandidates(libraryFolderPath: string): Promise<BookCandidate[]> {
  const byDir = new Map<string, FileStat[]>();
  await collectByDir(libraryFolderPath, libraryFolderPath, byDir);

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

    // Group primary files by stem — same stem = same book in multiple formats.
    const stemGroups = new Map<string, FileStat[]>();
    for (const f of primaryFiles) {
      const stem = stemOf(f.absolutePath);
      if (!stemGroups.has(stem)) stemGroups.set(stem, []);
      stemGroups.get(stem)!.push(f);
    }

    if (stemGroups.size === 1) {
      // Single logical book: directory is the book.
      candidates.push({ folderPath: dir, files });
    } else {
      // Multiple books sharing a folder (series folder pattern).
      const nonPrimary = files.filter((f) => !isPrimaryFormat(f.absolutePath));
      for (const [stem, stemPrimaries] of stemGroups) {
        const sidecar = nonPrimary.filter((f) => stemOf(f.absolutePath) === stem);
        candidates.push({
          folderPath: join(dir, stem), // virtual unique key, not a real path
          files: [...stemPrimaries, ...sidecar],
        });
      }
    }
  }

  return candidates;
}
