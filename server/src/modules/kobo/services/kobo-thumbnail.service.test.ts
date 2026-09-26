vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { KoboThumbnailService } from './kobo-thumbnail.service';

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
  let service: KoboThumbnailService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    service = new KoboThumbnailService(bookAccessService as never, coverStore as never);
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    coverStore.resolve.mockImplementation((bookId: number, options: { variant: string }) =>
      Promise.resolve(`/app-data/covers/${bookId}/ebook/${options.variant === 'thumbnail' ? 'thumbnail.jpg' : 'cover_custom.png'}`),
    );
  });

  it('returns 304 when thumbnail etag matches if-none-match', async () => {
    const reply = makeReply();
    statMock.mockResolvedValueOnce({ mtimeMs: 1234 } as never);

    await service.serveThumbnail(7, 12, '"1234"', reply as never);

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

    await service.serveThumbnail(7, 12, undefined, reply as never);

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

    await service.serveThumbnail(7, 12, undefined, reply as never);

    expect(coverSpy).toHaveBeenCalledWith(12, undefined, reply);
  });

  it('falls back to cover serving when the book has no thumbnail', async () => {
    const reply = makeReply();
    coverStore.resolve.mockResolvedValueOnce(null);
    const coverSpy = vi.spyOn(service, 'serveCover').mockResolvedValue(undefined);

    await service.serveThumbnail(7, 12, undefined, reply as never);

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
});
