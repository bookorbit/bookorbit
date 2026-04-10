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

  it('sets response headers and streams page bytes', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      send: vi.fn(),
    };
    cbzService.streamPage.mockResolvedValue({ stream, mimeType: 'image/png' });

    await controller.getPage(12, 3, user, reply as any);

    expect(cbzService.streamPage).toHaveBeenCalledWith(12, 3, user);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });
});
