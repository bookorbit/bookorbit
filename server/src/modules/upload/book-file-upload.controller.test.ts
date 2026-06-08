import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';

import { BookFileUploadController } from './book-file-upload.controller';
import { MAX_UPLOAD_BYTES } from './upload-storage.service';

function makeUser(overrides: Record<string, unknown> = {}) {
  return { id: 1, isSuperuser: false, permissions: [], ...overrides } as any;
}

describe('BookFileUploadController', () => {
  const uploadService = {
    addFileToBook: vi.fn(),
    renameBookFiles: vi.fn(),
  };

  const controller = new BookFileUploadController(uploadService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('addFileToBook', () => {
    it('requires LibraryUpload permission', () => {
      const permission = Reflect.getMetadata(PERMISSION_KEY, BookFileUploadController.prototype.addFileToBook);
      expect(permission).toBe(Permission.LibraryUpload);
    });

    it('throws BadRequestException when no multipart file is present', async () => {
      const req = { file: vi.fn().mockResolvedValue(undefined) };

      await expect(controller.addFileToBook(1, makeUser(), req as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(uploadService.addFileToBook).not.toHaveBeenCalled();
    });

    it('passes 500 MB file size limit to multipart parser', async () => {
      const stream = {};
      const req = { file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: stream }) };
      uploadService.addFileToBook.mockResolvedValue({ id: 1 });

      await controller.addFileToBook(5, makeUser(), req as any);

      expect(req.file).toHaveBeenCalledWith({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    });

    it('delegates to uploadService.addFileToBook with correct arguments', async () => {
      const stream = {};
      const user = makeUser({ id: 3 });
      const req = { file: vi.fn().mockResolvedValue({ filename: 'dune.epub', file: stream }) };
      const serviceResult = {
        id: 55,
        format: 'epub',
        role: 'content',
        sizeBytes: 1024,
        absolutePath: '/library/Book/dune.epub',
        createdAt: '2025-01-01T00:00:00.000Z',
        filename: 'dune.epub',
        durationSeconds: null,
        bookStatus: 'present',
      };
      uploadService.addFileToBook.mockResolvedValue(serviceResult);

      const result = await controller.addFileToBook(7, user, req as any);

      expect(uploadService.addFileToBook).toHaveBeenCalledWith(7, 'dune.epub', stream, user);
      expect(result).toEqual(serviceResult);
    });

    it('propagates NotFoundException from the service', async () => {
      const req = { file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: {} }) };
      uploadService.addFileToBook.mockRejectedValue(new NotFoundException('Book 999 not found'));

      await expect(controller.addFileToBook(999, makeUser(), req as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates ForbiddenException from the service', async () => {
      const req = { file: vi.fn().mockResolvedValue({ filename: 'book.epub', file: {} }) };
      uploadService.addFileToBook.mockRejectedValue(new ForbiddenException('No access'));

      await expect(controller.addFileToBook(1, makeUser(), req as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('renameBookFiles', () => {
    it('requires LibraryEditMetadata permission', () => {
      const permission = Reflect.getMetadata(PERMISSION_KEY, BookFileUploadController.prototype.renameBookFiles);
      expect(permission).toBe(Permission.LibraryEditMetadata);
    });

    it('delegates to uploadService.renameBookFiles', async () => {
      const user = makeUser({ id: 5 });
      uploadService.renameBookFiles.mockResolvedValue(undefined);

      const result = await controller.renameBookFiles(7, user);

      expect(uploadService.renameBookFiles).toHaveBeenCalledWith(7, user);
      expect(result).toBeUndefined();
    });

    it('propagates NotFoundException from the service', async () => {
      uploadService.renameBookFiles.mockRejectedValue(new NotFoundException('Book not found'));

      await expect(controller.renameBookFiles(999, makeUser())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates ForbiddenException from the service', async () => {
      uploadService.renameBookFiles.mockRejectedValue(new ForbiddenException('No access'));

      await expect(controller.renameBookFiles(1, makeUser())).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
