import { BadRequestException } from '@nestjs/common';

import { MAX_UPLOAD_BYTES } from './upload-storage.service';
import { UploadController } from './upload.controller';

describe('UploadController', () => {
  const uploadService = {
    upload: vi.fn(),
  };

  const controller = new UploadController(uploadService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('throws when no multipart file is provided', async () => {
    const req = { file: vi.fn().mockResolvedValue(undefined) };

    await expect(controller.uploadBook(1, undefined, { id: 1, isSuperuser: false, permissions: [] } as any, req as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each(['abc', '12abc', '1.2', '-1'])('throws when folderId query value is not a strict positive integer: %s', async (folderId) => {
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'a.epub', file: {} }),
    };

    await expect(controller.uploadBook(1, folderId, { id: 1, isSuperuser: false, permissions: [] } as any, req as any)).rejects.toThrow(
      new BadRequestException('Invalid folderId'),
    );
  });

  it('accepts folderId with surrounding whitespace', async () => {
    const stream = {};
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: stream }),
    };
    uploadService.upload.mockResolvedValue({ bookId: 9 });

    await controller.uploadBook(3, ' 12 ', { id: 5, isSuperuser: false, permissions: [] } as any, req as any);

    expect(uploadService.upload).toHaveBeenCalledWith(3, 12, 'book.epub', stream, { id: 5, isSuperuser: false, permissions: [] });
  });

  it('passes parsed arguments to upload service and overrides multipart size limit', async () => {
    const stream = {};
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: stream }),
    };
    uploadService.upload.mockResolvedValue({ bookId: 9 });

    await controller.uploadBook(3, '12', { id: 5, isSuperuser: false, permissions: [] } as any, req as any);

    expect(req.file).toHaveBeenCalledWith({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    expect(uploadService.upload).toHaveBeenCalledWith(3, 12, 'book.epub', stream, { id: 5, isSuperuser: false, permissions: [] });
  });
});
