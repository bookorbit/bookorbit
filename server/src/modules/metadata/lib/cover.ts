import sharp from 'sharp';

import { bookCoverDirPath } from '../../../common/book-cover-storage';
import { extractCb7Cover } from './cover-cb7';
import { extractCbrCover } from './cover-cbr';
import { extractCbzCover } from './cover-cbz';
import { extractEpubCover } from './cover-epub';
import { extractFb2Cover } from './cover-fb2';
import { extractMobiCover } from './mobi-parser';
import { extractPdfCover } from './pdf-cover';

const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 600;

/** Returns extension based on magic bytes, defaulting to 'jpg'. */
export function imageExt(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  return 'jpg';
}

export async function generateThumbnail(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Extract cover bytes from a book file based on its format.
 * Returns null if no cover can be extracted.
 */
export async function extractCover(absolutePath: string, format: string): Promise<Buffer | null> {
  switch (format.toLowerCase()) {
    case 'epub':
      return extractEpubCover(absolutePath);
    case 'mobi':
    case 'azw3':
    case 'azw':
      return extractMobiCover(absolutePath);
    case 'cbz':
      return extractCbzCover(absolutePath);
    case 'cbr':
      return extractCbrCover(absolutePath);
    case 'cb7':
      return extractCb7Cover(absolutePath);
    case 'fb2':
      return extractFb2Cover(absolutePath);
    case 'pdf':
      return extractPdfCover(absolutePath).catch(() => null);
    default:
      return null;
  }
}

/** Resolve the cover directory for a book on disk. */
export function coverDirPath(appDataPath: string, bookId: number): string {
  return bookCoverDirPath(appDataPath, bookId);
}
