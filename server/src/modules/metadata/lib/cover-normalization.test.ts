import sharp from 'sharp';

import { normalizeProgressiveJpeg } from './cover';

describe('normalizeProgressiveJpeg', () => {
  async function makeJpeg(progressive: boolean, orientation?: number): Promise<Buffer> {
    let image = sharp({
      create: {
        width: 20,
        height: 30,
        channels: 3,
        background: '#785028',
      },
    });
    if (orientation) image = image.withMetadata({ orientation });
    return image.jpeg({ quality: 90, progressive }).toBuffer();
  }

  it('re-encodes progressive JPEGs as baseline while preserving metadata', async () => {
    const source = await makeJpeg(true, 6);

    const result = await normalizeProgressiveJpeg(source);

    expect(result).not.toBe(source);
    expect(result).not.toEqual(source);
    const metadata = await sharp(result).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg',
      isProgressive: false,
      orientation: 6,
      width: 20,
      height: 30,
    });
  });

  it('returns baseline JPEG bytes unchanged', async () => {
    const source = await makeJpeg(false);

    const result = await normalizeProgressiveJpeg(source);

    expect(result).toBe(source);
  });

  it.each([
    [
      'PNG',
      async () =>
        sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } })
          .png()
          .toBuffer(),
    ],
    [
      'WebP',
      async () =>
        sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
          .webp()
          .toBuffer(),
    ],
  ])('returns %s bytes unchanged', async (_format, createImage) => {
    const source = await createImage();

    const result = await normalizeProgressiveJpeg(source);

    expect(result).toBe(source);
  });

  it('rejects invalid image bytes', async () => {
    await expect(normalizeProgressiveJpeg(Buffer.from('not-an-image'))).rejects.toThrow();
  });
});
