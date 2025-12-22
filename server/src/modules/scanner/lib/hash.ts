import { createHash } from 'crypto';
import { createReadStream } from 'fs';

/**
 * SHA-256 a file by streaming it — avoids loading large files into memory.
 * Only called when path and inode lookups both fail (cross-filesystem move).
 */
export function sha256File(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
