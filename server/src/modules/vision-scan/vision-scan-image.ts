import type { VisionScanKind } from '@bookorbit/types';
import sharp from 'sharp';

import type { AiImage } from '../ai/ai-client.types';

/** Long edge sent to the model: a shelf needs the detail of its narrow spines, a cover less. */
const LONG_EDGE: Record<VisionScanKind, number> = { cover: 1536, shelf: 2048 };
/** Smaller than this on either side holds nothing readable. */
const MIN_EDGE = 64;
/** Refuses a decompression bomb before sharp allocates for it. */
const MAX_INPUT_PIXELS = 60_000_000;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class VisionScanImageError extends Error {}

/**
 * The photo as the model gets it: checked to be a JPEG, PNG or WebP image, turned upright by its
 * EXIF orientation, scaled down to the kind's long edge, and re-encoded as JPEG with no metadata,
 * so no location or device details leave the server.
 */
export async function prepareVisionImage(bytes: Buffer, kind: VisionScanKind): Promise<AiImage> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).metadata());
  } catch {
    throw new VisionScanImageError('The photo could not be read');
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw new VisionScanImageError('The photo must be a JPEG, PNG or WebP image');

  const edge = LONG_EDGE[kind];
  let output: { data: Buffer; info: sharp.OutputInfo };
  try {
    output = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new VisionScanImageError('The photo could not be read');
  }
  if (output.info.width < MIN_EDGE || output.info.height < MIN_EDGE) throw new VisionScanImageError('The photo is too small to read');
  return { mediaType: 'image/jpeg', data: output.data.toString('base64'), width: output.info.width, height: output.info.height };
}
