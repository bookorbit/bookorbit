import sharp from 'sharp';

import { inspectCoverImage, type CoverImageInfo } from '../shared/cover-image';

export type { CoverImageInfo as EpubCoverImage } from '../shared/cover-image';
export { inspectCoverImage } from '../shared/cover-image';

const EPUB_CORE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * An image a reader is bound to render. Anything else, such as TIFF or AVIF, is re-encoded as JPEG
 * so a manifest item never needs a fallback.
 */
export async function toEpubCoreImage(bytes: Buffer): Promise<{ bytes: Buffer; image: CoverImageInfo }> {
  const image = await inspectCoverImage(bytes);
  if (EPUB_CORE_IMAGE_TYPES.has(image.mediaType)) return { bytes, image };
  const jpeg = await sharp(bytes, { failOn: 'error' }).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  return { bytes: jpeg, image: { mediaType: 'image/jpeg', extension: 'jpg' } };
}
