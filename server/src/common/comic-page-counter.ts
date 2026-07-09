import { readFile } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';

import { detectComicContainerFormat, type ComicContainerFormat } from './comic-format-detect';
import { isHiddenPage, isImagePage } from './comic-page-utils';
import { readCbzZipIndex } from './cbz-zip-reader';
import { getSevenZip, type SevenZipFS } from './sevenzip';

// Buffer.buffer is a shared pool; slice out only the bytes for this buffer.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function countCbzPages(absolutePath: string): Promise<number> {
  const index = await readCbzZipIndex(absolutePath);
  if (!index) return 0;
  return index.entries.filter(
    (entry) =>
      !entry.name.endsWith('/') &&
      !isHiddenPage(entry.name) &&
      isImagePage(entry.name) &&
      (entry.compression === 0 || entry.compression === 8) &&
      entry.compressedSize > 0,
  ).length;
}

async function countCbrPages(absolutePath: string): Promise<number> {
  const buf = await readFile(absolutePath);
  const extractor = await createExtractorFromData({ data: toArrayBuffer(buf) });
  const { fileHeaders } = extractor.getFileList();
  let count = 0;
  for (const h of fileHeaders) {
    if (!h.flags.directory && isImagePage(h.name) && !isHiddenPage(h.name)) count++;
  }
  return count;
}

// Recursively counts image-page entries under `dir`, skipping hidden directories
// (e.g. __MACOSX) entirely rather than just filtering their files by name.
function countImagePagesRecursive(fs: SevenZipFS, dir: string): number {
  let count = 0;
  for (const name of fs.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const path = `${dir}/${name}`;
    if (fs.isDir(fs.stat(path).mode)) {
      if (!isHiddenPage(name)) count += countImagePagesRecursive(fs, path);
    } else if (isImagePage(name) && !isHiddenPage(name)) {
      count++;
    }
  }
  return count;
}

// Mirrors countImagePagesRecursive's traversal to remove everything under `dir`.
function removeRecursive(fs: SevenZipFS, dir: string): void {
  for (const name of fs.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const path = `${dir}/${name}`;
    if (fs.isDir(fs.stat(path).mode)) {
      removeRecursive(fs, path);
      fs.rmdir(path);
    } else {
      fs.unlink(path);
    }
  }
}

async function countCb7Pages(fileId: number, absolutePath: string): Promise<number> {
  const sz = await getSevenZip();
  const archivePath = `/count${fileId}`;
  const outDir = `/countOut${fileId}`;

  const buf = await readFile(absolutePath);
  const fd = sz.FS.open(archivePath, 'w+');
  sz.FS.write(fd, buf, 0, buf.length);
  sz.FS.close(fd);

  try {
    sz.FS.mkdir(outDir);
  } catch {
    // already exists from a previous run
  }

  try {
    // `x` preserves the archive's directory structure, unlike `e` (which flattens
    // everything into outDir and can collide same-named files from different
    // subdirectories, or miscount extracted dot-directory entries as pages).
    sz.callMain(['x', archivePath, `-o${outDir}`, '-y']);
    return countImagePagesRecursive(sz.FS, outDir);
  } finally {
    sz.FS.unlink(archivePath);
    removeRecursive(sz.FS, outDir);
    sz.FS.rmdir(outDir);
  }
}

/**
 * Counts streamable image pages in a comic archive. Used to lazily populate
 * `bookFiles.pageCount` for OPDS-PSE, independent of `CbzService` so callers
 * that only hold an `OpdsRequestUser` (not a full `RequestUser`) can use it.
 */
export async function countComicPages(fileId: number, absolutePath: string, storedFormat: ComicContainerFormat): Promise<number> {
  const format = await detectComicContainerFormat(absolutePath, storedFormat);
  if (format === 'cbz') return countCbzPages(absolutePath);
  if (format === 'cbr') return countCbrPages(absolutePath);
  return countCb7Pages(fileId, absolutePath);
}
