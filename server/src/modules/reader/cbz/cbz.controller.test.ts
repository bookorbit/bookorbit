import { PassThrough } from 'stream';

import { CbzController } from './cbz.controller';

describe('CbzController', () => {
  const cbzService = {
    getPageCount: vi.fn(),
    streamPage: vi.fn(),
  };

  const controller = new CbzController(cbzService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('wraps page count response from service', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    cbzService.getPageCount.mockResolvedValue(42);

    const result = await controller.getPageCount(12, user);

    expect(result).toEqual({ pageCount: 42 });
    expect(cbzService.getPageCount).toHaveBeenCalledWith(12, user);
  });

  it('asks clients to revalidate pages and streams page bytes', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      status: vi.fn(),
      send: vi.fn(),
    };
    cbzService.streamPage.mockResolvedValue({ notModified: false, etag: '"page-tag"', stream, mimeType: 'image/png' });

    await controller.getPage(12, 3, user, reply as any);

    expect(cbzService.streamPage).toHaveBeenCalledWith(12, 3, user, undefined);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"page-tag"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('answers 304 with the validator when the client already holds the page', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      status: vi.fn(),
      send: vi.fn(),
    };
    reply.status.mockReturnValue(reply);
    cbzService.streamPage.mockResolvedValue({ notModified: true, etag: '"page-tag"' });

    await controller.getPage(12, 3, user, reply as any, '"page-tag"');

    expect(cbzService.streamPage).toHaveBeenCalledWith(12, 3, user, '"page-tag"');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"page-tag"');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(reply.type).not.toHaveBeenCalled();
  });
});
