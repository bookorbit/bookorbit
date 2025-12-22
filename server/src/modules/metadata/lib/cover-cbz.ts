import { readFile } from 'fs/promises';

// ZIP local file header signature
const LFH_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

function isHidden(name: string): boolean {
  return name.split('/').some((part) => part.startsWith('.'));
}

/**
 * Extract the first image from a CBZ file by scanning local file headers directly.
 * This bypasses the central directory, which unzipper fails to read when the ZIP
 * has a large comment (e.g. ComicTagger JSON metadata appended to the archive).
 *
 * Supports STORED (0) and DEFLATE (8) compression.
 */
export async function extractCbzCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(absolutePath);

    let pos = 0;
    while (pos < buf.length - 30) {
      // Find next local file header signature
      const sigPos = buf.indexOf(LFH_SIG, pos);
      if (sigPos === -1) break;

      const offset = sigPos;
      const compression = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const fileNameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);

      const dataStart = offset + 30 + fileNameLen + extraLen;
      const fileName = buf.subarray(offset + 30, offset + 30 + fileNameLen).toString('utf-8');

      // Skip directories, hidden files, and non-images
      if (!fileName.endsWith('/') && !isHidden(fileName) && isImage(fileName)) {
        if (compression === 0) {
          // STORED — data is uncompressed
          return buf.subarray(dataStart, dataStart + compressedSize);
        } else if (compression === 8) {
          // DEFLATE
          const { inflateRawSync } = await import('zlib');
          const compressed = buf.subarray(dataStart, dataStart + compressedSize);
          return inflateRawSync(compressed);
        }
      }

      pos = dataStart + compressedSize;
      if (compressedSize === 0) pos = sigPos + 4; // guard against infinite loop
    }

    return null;
  } catch {
    return null;
  }
}
