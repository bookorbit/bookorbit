import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

import { extractCbzCover } from './cover-cbz';
import { extractEpubCover } from './cover-epub';
import { extractMobiCover } from './mobi-parser';

const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 600;

/** Returns extension based on magic bytes, defaulting to 'jpg'. */
function imageExt(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  return 'jpg';
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
    default:
      return null;
  }
}

/**
 * Extract cover from a book file and save it under {booksPath}/covers/{bookId}/cover.{ext}.
 * Returns the saved file path, or null if no cover was found.
 */
export async function extractAndSaveCover(absolutePath: string, format: string, bookId: number, booksPath: string): Promise<string | null> {
  const bytes = await extractCover(absolutePath, format);
  if (!bytes || bytes.length === 0) return null;

  const dir = join(booksPath, 'covers', String(bookId));
  await mkdir(dir, { recursive: true });

  const ext = imageExt(bytes);
  const filePath = join(dir, `cover.${ext}`);
  await writeFile(filePath, bytes);

  const thumbnail = await sharp(bytes).resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'cover', position: 'top' }).jpeg({ quality: 90 }).toBuffer();
  await writeFile(join(dir, 'thumbnail.jpg'), thumbnail);

  return filePath;
}

/** Resolve the cover path for a book on disk without extracting. */
export function coverDirPath(booksPath: string, bookId: number): string {
  return join(booksPath, 'covers', String(bookId));
}
