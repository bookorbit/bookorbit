import { open } from 'fs/promises';

export type ComicContainerFormat = 'cbz' | 'cbr' | 'cb7';

const RAR_SIGNATURES = [
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00],
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00],
] as const;

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const;

function startsWithSignature(buf: Buffer, bytesRead: number, signature: readonly number[]): boolean {
  return bytesRead >= signature.length && signature.every((byte, index) => buf[index] === byte);
}

/**
 * Reads magic bytes from the file to determine the actual container format.
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
    const buf = Buffer.allocUnsafe(8);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (RAR_SIGNATURES.some((signature) => startsWithSignature(buf, bytesRead, signature))) return 'cbr';
    if (ZIP_SIGNATURES.some((signature) => startsWithSignature(buf, bytesRead, signature))) return 'cbz';
  } catch {
    return storedFmt;
  } finally {
    await fh?.close();
  }

  return storedFmt;
}
