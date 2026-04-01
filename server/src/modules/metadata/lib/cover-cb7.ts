import { readFile } from 'fs/promises';
import { getSevenZip } from '../../../common/sevenzip';
import { isArchiveImageFile } from './archive-image-utils';
import { cleanupSevenZipArtifacts, createSevenZipTempId, type SevenZipInstance } from './sevenzip-vfs';

export async function extractCb7Cover(absolutePath: string): Promise<Buffer | null> {
  let sz: SevenZipInstance | null = null;
  let archivePath: string | null = null;
  let outDir: string | null = null;

  try {
    sz = await getSevenZip();
    const buf = await readFile(absolutePath);

    // Use a unique ID to avoid VFS path collisions between concurrent requests.
    const id = createSevenZipTempId('cover');
    archivePath = `/${id}`;
    outDir = `/${id}_out`;

    const fd = sz.FS.open(archivePath, 'w+');
    sz.FS.write(fd, buf, 0, buf.length);
    sz.FS.close(fd);

    try {
      sz.FS.mkdir(outDir);
    } catch {
      // already exists
    }

    sz.callMain(['e', archivePath, `-o${outDir}`, '-y']);

    const files = sz.FS.readdir(outDir)
      .filter((f) => f !== '.' && f !== '..' && isArchiveImageFile(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const result = files.length > 0 ? Buffer.from(sz.FS.readFile(`${outDir}/${files[0]}`)) : null;
    return result;
  } catch {
    return null;
  } finally {
    if (sz && archivePath && outDir) {
      cleanupSevenZipArtifacts(sz, archivePath, outDir);
    }
  }
}
