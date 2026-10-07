import { createHash } from 'crypto';
import { open } from 'fs/promises';
import type { FileHandle } from 'fs/promises';

const BASE = 1024;
const BLOCK_SIZE = 1024;

/**
 * Partial MD5 fingerprint matching KOReader's util.partialMD5 algorithm.
 * Reads 1 KB blocks from positions 0, 1 KB, 4 KB, 16 KB, … up to 1 GB.
 * The loop starts at i=-1 so that `BASE << (2 * -1)` overflows 32-bit to 0,
 * producing the same byte sequence KOReader uses for its document hash.
 */
export async function computeFileHash(absolutePath: string): Promise<string> {
  const fh = await open(absolutePath, 'r');
  try {
    return await computeFileHashFromHandle(fh);
  } finally {
    await fh.close();
  }
}

export async function computeFileHashFromHandle(fh: FileHandle): Promise<string> {
  const { size } = await fh.stat();
  const hash = createHash('md5');
  const buf = Buffer.allocUnsafe(BLOCK_SIZE);

  for (let i = -1; i <= 10; i++) {
    const position = BASE << (2 * i); // BASE << -2 overflows 32-bit to 0 when i = -1
    if (position >= size) break;
    const { bytesRead } = await fh.read(buf, 0, BLOCK_SIZE, position);
    if (bytesRead > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  }

  return hash.digest('hex');
}
