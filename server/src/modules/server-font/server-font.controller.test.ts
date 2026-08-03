import { BadRequestException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ServerFontController } from './server-font.controller';
import type { ServerFontService } from './server-font.service';

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => 'mock-stream'),
}));

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    username: 'admin',
    name: 'Admin',
    email: null,
    active: true,
    isSuperuser: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeReply() {
  return {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
}

describe('ServerFontController', () => {
  let controller: ServerFontController;
  let serverFontService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    serverFontService = {
      list: vi.fn().mockResolvedValue([]),
      upload: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getFileInfo: vi.fn(),
    };

    controller = new ServerFontController(serverFontService as unknown as ServerFontService);
  });

  describe('list', () => {
    it('returns the server font collection', async () => {
      const fonts = [{ id: 1, familyName: 'OpenDyslexic' }];
      serverFontService.list.mockResolvedValue(fonts);

      await expect(controller.list()).resolves.toEqual(fonts);
    });

    it('takes no user argument, since the collection is the same for everyone', () => {
      expect(controller.list).toHaveLength(0);
    });
  });

  describe('upload', () => {
    it('passes the uploaded buffer and filename through', async () => {
      const user = makeUser();
      const buffer = Buffer.from('font data');
      const req = { file: vi.fn().mockResolvedValue({ filename: 'Test.ttf', toBuffer: vi.fn().mockResolvedValue(buffer) }) };
      const uploadResult = { font: { id: 1 }, suggestedFamilyName: 'Test', suggestedWeight: 400, suggestedStyle: 'normal' };
      serverFontService.upload.mockResolvedValue(uploadResult);

      const result = await controller.upload(user, req as never);

      expect(serverFontService.upload).toHaveBeenCalledWith(user, buffer, 'Test.ttf');
      expect(result).toEqual(uploadResult);
    });

    it('rejects a request with no file part', async () => {
      const req = { file: vi.fn().mockResolvedValue(undefined) };

      await expect(controller.upload(makeUser(), req as never)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('forwards the id and dto', async () => {
      serverFontService.update.mockResolvedValue({ id: 1, familyName: 'New Name' });

      const result = await controller.update(1, { familyName: 'New Name' });

      expect(serverFontService.update).toHaveBeenCalledWith(1, { familyName: 'New Name' });
      expect(result).toEqual({ id: 1, familyName: 'New Name' });
    });
  });

  describe('remove', () => {
    it('forwards the id', async () => {
      serverFontService.remove.mockResolvedValue(undefined);

      await controller.remove(1);

      expect(serverFontService.remove).toHaveBeenCalledWith(1);
    });
  });

  describe('serveFile', () => {
    beforeEach(() => {
      serverFontService.getFileInfo.mockResolvedValue({
        filePath: '/app-data/fonts/font.otf',
        font: { id: 1, format: 'otf', fileHash: 'abc123' },
      });
    });

    it('sends the file with content type, ETag, and immutable caching', async () => {
      const reply = makeReply();

      await controller.serveFile(1, { headers: {} } as never, reply as never);

      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'font/otf');
      expect(reply.header).toHaveBeenCalledWith('ETag', '"abc123"');
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, max-age=31536000, immutable');
      expect(reply.send).toHaveBeenCalled();
    });

    it('keeps the response out of shared caches even though every user gets the same bytes', async () => {
      const reply = makeReply();

      await controller.serveFile(1, { headers: {} } as never, reply as never);

      const cacheControl = reply.header.mock.calls.find(([name]) => name === 'Cache-Control')?.[1] as string;
      expect(cacheControl).toContain('private');
      expect(cacheControl).not.toContain('public');
    });

    it('returns 304 when the ETag matches If-None-Match', async () => {
      const reply = makeReply();

      await controller.serveFile(1, { headers: { 'if-none-match': '"abc123"' } } as never, reply as never);

      expect(reply.status).toHaveBeenCalledWith(304);
      expect(reply.header).not.toHaveBeenCalled();
    });

    it('sends the body when If-None-Match is stale', async () => {
      const reply = makeReply();

      await controller.serveFile(1, { headers: { 'if-none-match': '"outdated"' } } as never, reply as never);

      expect(reply.status).not.toHaveBeenCalledWith(304);
      expect(reply.send).toHaveBeenCalledWith('mock-stream');
    });
  });

  describe('route permissions', () => {
    it.each([['upload'], ['update'], ['remove']] as const)('%s requires ManageAppSettings', (method) => {
      const meta = Reflect.getMetadata(PERMISSION_KEY, ServerFontController.prototype[method]) as Permission;
      expect(meta).toBe(Permission.ManageAppSettings);
    });

    it.each([['upload'], ['update'], ['remove']] as const)('%s is blocked for demo-restricted accounts', (method) => {
      const meta = Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, ServerFontController.prototype[method]) as {
        permission: Permission;
        message?: string;
      };
      expect(meta).toEqual({
        permission: Permission.DemoRestricted,
        message: 'Demo-restricted account cannot manage server fonts',
      });
    });

    it.each([['list'], ['serveFile']] as const)('%s stays open to every authenticated user', (method) => {
      expect(Reflect.getMetadata(PERMISSION_KEY, ServerFontController.prototype[method])).toBeUndefined();
      expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, ServerFontController.prototype[method])).toBeUndefined();
    });
  });
});
