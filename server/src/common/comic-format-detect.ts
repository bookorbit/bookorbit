import { open } from 'fs/promises';

export type ComicContainerFormat = 'cbz' | 'cbr' | 'cb7';

/**
 * Reads 4 magic bytes from the file to determine the actual container format.
 *
 * Some archives are mislabelled: a RAR archive saved as .cbz, or a ZIP saved
 * as .cbr. Extension-based classification routes them to the wrong reader;
 * magic bytes always tell the truth.
 *
 * Only overrides the stored format for cbz/cbr (ZIP vs RAR are the common
 * swap). CB7 (7-zip) has no overlap with either and is passed through as-is.
 *
 * Falls back to storedFmt on any I/O error (file not found, permission denied,
 * truncated file) so callers get predictable behaviour and produce a clear
 * downstream error rather than an unexpected I/O exception.
 */
export async function detectComicContainerFormat(absolutePath: string, storedFmt: ComicContainerFormat): Promise<ComicContainerFormat> {
  if (storedFmt === 'cb7') return 'cb7';

  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(absolutePath, 'r');
    const buf = Buffer.allocUnsafe(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    if (bytesRead >= 4) {
      // RAR: Rar!
      if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'cbr';
      // ZIP: PK
      if (buf[0] === 0x50 && buf[1] === 0x4b) return 'cbz';
    }
  } catch {
    return storedFmt;
  } finally {
    await fh?.close();
  }

  return storedFmt;
}
