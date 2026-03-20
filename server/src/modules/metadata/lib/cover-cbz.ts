import { readFile } from 'fs/promises';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

function isHidden(name: string): boolean {
  return name.split('/').some((part) => part.startsWith('.'));
}

/**
 * Locate the end-of-central-directory record by scanning backwards from the end
 * of the buffer. Handles ZIP comments up to 65535 bytes (e.g. ComicTagger JSON
 * appended to the archive).
 */
function findEOCD(buf: Buffer): { cdOffset: number } | null {
  const searchStart = Math.max(0, buf.length - 65535 - 22);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x05 || buf[i + 3] !== 0x06) continue;
    const commentLen = buf.readUInt16LE(i + 20);
    if (i + 22 + commentLen <= buf.length) {
      return { cdOffset: buf.readUInt32LE(i + 16) };
    }
  }
  return null;
}

/**
 * Extract the first image from a CBZ file using the ZIP central directory.
 *
 * Reading sizes from the central directory (rather than local file headers) is
 * required because many CBZ files use data descriptors — a ZIP feature where the
 * compressed/uncompressed sizes in the local file header are left as zero and the
 * real values appear in a trailing descriptor after the data. The central directory
 * always carries the correct sizes regardless of this flag.
 *
 * Supports STORED (0) and DEFLATE (8) compression.
 */
export async function extractCbzCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(absolutePath);

    const eocd = findEOCD(buf);
    if (!eocd) return null;

    let pos = eocd.cdOffset;
    while (pos + 46 <= buf.length) {
      if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02) break;

      const compression = buf.readUInt16LE(pos + 10);
      const compressedSize = buf.readUInt32LE(pos + 20);
      const fileNameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const lfhOffset = buf.readUInt32LE(pos + 42);

      const fileName = buf.subarray(pos + 46, pos + 46 + fileNameLen).toString('utf-8');

      if (!fileName.endsWith('/') && !isHidden(fileName) && isImage(fileName)) {
        // Skip to actual data by re-reading the LFH header lengths at lfhOffset.
        // The CDR has the correct compressedSize even when data descriptors are used.
        const lfhFileNameLen = buf.readUInt16LE(lfhOffset + 26);
        const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28);
        const dataStart = lfhOffset + 30 + lfhFileNameLen + lfhExtraLen;

        if (compression === 0) {
          return buf.subarray(dataStart, dataStart + compressedSize);
        } else if (compression === 8) {
          const { inflateRawSync } = await import('zlib');
          return inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize));
        }
      }

      pos += 46 + fileNameLen + extraLen + commentLen;
    }

    return null;
  } catch {
    return null;
  }
}
