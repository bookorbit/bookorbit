import { createHash } from 'crypto';
import * as unzipper from 'unzipper';

/**
 * A digest of what a KEPUB holds, independent of how the archive is laid out. kepubify writes the same entries in a
 * different order on every run, so the archive's sha256 cannot tell a rebuild of the copy a device holds from a
 * different conversion; the entry names, sizes and CRCs can. Read from the central directory only.
 */
export async function kepubContentDigest(path: string): Promise<string> {
  const archive = await unzipper.Open.file(path);
  const entries = archive.files
    .filter((entry) => entry.type === 'File')
    .map((entry) => `${entry.path}\0${entry.uncompressedSize}\0${entry.crc32 >>> 0}`)
    .sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}
