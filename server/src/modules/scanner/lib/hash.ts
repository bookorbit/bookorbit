import { createHash } from 'crypto';
import { open } from 'fs/promises';

const BASE = 1024;
const BLOCK_SIZE = 1024;

/**
 * Partial MD5 fingerprint — reads 1 KB blocks from exponentially spaced positions
 * (1 KB, 4 KB, 16 KB, … up to 1 GB) rather than the entire file.
 * Used only when path and inode lookups both fail (cross-filesystem move detection).
 */
export async function fingerprintFile(absolutePath: string): Promise<string> {
  const fh = await open(absolutePath, 'r');
  try {
    const { size } = await fh.stat();
    const hash = createHash('md5');
    const buf = Buffer.allocUnsafe(BLOCK_SIZE);

    for (let i = 0; i <= 10; i++) {
      const position = BASE << (2 * i);
      if (position >= size) break;
      const { bytesRead } = await fh.read(buf, 0, BLOCK_SIZE, position);
      if (bytesRead > 0) hash.update(buf.subarray(0, bytesRead));
    }

    return hash.digest('hex');
  } finally {
    await fh.close();
  }
}
