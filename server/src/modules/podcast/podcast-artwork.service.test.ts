import { BadGatewayException, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { readdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PodcastArtworkService } from './podcast-artwork.service';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

describe('PodcastArtworkService', () => {
  const repo = { findPodcast: vi.fn() };
  const secrets = { decrypt: vi.fn() };
  const urlSecurity = { fetch: vi.fn() };
  const service = new PodcastArtworkService(
    { requestTimeoutMs: 30_000 } as never,
    repo as never,
    secrets as never,
    urlSecurity as never,
    { getOrThrow: () => '/app-data' } as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readdir).mockResolvedValue([]);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('rejects responses that are not safe raster images', async () => {
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: 'encrypted' });
    secrets.decrypt.mockReturnValue('https://example.com/artwork');
    urlSecurity.fetch.mockResolvedValue({
      response: new Response('<html>not an image</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    });

    await expect(service.fetchArtwork(7)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects non-image bytes even when the server claims a raster content type', async () => {
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: 'encrypted' });
    secrets.decrypt.mockReturnValue('https://example.com/artwork');
    urlSecurity.fetch.mockResolvedValue({
      response: new Response('<html>not an image</html>', { status: 200, headers: { 'Content-Type': 'image/png' } }),
    });

    await expect(service.fetchArtwork(7)).rejects.toThrow('Podcast artwork is not a valid raster image');
  });

  it('accepts valid artwork when the server returns a generic content type', async () => {
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: 'encrypted-generic' });
    secrets.decrypt.mockReturnValue('https://example.com/generic-artwork');
    urlSecurity.fetch.mockResolvedValue({
      response: new Response(PNG, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
    });

    await expect(service.fetchArtwork(10)).resolves.toEqual({ data: PNG, contentType: 'image/png' });
    expect(urlSecurity.fetch).toHaveBeenCalledWith(
      new URL('https://example.com/generic-artwork'),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.stringContaining('image/*') }) }),
    );
  });

  it('coalesces repeated access through the bounded server cache', async () => {
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: 'encrypted-cache' });
    secrets.decrypt.mockReturnValue('https://example.com/cached-artwork.png');
    urlSecurity.fetch.mockResolvedValue({
      response: new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    });

    const [first, second] = await Promise.all([service.fetchArtwork(8), service.fetchArtwork(8)]);

    expect(first.data).toEqual(PNG);
    expect(second).toEqual(first);
    expect(urlSecurity.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale request overwrite a newer source', async () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    let resolveOld!: (value: { response: Response }) => void;
    let resolveNew!: (value: { response: Response }) => void;
    repo.findPodcast.mockResolvedValueOnce({ imageUrlEncrypted: 'old' }).mockResolvedValue({ imageUrlEncrypted: 'new' });
    secrets.decrypt.mockImplementation((value: string) => `https://example.com/${value}`);
    urlSecurity.fetch
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveNew = resolve)));

    const oldRequest = service.fetchArtwork(9);
    await vi.waitFor(() => expect(urlSecurity.fetch).toHaveBeenCalledTimes(1));
    const newRequest = service.fetchArtwork(9);
    await vi.waitFor(() => expect(urlSecurity.fetch).toHaveBeenCalledTimes(2));
    resolveNew({ response: new Response(gif, { status: 200, headers: { 'Content-Type': 'image/gif' } }) });
    await expect(newRequest).resolves.toEqual({ data: gif, contentType: 'image/gif' });
    resolveOld({ response: new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }) });
    await oldRequest;

    await expect(service.fetchArtwork(9)).resolves.toEqual({ data: gif, contentType: 'image/gif' });
    expect(urlSecurity.fetch).toHaveBeenCalledTimes(2);
  });

  it('stores custom artwork and its thumbnail through temporary files and renames', async () => {
    await expect(service.saveCustomArtwork(12, PNG)).resolves.toEqual({ format: 'png', bytes: PNG.byteLength });

    const renames = vi.mocked(rename).mock.calls;
    expect(renames).toHaveLength(2);
    expect(renames[0]![0]).toMatch(/\.artwork-upload-.*\.thumbnail\.tmp$/);
    expect(renames[0]![1]).toBe('/app-data/podcast-artwork/12/thumbnail.jpg');
    expect(renames[1]![0]).toMatch(/\.artwork-upload-.*\.png\.tmp$/);
    expect(renames[1]![1]).toBe('/app-data/podcast-artwork/12/artwork_custom.png');
  });

  it('replaces custom artwork stored under a different extension', async () => {
    vi.mocked(readdir).mockResolvedValue(['artwork_custom.jpg', 'thumbnail.jpg'] as never);

    await service.saveCustomArtwork(12, PNG);

    expect(unlink).toHaveBeenCalledWith('/app-data/podcast-artwork/12/artwork_custom.jpg');
    expect(unlink).not.toHaveBeenCalledWith('/app-data/podcast-artwork/12/thumbnail.jpg');
  });

  it('rejects uploads whose bytes are not an allowed raster format', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');

    await expect(service.saveCustomArtwork(12, svg)).rejects.toBeInstanceOf(BadRequestException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects uploads whose magic bytes disagree with the decoded image', async () => {
    const disguised = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), PNG.subarray(3)]);

    await expect(service.saveCustomArtwork(12, disguised)).rejects.toThrow('Podcast artwork');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects uploads over the size limit', async () => {
    const oversized = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);

    await expect(service.saveCustomArtwork(12, oversized)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('serves stored custom artwork instead of the feed image', async () => {
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: 'encrypted', customArtworkAt: new Date('2026-07-31T00:00:00.000Z') });
    vi.mocked(readdir).mockResolvedValue(['artwork_custom.png'] as never);
    vi.mocked(readFile).mockResolvedValue(PNG);

    await expect(service.fetchArtwork(13)).resolves.toEqual({ data: PNG, contentType: 'image/png' });
    expect(urlSecurity.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the feed image when the custom artwork file is gone', async () => {
    repo.findPodcast.mockResolvedValue({ imageUrlEncrypted: 'encrypted', customArtworkAt: new Date('2026-07-31T00:00:00.000Z') });
    secrets.decrypt.mockReturnValue('https://example.com/artwork.png');
    urlSecurity.fetch.mockResolvedValue({ response: new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }) });

    await expect(service.fetchArtwork(14)).resolves.toEqual({ data: PNG, contentType: 'image/png' });
  });

  it('removes every custom artwork file and its thumbnail', async () => {
    vi.mocked(readdir).mockResolvedValue(['artwork_custom.png', 'thumbnail.jpg'] as never);

    await expect(service.removeCustomArtwork(15)).resolves.toBe(true);

    expect(unlink).toHaveBeenCalledWith('/app-data/podcast-artwork/15/artwork_custom.png');
    expect(unlink).toHaveBeenCalledWith('/app-data/podcast-artwork/15/thumbnail.jpg');
  });

  it('purges the complete custom artwork directory', async () => {
    await service.purgeCustomArtwork(16);

    expect(rm).toHaveBeenCalledWith('/app-data/podcast-artwork/16', { recursive: true, force: true });
  });
});
