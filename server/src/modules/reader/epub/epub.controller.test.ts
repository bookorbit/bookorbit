import { BadRequestException } from '@nestjs/common';
import { PassThrough } from 'stream';

import { EpubController } from './epub.controller';

describe('EpubController', () => {
  const epubService = {
    getBookInfo: vi.fn(),
    streamFile: vi.fn(),
  };

  const controller = new EpubController(epubService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes undefined fileId when query is absent', async () => {
    const user = { id: 5, isSuperuser: false, permissions: [] } as any;
    epubService.getBookInfo.mockResolvedValue({ title: 'ok' });

    await controller.getBookInfo(11, undefined, user);

    expect(epubService.getBookInfo).toHaveBeenCalledWith(11, undefined, user);
  });

  it('parses numeric fileId query values', async () => {
    const user = { id: 5, isSuperuser: false, permissions: [] } as any;
    epubService.getBookInfo.mockResolvedValue({ title: 'ok' });

    await controller.getBookInfo(11, ' 12 ', user);

    expect(epubService.getBookInfo).toHaveBeenCalledWith(11, 12, user);
  });

  it.each(['abc', '12abc', '-1', '0'])('rejects invalid fileId query: %s', (fileId) => {
    expect(() => controller.getBookInfo(11, fileId, { id: 5, isSuperuser: false, permissions: [] } as any)).toThrow(
      new BadRequestException('Invalid fileId'),
    );
  });

  it('decodes wildcard file path, sets headers, and streams payload', async () => {
    const user = { id: 1, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      send: vi.fn(),
    };

    epubService.streamFile.mockResolvedValue({
      stream,
      contentType: 'application/xhtml+xml',
      size: 321,
    });

    await controller.getFile(9, 'OPS/text/Chapter%201.xhtml', '13', user, reply as any);

    expect(epubService.streamFile).toHaveBeenCalledWith(9, 'OPS/text/Chapter 1.xhtml', 13, user);
    expect(reply.header).toHaveBeenNthCalledWith(1, 'Content-Type', 'application/xhtml+xml');
    expect(reply.header).toHaveBeenNthCalledWith(2, 'Content-Length', 321);
    expect(reply.header).toHaveBeenNthCalledWith(3, 'Cache-Control', 'public, max-age=3600');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('does not set content-length when size is zero', async () => {
    const user = { id: 1, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      send: vi.fn(),
    };
    epubService.streamFile.mockResolvedValue({
      stream,
      contentType: 'application/xml',
      size: 0,
    });

    await controller.getFile(9, 'META-INF/container.xml', undefined, user, reply as any);

    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/xml');
    expect(reply.header).not.toHaveBeenCalledWith('Content-Length', expect.anything());
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
  });

  it('rejects malformed encoded file paths', async () => {
    await expect(
      controller.getFile(9, 'OPS/text/%E0%A4%A', undefined, { id: 1, isSuperuser: false, permissions: [] } as any, {} as any),
    ).rejects.toThrow(new BadRequestException('Invalid file path'));
  });
});
