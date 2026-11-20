import { BOOK_REQUEST_FORMATS_BY_MEDIA_KIND, isBookRequestMediaKind } from '@bookorbit/types';

/**
 * Whether a library lets in any format of a medium, judged by its own format list, where an empty
 * list lets in everything. A book in a library limited to other formats cannot take that medium as
 * a second format: the Library Dock would refuse the files when they arrive, and the request would
 * stop at review instead of landing anywhere.
 */
export function libraryTakesMedium(allowedFormats: readonly string[], mediaKind: string): boolean {
  const allowed = allowedFormats.map((format) => format.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return true;
  if (!isBookRequestMediaKind(mediaKind)) return false;
  return BOOK_REQUEST_FORMATS_BY_MEDIA_KIND[mediaKind].some((format) => allowed.includes(format));
}
