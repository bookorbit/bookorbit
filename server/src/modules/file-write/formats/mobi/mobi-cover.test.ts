import sharp from 'sharp';

import { buildCoverImages, isImageRecord, resolveCoverSlots } from './mobi-cover';
import { EXTH_COVER_OFFSET, EXTH_THUMB_OFFSET, type ExthRecord } from './mobi-exth';
import { fakeImageRecord } from './mobi-test-fixtures';

function uint32Record(type: number, value: number): ExthRecord {
  const data = Buffer.alloc(4);
  data.writeUInt32BE(value, 0);
  return { type, data };
}

function makePngBuffer(): Buffer {
  const buffer = Buffer.alloc(64);
  buffer[0] = 0x89;
  buffer.write('PNG', 1, 'ascii');
  return buffer;
}

/** Records 5 and 6 hold the cover and thumbnail; everything else is non-image data. */
function recordAtFactory(overrides: Record<number, Buffer> = {}): (index: number) => Buffer {
  return (index) => overrides[index] ?? (index === 5 || index === 6 ? fakeImageRecord(256, index) : Buffer.alloc(64, 0x30));
}

describe('isImageRecord', () => {
  it('accepts JPEG magic', () => {
    expect(isImageRecord(fakeImageRecord(32))).toBe(true);
  });

  it('accepts PNG magic', () => {
    expect(isImageRecord(makePngBuffer())).toBe(true);
  });

  it('rejects arbitrary binary data', () => {
    expect(isImageRecord(Buffer.alloc(64, 0x30))).toBe(false);
  });

  it('rejects a record too short to carry magic bytes', () => {
    expect(isImageRecord(Buffer.from([0xff]))).toBe(false);
  });
});

describe('resolveCoverSlots', () => {
  const firstImageIndex = 5;
  const recordCount = 10;

  it('resolves the cover and thumbnail indices relative to the first image index', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 0), uint32Record(EXTH_THUMB_OFFSET, 1)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toEqual({ coverIndex: 5, thumbnailIndex: 6 });
  });

  it('returns null when the file has no cover record', () => {
    expect(resolveCoverSlots([], firstImageIndex, recordCount, recordAtFactory())).toBeNull();
  });

  it('returns null when the cover offset is the sentinel value', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 0xffffffff)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toBeNull();
  });

  it('returns null when the resolved cover index is out of range', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 900)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toBeNull();
  });

  it('returns null when the resolved record is not an image', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 2)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toBeNull();
  });

  it('resolves the cover but drops an unusable thumbnail', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 0), uint32Record(EXTH_THUMB_OFFSET, 3)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toEqual({ coverIndex: 5, thumbnailIndex: null });
  });

  it('drops a thumbnail that points at the cover record', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 0), uint32Record(EXTH_THUMB_OFFSET, 0)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toEqual({ coverIndex: 5, thumbnailIndex: null });
  });

  it('drops a thumbnail whose index is out of range', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 0), uint32Record(EXTH_THUMB_OFFSET, 900)];

    expect(resolveCoverSlots(exth, firstImageIndex, recordCount, recordAtFactory())).toEqual({ coverIndex: 5, thumbnailIndex: null });
  });

  it('returns null when the cover would resolve to the header record', () => {
    const exth = [uint32Record(EXTH_COVER_OFFSET, 0)];

    expect(resolveCoverSlots(exth, 0, recordCount, recordAtFactory({ 0: fakeImageRecord(32) }))).toBeNull();
  });
});

describe('buildCoverImages', () => {
  async function solidCover(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 90, b: 160 } } })
      .png()
      .toBuffer();
  }

  it('normalises the cover to JPEG', async () => {
    const { cover } = await buildCoverImages(await solidCover(600, 900));

    expect(cover.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect((await sharp(cover).metadata()).format).toBe('jpeg');
  });

  it('produces a thumbnail that fits the Kindle bounds and stays smaller than the cover', async () => {
    const { cover, thumbnail } = await buildCoverImages(await solidCover(1200, 1800));
    const metadata = await sharp(thumbnail).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(320);
    expect(metadata.height).toBeLessThanOrEqual(470);
    expect(thumbnail.length).toBeLessThan(cover.length);
  });

  it('preserves the aspect ratio when shrinking', async () => {
    const { thumbnail } = await buildCoverImages(await solidCover(1000, 1500));
    const metadata = await sharp(thumbnail).metadata();

    expect(metadata.width! / metadata.height!).toBeCloseTo(1000 / 1500, 2);
  });

  it('does not enlarge an already small cover', async () => {
    const { thumbnail } = await buildCoverImages(await solidCover(100, 150));
    const metadata = await sharp(thumbnail).metadata();

    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(150);
  });

  it('rejects bytes that are not a decodable image', async () => {
    await expect(buildCoverImages(Buffer.alloc(128, 0x5a))).rejects.toThrow();
  });
});
