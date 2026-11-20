import sharp from 'sharp';

import { bookCoverDirPath } from '../../../common/book-cover-storage';
import { detectComicContainerFormat } from '../../../common/comic-format-detect';
import { extractCb7Cover } from './cover-cb7';
import { extractCbrCover } from './cover-cbr';
import { extractCbzCover } from './cover-cbz';
import { extractEpubCover } from './cover-epub';
import { extractFb2Cover } from './cover-fb2';
import { extractMobiCover } from './mobi-parser';
import { extractPdfCover } from './pdf-cover';

const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 600;
const THUMBNAIL_JPEG_QUALITY = 82;
/** Twice the largest the book page draws the cover, for high-density screens. */
const DISPLAY_COVER_WIDTH = 600;
const DISPLAY_COVER_HEIGHT = 900;
/** A cover already inside the display box and this light is served as it is. */
const DISPLAY_COVER_PASSTHROUGH_BYTES = 256 * 1024;

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

/**
 * mozjpeg at 82 is about 40% smaller than libjpeg at 90 with no visible difference at grid sizes, and
 * stays JPEG for the Kobo, OPDS and iOS clients that read thumbnails directly.
 */
export async function generateThumbnail(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * A screen-sized copy of a cover for pages that show it large, or null when the cover is already
 * small enough to serve as it is. Oriented first, since the copy carries no EXIF to rotate by.
 */
export async function generateDisplayCover(bytes: Buffer): Promise<Buffer | null> {
  const image = sharp(bytes, { failOn: 'error' });
  const { width = 0, height = 0 } = await image.metadata();
  if (width <= DISPLAY_COVER_WIDTH && height <= DISPLAY_COVER_HEIGHT && bytes.length <= DISPLAY_COVER_PASSTHROUGH_BYTES) return null;
  return image
    .rotate()
    .resize(DISPLAY_COVER_WIDTH, DISPLAY_COVER_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

export async function normalizeProgressiveJpeg(bytes: Buffer): Promise<Buffer> {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  if (metadata.format !== 'jpeg' || !metadata.isProgressive) return bytes;

  return sharp(bytes, { failOn: 'error' }).keepMetadata().jpeg({ quality: 90, progressive: false }).toBuffer();
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
    case 'cbr': {
      const actual = await detectComicContainerFormat(absolutePath, format.toLowerCase() as 'cbz' | 'cbr');
      return actual === 'cbr' ? extractCbrCover(absolutePath) : extractCbzCover(absolutePath);
    }
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
