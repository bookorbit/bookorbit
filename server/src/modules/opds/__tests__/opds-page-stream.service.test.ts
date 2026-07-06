vi.mock('fs', () => ({ createReadStream: vi.fn() }));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';

import { OpdsPageStreamService } from '../opds-page-stream.service';

const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;

function makeService(pageCount: number | null) {
  const cbzService = { streamPage: vi.fn() };
  const pdfPageService = { ensurePage: vi.fn(), invalidate: vi.fn() };
  const pageCountService = { ensure: vi.fn().mockResolvedValue(pageCount) };
  const service = new OpdsPageStreamService(cbzService as never, pdfPageService as never, pageCountService as never);
  return { service, cbzService, pdfPageService, pageCountService };
}

const user = { id: 1 } as never;

describe('OpdsPageStreamService', () => {
  it('rejects negative page numbers before touching the page count', async () => {
    const { service, pageCountService } = makeService(10);
    await expect(service.streamPage({ id: 1, format: 'cbz', absolutePath: '/a.cbz', pageCount: 10 }, -1, user)).rejects.toThrow(BadRequestException);
    expect(pageCountService.ensure).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the page count cannot be determined', async () => {
    const { service } = makeService(null);
    await expect(service.streamPage({ id: 1, format: 'cbz', absolutePath: '/a.cbz', pageCount: null }, 0, user)).rejects.toThrow(NotFoundException);
  });

  it('rejects an out-of-range page number', async () => {
    const { service } = makeService(5);
    await expect(service.streamPage({ id: 1, format: 'cbz', absolutePath: '/a.cbz', pageCount: null }, 5, user)).rejects.toThrow(BadRequestException);
  });

  it('streams a comic page via CbzService', async () => {
    const { service, cbzService } = makeService(5);
    cbzService.streamPage.mockResolvedValue({ stream: 'cbz-stream', mimeType: 'image/jpeg' });

    await expect(service.streamPage({ id: 1, format: 'cbz', absolutePath: '/a.cbz', pageCount: null }, 2, user)).resolves.toEqual({
      stream: 'cbz-stream',
      mimeType: 'image/jpeg',
      totalPages: 5,
    });
    expect(cbzService.streamPage).toHaveBeenCalledWith(1, 2, user);
  });

  it('streams a rasterized pdf page from the on-disk cache', async () => {
    const { service, pdfPageService } = makeService(100);
    pdfPageService.ensurePage.mockResolvedValue('/cache/1/2.jpg');
    mockCreateReadStream.mockReturnValue('pdf-stream' as never);

    const result = await service.streamPage({ id: 1, format: 'pdf', absolutePath: '/a.pdf', pageCount: null }, 2, user);
    expect(pdfPageService.ensurePage).toHaveBeenCalledWith(1, '/a.pdf', 2);
    expect(mockCreateReadStream).toHaveBeenCalledWith('/cache/1/2.jpg');
    expect(result).toEqual({ stream: 'pdf-stream', mimeType: 'image/jpeg', totalPages: 100 });
  });

  it('invalidateCache only clears the pdf page cache (CbzService self-heals via its in-memory maps)', async () => {
    const { service, pdfPageService } = makeService(10);
    await service.invalidateCache({ id: 4, format: 'pdf', absolutePath: '/a.pdf', pageCount: 10 });
    expect(pdfPageService.invalidate).toHaveBeenCalledWith(4);

    pdfPageService.invalidate.mockClear();
    await service.invalidateCache({ id: 4, format: 'cbz', absolutePath: '/a.cbz', pageCount: 10 });
    expect(pdfPageService.invalidate).not.toHaveBeenCalled();
  });
});
