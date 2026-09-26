import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { podcastArtworkDirPath, podcastArtworkThumbnailPath } from '../../common/podcast-artwork-storage';
import { PodcastArtworkService } from './podcast-artwork.service';

/** Exercises the artwork write path against a real filesystem and a real sharp, unlike the mocked-fs suite. */
describe('PodcastArtworkService custom artwork on disk', () => {
  let appDataPath: string;
  let service: PodcastArtworkService;
  const repo = { findPodcast: vi.fn() };

  beforeAll(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'podcast-artwork-'));
    service = new PodcastArtworkService(
      { requestTimeoutMs: 1_000 } as never,
      repo as never,
      {} as never,
      {} as never,
      { getOrThrow: () => appDataPath } as never,
    );
  });

  afterAll(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  async function image(format: 'png' | 'jpeg', size = 900): Promise<Buffer> {
    return sharp({ create: { width: size, height: size, channels: 3, background: { r: 12, g: 34, b: 56 } } })
      .toFormat(format)
      .toBuffer();
  }

  it('writes the artwork, a bounded thumbnail, and serves the stored bytes back', async () => {
    const png = await image('png');

    await expect(service.saveCustomArtwork(5, png)).resolves.toEqual({ format: 'png', bytes: png.byteLength });

    const directory = podcastArtworkDirPath(appDataPath, 5);
    expect((await readdir(directory)).sort()).toEqual(['artwork_custom.png', 'thumbnail.jpg']);
    const thumbnail = await sharp(await readFile(podcastArtworkThumbnailPath(appDataPath, 5))).metadata();
    expect(thumbnail.format).toBe('jpeg');
    expect(thumbnail.width).toBe(512);

    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: null, customArtworkAt: new Date() });
    await expect(service.fetchArtwork(5)).resolves.toEqual({ data: png, contentType: 'image/png' });
  });

  it('replaces artwork stored under another format and then removes every file', async () => {
    await service.saveCustomArtwork(6, await image('png', 64));
    const jpeg = await image('jpeg', 64);

    await service.saveCustomArtwork(6, jpeg);

    const directory = podcastArtworkDirPath(appDataPath, 6);
    expect((await readdir(directory)).sort()).toEqual(['artwork_custom.jpg', 'thumbnail.jpg']);
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: null, customArtworkAt: new Date() });
    await expect(service.fetchArtwork(6)).resolves.toEqual({ data: jpeg, contentType: 'image/jpeg' });

    await expect(service.removeCustomArtwork(6)).resolves.toBe(true);
    expect(await readdir(directory)).toEqual([]);
    await expect(service.fetchArtwork(6)).rejects.toThrow('Podcast artwork not found');
  });

  it('accepts an AVIF upload that libvips decodes through its HEIF loader', async () => {
    const avif = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .avif({ effort: 0 })
      .toBuffer();

    await expect(service.saveCustomArtwork(9, avif)).resolves.toMatchObject({ format: 'avif' });

    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: null, customArtworkAt: new Date() });
    await expect(service.fetchArtwork(9)).resolves.toMatchObject({ contentType: 'image/avif' });
  });

  it('leaves nothing behind when the upload is rejected', async () => {
    await expect(service.saveCustomArtwork(7, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow('Podcast artwork');

    await expect(readdir(podcastArtworkDirPath(appDataPath, 7))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('drops the whole directory when a show is purged', async () => {
    await service.saveCustomArtwork(8, await image('png', 64));

    await service.purgeCustomArtwork(8);

    await expect(readdir(podcastArtworkDirPath(appDataPath, 8))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
