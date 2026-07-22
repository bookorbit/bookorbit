import sharp from 'sharp';

import { inspectCoverImage } from './epub-cover-image';

async function makeImage(format: 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'tiff'): Promise<Buffer> {
  const image = sharp({
    create: {
      width: 8,
      height: 12,
      channels: 4,
      background: { r: 35, g: 90, b: 180, alpha: 0.6 },
    },
  });
  return image[format]().toBuffer();
}

describe('inspectCoverImage', () => {
  it.each([
    ['jpeg', 'image/jpeg', 'jpg'],
    ['png', 'image/png', 'png'],
    ['gif', 'image/gif', 'gif'],
    ['webp', 'image/webp', 'webp'],
    ['avif', 'image/avif', 'avif'],
    ['tiff', 'image/tiff', 'tiff'],
  ] as const)('identifies %s bytes without modifying them', async (format, mediaType, extension) => {
    const bytes = await makeImage(format);

    await expect(inspectCoverImage(bytes)).resolves.toEqual({ mediaType, extension });
  });

  it('rejects bytes that are not a decodable image', async () => {
    await expect(inspectCoverImage(Buffer.from('not-an-image'))).rejects.toThrow();
  });
});
