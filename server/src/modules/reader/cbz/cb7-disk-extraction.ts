import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve, sep } from 'path';
import { createSevenZipTempId, getSevenZip } from '../../../common/sevenzip';
import { compareComicPagePaths, listExtractedFiles, pathBasename } from './cb7-extraction';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

export interface ExtractedCb7 {
  dir: string;
  pages: string[];
  sizeBytes: number;
}

export function cb7PagePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('CB7 page escaped its extraction directory');
  return path;
}

export async function removeCb7Extraction(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function extractCb7ToDisk(filePath: string): Promise<ExtractedCb7> {
  const sevenZip = await getSevenZip();
  const outputDir = await mkdtemp(join(tmpdir(), 'bookorbit-cb7-'));
  const mountId = createSevenZipTempId('comic');
  const inputMount = `/${mountId}_input`;
  const outputMount = `/${mountId}_output`;
  let inputMounted = false;
  let outputMounted = false;

  try {
    sevenZip.FS.mkdir(inputMount);
    sevenZip.FS.mkdir(outputMount);
    sevenZip.FS.mount(sevenZip.FS.filesystems.NODEFS, { root: dirname(filePath) }, inputMount);
    inputMounted = true;
    sevenZip.FS.mount(sevenZip.FS.filesystems.NODEFS, { root: outputDir }, outputMount);
    outputMounted = true;

    sevenZip.callMain(['x', `${inputMount}/${basename(filePath)}`, `-o${outputMount}`, '-y']);

    const extractedFiles = listExtractedFiles(sevenZip.FS, outputMount);
    const sizeBytes = extractedFiles.reduce((total, path) => total + sevenZip.FS.lstat(`${outputMount}/${path}`).size, 0);
    const pages = extractedFiles
      .filter((path) => {
        const name = pathBasename(path);
        return isImage(name) && !name.startsWith('.');
      })
      .sort(compareComicPagePaths);

    return { dir: outputDir, pages, sizeBytes };
  } catch (error) {
    await removeCb7Extraction(outputDir);
    throw error;
  } finally {
    if (outputMounted) {
      try {
        sevenZip.FS.unmount(outputMount);
      } catch (error) {
        void error;
      }
    }
    if (inputMounted) {
      try {
        sevenZip.FS.unmount(inputMount);
      } catch (error) {
        void error;
      }
    }
    try {
      sevenZip.FS.rmdir(outputMount);
    } catch (error) {
      void error;
    }
    try {
      sevenZip.FS.rmdir(inputMount);
    } catch (error) {
      void error;
    }
  }
}
