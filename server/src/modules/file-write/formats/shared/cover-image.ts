import sharp from 'sharp';

const FORMAT_DETAILS = {
  jpeg: { mediaType: 'image/jpeg', extension: 'jpg' },
  png: { mediaType: 'image/png', extension: 'png' },
  gif: { mediaType: 'image/gif', extension: 'gif' },
  webp: { mediaType: 'image/webp', extension: 'webp' },
  tiff: { mediaType: 'image/tiff', extension: 'tiff' },
  svg: { mediaType: 'image/svg+xml', extension: 'svg' },
  jp2: { mediaType: 'image/jp2', extension: 'jp2' },
  jxl: { mediaType: 'image/jxl', extension: 'jxl' },
} as const;

export interface CoverImageInfo {
  mediaType: string;
  extension: string;
}

export async function inspectCoverImage(bytes: Buffer): Promise<CoverImageInfo> {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  const knownFormat = metadata.format ? FORMAT_DETAILS[metadata.format as keyof typeof FORMAT_DETAILS] : undefined;
  if (knownFormat) return knownFormat;

  if (metadata.format === 'heif') {
    return metadata.compression === 'av1' ? { mediaType: 'image/avif', extension: 'avif' } : { mediaType: 'image/heic', extension: 'heic' };
  }

  if (isBitmap(bytes)) return { mediaType: 'image/bmp', extension: 'bmp' };
  throw new Error(`Unsupported cover image format: ${metadata.format || 'unknown'}`);
}

function isBitmap(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}
