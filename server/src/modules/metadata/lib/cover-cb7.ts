import { readFile } from 'fs/promises';
import { getSevenZip } from '../../../common/sevenzip';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

export async function extractCb7Cover(absolutePath: string): Promise<Buffer | null> {
  try {
    const sz = await getSevenZip();
    const buf = await readFile(absolutePath);

    // Use a unique ID to avoid VFS path collisions between concurrent requests.
    const id = `cover_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const archPath = `/${id}`;
    const outDir = `/${id}_out`;

    const fd = sz.FS.open(archPath, 'w+');
    sz.FS.write(fd, buf, 0, buf.length);
    sz.FS.close(fd);

    try {
      sz.FS.mkdir(outDir);
    } catch {
      // already exists
    }

    sz.callMain(['e', archPath, `-o${outDir}`, '-y']);

    const files = sz.FS.readdir(outDir)
      .filter((f) => f !== '.' && f !== '..' && isImage(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const result = files.length > 0 ? Buffer.from(sz.FS.readFile(`${outDir}/${files[0]}`)) : null;

    // Clean up WASM VFS — cover extraction is a one-shot operation.
    try {
      for (const f of sz.FS.readdir(outDir).filter((f) => f !== '.' && f !== '..')) {
        sz.FS.unlink(`${outDir}/${f}`);
      }
      sz.FS.rmdir(outDir);
      sz.FS.unlink(archPath);
    } catch {
      // cleanup is best-effort
    }

    return result;
  } catch {
    return null;
  }
}
