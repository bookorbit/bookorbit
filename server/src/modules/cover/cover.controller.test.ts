import { BadRequestException } from '@nestjs/common';

import { CoverController } from './cover.controller';

describe('CoverController', () => {
  const coverService = {
    searchCovers: vi.fn(),
    proxyImage: vi.fn(),
    uploadCover: vi.fn(),
    uploadCoverFromUrl: vi.fn(),
    deleteCover: vi.fn(),
  };

  const controller = new CoverController(coverService as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes search filters to cover service', async () => {
    await controller.searchCovers({
      title: 'Dune',
      author: 'Frank Herbert',
      isAudiobook: true,
      provider: 'all',
    } as never);

    expect(coverService.searchCovers).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      isAudiobook: true,
      provider: 'all',
    });
  });

  it('writes proxied image content to the response object', async () => {
    const buffer = Buffer.from('img');
    const reply = {
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    coverService.proxyImage.mockResolvedValue({ buffer, contentType: 'image/jpeg' });

    await controller.proxyImage('https://covers.example.com/dune.jpg', reply as never);

    expect(coverService.proxyImage).toHaveBeenCalledWith('https://covers.example.com/dune.jpg');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.send).toHaveBeenCalledWith(buffer);
  });

  it('rejects uploads with missing multipart file', async () => {
    const req = { file: vi.fn().mockResolvedValue(null) };

    await expect(controller.uploadCover(1, { id: 7 } as never, req as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.uploadCover(1, { id: 7 } as never, req as never)).rejects.toThrow('No file provided');
  });

  it('uploads multipart image bytes through cover service', async () => {
    const buffer = Buffer.from('bytes');
    const req = {
      file: vi.fn().mockResolvedValue({
        mimetype: 'image/png',
        toBuffer: vi.fn().mockResolvedValue(buffer),
      }),
    };
    const user = { id: 7 };

    await controller.uploadCover(12, user as never, req as never);

    expect(coverService.uploadCover).toHaveBeenCalledWith(12, buffer, 'image/png', user);
  });

  it('delegates URL uploads and delete flow', async () => {
    const user = { id: 9 };
    coverService.deleteCover.mockResolvedValue('custom');

    await controller.uploadCoverFromUrl(11, { url: 'https://example.com/cover.jpg' }, user as never);
    await expect(controller.deleteCover(11, user as never)).resolves.toEqual({ coverSource: 'custom' });

    expect(coverService.uploadCoverFromUrl).toHaveBeenCalledWith(11, 'https://example.com/cover.jpg', user);
    expect(coverService.deleteCover).toHaveBeenCalledWith(11, user);
  });
});
