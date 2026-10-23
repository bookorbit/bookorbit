vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

import { KoboThumbnailService, parseKoboCoverRequest } from './kobo-thumbnail.service';

const statMock = vi.mocked(stat);
const createReadStreamMock = vi.mocked(createReadStream);

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('KoboThumbnailService', () => {
  const bookAccessService = {
    assertBookAccessible: vi.fn(),
  };
  const coverStore = {
    resolve: vi.fn(),
  };
  const settingsService = {
    getSettings: vi.fn(),
  };
  let service: KoboThumbnailService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    service = new KoboThumbnailService(bookAccessService as never, coverStore as never, settingsService as never);
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    settingsService.getSettings.mockResolvedValue({ fullSizeCovers: false });
    coverStore.resolve.mockImplementation((bookId: number, options: { variant: string }) =>
      Promise.resolve(`/app-data/covers/${bookId}/ebook/${options.variant === 'thumbnail' ? 'thumbnail.jpg' : 'cover_custom.png'}`),
    );
  });

  it('returns 304 when thumbnail etag matches if-none-match', async () => {
    const reply = makeReply();
    statMock.mockResolvedValueOnce({ mtimeMs: 1234 } as never);

    await service.serveThumbnail(7, 12, null, '"1234"', reply as never);

    expect(bookAccessService.assertBookAccessible).toHaveBeenCalledWith(7, 12);
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  it('streams thumbnail bytes and sets cache headers', async () => {
    const reply = makeReply();
    const stream = {} as never;
    statMock.mockResolvedValueOnce({ mtimeMs: 5678 } as never);
    createReadStreamMock.mockReturnValue(stream);

    await service.serveThumbnail(7, 12, null, undefined, reply as never);

    expect(coverStore.resolve).toHaveBeenCalledWith(12, { medium: 'ebook', variant: 'thumbnail' });
    expect(createReadStreamMock).toHaveBeenCalledWith('/app-data/covers/12/ebook/thumbnail.jpg');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'max-age=86400');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"5678"');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('falls back to cover serving when thumbnail file lookup fails', async () => {
    const reply = makeReply();
    statMock.mockRejectedValueOnce(new Error('missing thumbnail'));
    const coverSpy = vi.spyOn(service, 'serveCover').mockResolvedValue(undefined);

    await service.serveThumbnail(7, 12, null, undefined, reply as never);

    expect(coverSpy).toHaveBeenCalledWith(12, undefined, reply);
  });

  it('falls back to cover serving when the book has no thumbnail', async () => {
    const reply = makeReply();
    coverStore.resolve.mockResolvedValueOnce(null);
    const coverSpy = vi.spyOn(service, 'serveCover').mockResolvedValue(undefined);

    await service.serveThumbnail(7, 12, null, undefined, reply as never);

    expect(statMock).not.toHaveBeenCalled();
    expect(coverSpy).toHaveBeenCalledWith(12, undefined, reply);
  });

  it('serveCover serves the resolved ebook cover with its content type', async () => {
    const reply = makeReply();
    const stream = {} as never;
    statMock.mockResolvedValueOnce({ mtimeMs: 9999 } as never);
    createReadStreamMock.mockReturnValue(stream);

    await service.serveCover(25, undefined, reply as never);

    expect(coverStore.resolve).toHaveBeenCalledWith(25, { medium: 'ebook', variant: 'cover' });
    expect(createReadStreamMock).toHaveBeenCalledWith('/app-data/covers/25/ebook/cover_custom.png');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"9999"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('serveCover returns 304 for matching cover etag', async () => {
    const reply = makeReply();
    statMock.mockResolvedValueOnce({ mtimeMs: 2222 } as never);

    await service.serveCover(13, '"2222"', reply as never);

    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
  });

  it('throws NotFoundException when no cover image is available', async () => {
    coverStore.resolve.mockResolvedValueOnce(null);

    await expect(service.serveCover(25, undefined, makeReply() as never)).rejects.toThrow(NotFoundException);
  });

  describe('full-size covers', () => {
    const kobo = { width: 1264, height: 1680, quality: 80, greyscale: false };
    const coverPaths: string[] = [];

    async function writeCover(width: number, height: number): Promise<string> {
      const path = join(tmpdir(), `kobo-cover-${process.pid}-${coverPaths.length}-${width}x${height}.png`);
      await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 60, b: 30 } } })
        .png()
        .toFile(path);
      coverPaths.push(path);
      return path;
    }

    function resolveCoverAt(path: string) {
      coverStore.resolve.mockImplementation((bookId: number, options: { variant: string }) =>
        Promise.resolve(options.variant === 'cover' ? path : `/app-data/covers/${bookId}/ebook/thumbnail.jpg`),
      );
    }

    afterAll(async () => {
      const { rm } = await vi.importActual<typeof import('fs/promises')>('fs/promises');
      await Promise.all(coverPaths.map((path) => rm(path, { force: true })));
    });

    beforeEach(() => {
      settingsService.getSettings.mockResolvedValue({ fullSizeCovers: true });
    });

    it('serves the full cover scaled to fit the box the Kobo asked for', async () => {
      resolveCoverAt(await writeCover(1600, 2400));
      statMock.mockResolvedValueOnce({ mtimeMs: 4321 } as never);
      const reply = makeReply();

      await service.serveThumbnail(7, 12, kobo, undefined, reply as never);

      const sent = reply.send.mock.calls[0][0] as Buffer;
      await expect(sharp(sent).metadata()).resolves.toMatchObject({ format: 'jpeg', width: 1120, height: 1680 });
      expect(reply.header).toHaveBeenCalledWith('ETag', '"4321-1264x1680-q80"');
      expect(reply.type).toHaveBeenCalledWith('image/jpeg');
      expect(createReadStreamMock).not.toHaveBeenCalled();
    });

    it('serves a tile-size request at a full-screen size, so the sleep screen never stretches a tile', async () => {
      resolveCoverAt(await writeCover(1600, 2400));
      statMock.mockResolvedValueOnce({ mtimeMs: 4321 } as never);
      const reply = makeReply();

      await service.serveThumbnail(7, 12, { width: 355, height: 530, quality: 80, greyscale: false }, undefined, reply as never);

      await expect(sharp(reply.send.mock.calls[0][0] as Buffer).metadata()).resolves.toMatchObject({ width: 1280, height: 1920 });
      expect(reply.header).toHaveBeenCalledWith('ETag', '"4321-1440x1920-q80"');
    });

    it('never enlarges a cover smaller than the box', async () => {
      resolveCoverAt(await writeCover(300, 450));
      statMock.mockResolvedValueOnce({ mtimeMs: 1 } as never);
      const reply = makeReply();

      await service.serveThumbnail(7, 12, { ...kobo, greyscale: true }, undefined, reply as never);

      await expect(sharp(reply.send.mock.calls[0][0] as Buffer).metadata()).resolves.toMatchObject({ width: 300, height: 450 });
      expect(reply.header).toHaveBeenCalledWith('ETag', '"1-1264x1680-q80-g"');
    });

    it('answers a matching sized etag with 304 without rendering', async () => {
      resolveCoverAt('/app-data/covers/12/ebook/cover_extracted.jpg');
      statMock.mockResolvedValueOnce({ mtimeMs: 4321 } as never);
      const reply = makeReply();

      await service.serveThumbnail(7, 12, kobo, '"4321-1264x1680-q80"', reply as never);

      expect(reply.status).toHaveBeenCalledWith(304);
      expect(reply.send).toHaveBeenCalledWith();
    });

    it('serves the thumbnail when full-size covers are off', async () => {
      settingsService.getSettings.mockResolvedValue({ fullSizeCovers: false });
      statMock.mockResolvedValueOnce({ mtimeMs: 5678 } as never);
      createReadStreamMock.mockReturnValue({} as never);

      await service.serveThumbnail(7, 12, kobo, undefined, makeReply() as never);

      expect(coverStore.resolve).toHaveBeenCalledTimes(1);
      expect(createReadStreamMock).toHaveBeenCalledWith('/app-data/covers/12/ebook/thumbnail.jpg');
    });

    it('falls back to the thumbnail when the cover cannot be decoded', async () => {
      resolveCoverAt(join(tmpdir(), `kobo-cover-missing-${process.pid}.jpg`));
      statMock.mockResolvedValueOnce({ mtimeMs: 4321 } as never).mockResolvedValueOnce({ mtimeMs: 5678 } as never);
      createReadStreamMock.mockReturnValue({} as never);
      const reply = makeReply();

      await service.serveThumbnail(7, 12, kobo, undefined, reply as never);

      expect(createReadStreamMock).toHaveBeenCalledWith('/app-data/covers/12/ebook/thumbnail.jpg');
      expect(reply.header).toHaveBeenCalledWith('ETag', '"5678"');
    });
  });
});

describe('parseKoboCoverRequest', () => {
  it('reads the box, quality and greyscale flag from the image URL', () => {
    expect(parseKoboCoverRequest('1264', '1680', '80', 'False')).toEqual({ width: 1264, height: 1680, quality: 80, greyscale: false });
    expect(parseKoboCoverRequest('355', '530', '60', 'True')).toEqual({ width: 355, height: 530, quality: 60, greyscale: true });
  });

  it('caps the box and defaults a missing or invalid quality', () => {
    expect(parseKoboCoverRequest('99999', '3000')).toEqual({ width: 2400, height: 2400, quality: 85, greyscale: false });
    expect(parseKoboCoverRequest('300', '300', '0')).toMatchObject({ quality: 85 });
    expect(parseKoboCoverRequest('300', '300', '101')).toMatchObject({ quality: 85 });
  });

  it('rejects a box it cannot read', () => {
    expect(parseKoboCoverRequest('0', '1680')).toBeNull();
    expect(parseKoboCoverRequest('1264', 'abc')).toBeNull();
    expect(parseKoboCoverRequest('-5', '1680')).toBeNull();
  });
});
