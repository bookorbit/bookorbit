import { BadRequestException } from '@nestjs/common';
import { FontController } from './font.controller';
import type { FontService } from './font.service';
import type { RequestUser } from '../../common/types/request-user';

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => 'mock-stream'),
}));

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

describe('FontController', () => {
  let controller: FontController;
  let fontService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    fontService = {
      list: vi.fn().mockResolvedValue([]),
      upload: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getFileInfo: vi.fn(),
    };

    controller = new FontController(fontService as unknown as FontService);
  });

  describe('list', () => {
    it('returns fonts for the current user', async () => {
      const user = makeUser();
      const fonts = [{ id: 1, familyName: 'Test' }];
      fontService.list.mockResolvedValue(fonts);

      const result = await controller.list(user);

      expect(fontService.list).toHaveBeenCalledWith(1);
      expect(result).toEqual(fonts);
    });
  });

  describe('upload', () => {
    it('uploads a font file', async () => {
      const user = makeUser();
      const buffer = Buffer.from('font data');
      const mockFile = { filename: 'Test.ttf', toBuffer: vi.fn().mockResolvedValue(buffer) };
      const req = { file: vi.fn().mockResolvedValue(mockFile) };
      const uploadResult = { font: { id: 1, familyName: 'Test' }, suggestedFamilyName: 'Test', suggestedWeight: 400, suggestedStyle: 'normal' };
      fontService.upload.mockResolvedValue(uploadResult);

      const result = await controller.upload(user, req as never);

      expect(req.file).toHaveBeenCalled();
      expect(fontService.upload).toHaveBeenCalledWith(user, buffer, 'Test.ttf');
      expect(result).toEqual(uploadResult);
    });

    it('throws BadRequestException when no file provided', async () => {
      const user = makeUser();
      const req = { file: vi.fn().mockResolvedValue(undefined) };

      await expect(controller.upload(user, req as never)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates font metadata', async () => {
      const user = makeUser();
      const updated = { id: 1, familyName: 'New Name' };
      fontService.update.mockResolvedValue(updated);

      const result = await controller.update(1, { familyName: 'New Name' }, user);

      expect(fontService.update).toHaveBeenCalledWith(user, 1, { familyName: 'New Name' });
      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('deletes a font', async () => {
      const user = makeUser();
      fontService.remove.mockResolvedValue(undefined);

      await controller.remove(1, user);

      expect(fontService.remove).toHaveBeenCalledWith(user, 1);
    });
  });

  describe('serveFile', () => {
    it('serves a font file with correct headers', async () => {
      const user = makeUser();
      const font = { id: 1, format: 'ttf', fileHash: 'abc123' };
      fontService.getFileInfo.mockResolvedValue({
        filePath: '/path/to/font.ttf',
        font,
      });

      const reply = {
        header: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };
      const req = { headers: {} };

      await controller.serveFile(1, user, req as never, reply as never);

      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'font/ttf');
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, max-age=31536000, immutable');
      expect(reply.header).toHaveBeenCalledWith('ETag', '"abc123"');
      expect(reply.send).toHaveBeenCalled();
    });

    it('returns 304 when ETag matches If-None-Match', async () => {
      const user = makeUser();
      const font = { id: 1, format: 'ttf', fileHash: 'abc123' };
      fontService.getFileInfo.mockResolvedValue({
        filePath: '/path/to/font.ttf',
        font,
      });

      const reply = {
        header: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };
      const req = { headers: { 'if-none-match': '"abc123"' } };

      await controller.serveFile(1, user, req as never, reply as never);

      expect(reply.status).toHaveBeenCalledWith(304);
      expect(reply.send).toHaveBeenCalled();
    });
  });
});
