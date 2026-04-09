import { join } from 'path';

export const COVER_CUSTOM_FILE_PREFIX = 'cover_custom.';
export const COVER_EXTRACTED_FILE_PREFIX = 'cover_extracted.';
export const COVER_THUMBNAIL_FILE_NAME = 'thumbnail.jpg';

export function bookCoverDirPath(appDataPath: string, bookId: number): string {
  return join(appDataPath, 'covers', String(bookId));
}

export function bookThumbnailPath(appDataPath: string, bookId: number): string {
  return join(bookCoverDirPath(appDataPath, bookId), COVER_THUMBNAIL_FILE_NAME);
}

export function isCustomBookCoverFileName(fileName: string): boolean {
  return fileName.startsWith(COVER_CUSTOM_FILE_PREFIX);
}

export function isExtractedBookCoverFileName(fileName: string): boolean {
  return fileName.startsWith(COVER_EXTRACTED_FILE_PREFIX);
}

export function findPreferredBookCoverFileName(files: readonly string[]): string | null {
  return files.find(isCustomBookCoverFileName) ?? files.find(isExtractedBookCoverFileName) ?? null;
}

export function findExtractedBookCoverFileName(files: readonly string[]): string | null {
  return files.find(isExtractedBookCoverFileName) ?? null;
}
