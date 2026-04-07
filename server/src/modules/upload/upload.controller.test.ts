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

  it('returns the value from uploadService.upload directly', async () => {
    const stream = {};
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'Dune.epub', file: stream }),
    };
    const user = { id: 1, isSuperuser: false, permissions: [] } as any;
    uploadService.upload.mockResolvedValue({ bookId: 42, filename: 'Dune.epub', format: 'epub', sizeBytes: 1234 });

    const result = await controller.uploadBook(1, undefined, user, req as any);

    expect(result).toEqual({ bookId: 42, filename: 'Dune.epub', format: 'epub', sizeBytes: 1234 });
  });

  it('folderId=undefined passes undefined to service', async () => {
    const stream = {};
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: stream }),
    };
    const user = { id: 1, isSuperuser: false, permissions: [] } as any;
    uploadService.upload.mockResolvedValue({ bookId: 1 });

    await controller.uploadBook(1, undefined, user, req as any);

    expect(uploadService.upload).toHaveBeenCalledWith(1, undefined, 'book.epub', stream, user);
  });

  it('folderId="0" is rejected (0 is not a positive integer)', async () => {
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: {} }),
    };
    const user = { id: 1, isSuperuser: false, permissions: [] } as any;

    await expect(controller.uploadBook(1, '0', user, req as any)).rejects.toThrow(new BadRequestException('Invalid folderId'));
  });

  it('folderId with leading zeros "007" is accepted, parsed as 7', async () => {
    const stream = {};
    const req = {
      file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: stream }),
    };
    const user = { id: 1, isSuperuser: false, permissions: [] } as any;
    uploadService.upload.mockResolvedValue({ bookId: 1 });

    await controller.uploadBook(1, '007', user, req as any);

    expect(uploadService.upload).toHaveBeenCalledWith(1, 7, 'book.epub', stream, user);
  });
});
