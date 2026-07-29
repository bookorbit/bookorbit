import sharp from 'sharp';

import { EXTH_COVER_OFFSET, EXTH_THUMB_OFFSET, readExthUint32, type ExthRecord } from './mobi-exth';

// EXTH 201/202 hold the cover and thumbnail positions as offsets from firstImageIndex,
// so replacing the records they point at leaves both the EXTH values and any KF8
// kindle:embed numbering untouched.

const NO_OFFSET = 0xffffffff;

// Kindle thumbnails sit around 320x470 and well under 16KB; observed real files
// range from 11KB to 16KB.
const THUMBNAIL_MAX_WIDTH = 320;
const THUMBNAIL_MAX_HEIGHT = 470;
const COVER_JPEG_QUALITY = 85;
const THUMBNAIL_JPEG_QUALITY = 80;

export interface MobiCoverSlots {
  coverIndex: number;
  thumbnailIndex: number | null;
}

export function isImageRecord(record: Buffer): boolean {
  const isJpeg = record.length >= 2 && record[0] === 0xff && record[1] === 0xd8;
  const isPng = record.length >= 4 && record[0] === 0x89 && record[1] === 0x50 && record[2] === 0x4e && record[3] === 0x47;
  return isJpeg || isPng;
}

/**
 * Resolve the records holding the cover and thumbnail. Returns null when the file has
 * no usable cover slot, in which case the caller writes metadata and skips the cover
 * rather than appending new image records.
 */
export function resolveCoverSlots(
  exthRecords: readonly ExthRecord[],
  firstImageIndex: number,
  recordCount: number,
  recordAt: (index: number) => Buffer,
): MobiCoverSlots | null {
  const coverOffset = readExthUint32(exthRecords, EXTH_COVER_OFFSET);
  if (coverOffset === null || coverOffset === NO_OFFSET) return null;

  const coverIndex = firstImageIndex + coverOffset;
  if (coverIndex <= 0 || coverIndex >= recordCount || !isImageRecord(recordAt(coverIndex))) return null;

  const thumbnailOffset = readExthUint32(exthRecords, EXTH_THUMB_OFFSET);
  const thumbnailIndex = thumbnailOffset === null || thumbnailOffset === NO_OFFSET ? null : firstImageIndex + thumbnailOffset;
  const thumbnailUsable =
    thumbnailIndex !== null &&
    thumbnailIndex > 0 &&
    thumbnailIndex !== coverIndex &&
    thumbnailIndex < recordCount &&
    isImageRecord(recordAt(thumbnailIndex));

  return { coverIndex, thumbnailIndex: thumbnailUsable ? thumbnailIndex : null };
}

export interface MobiCoverImages {
  cover: Buffer;
  thumbnail: Buffer;
}

export async function buildCoverImages(coverBytes: Buffer): Promise<MobiCoverImages> {
  const cover = await sharp(coverBytes, { failOn: 'error' }).jpeg({ quality: COVER_JPEG_QUALITY }).toBuffer();
  const thumbnail = await sharp(coverBytes, { failOn: 'error' })
    .resize(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_JPEG_QUALITY })
    .toBuffer();
  return { cover, thumbnail };
}
